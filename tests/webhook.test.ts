import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportData, importData } from '../src/lib/backup';
import { AppDB, fresh, type Food } from '../src/lib/db';
import { logFood, removeEntry, updateEntry } from '../src/lib/diary';
import { removeWeight, saveGoal, saveWeight } from '../src/lib/records';
import {
  backoff,
  buildMessage,
  enqueue,
  flush,
  getConfig,
  getState,
  MAX_AGE,
  MAX_ATTEMPTS,
  MAX_QUEUE,
  saveConfig,
  sendTest,
  validHeader,
  validUrl,
  WEBHOOK_FORMAT,
  type WebhookConfig,
  type WebhookMessage,
} from '../src/lib/webhook';

let counter = 0;
const openDb = () => new AppDB(`webhook-${++counter}`);

const URL_OK = 'https://hooks.example.test/in';
const config = (extra: Partial<WebhookConfig> = {}): WebhookConfig => ({ url: URL_OK, enabled: true, headerName: '', headerValue: '', ...extra });

function food(name: string, kcal: number, extra: Partial<Food> = {}): Food {
  return { ...fresh(), source: 'own', name, unit: 'g', per100: { kcal, protein: 10, carbs: 50, fat: 5 }, portions: [], useCount: 0, ...extra };
}

interface Call {
  url: string;
  init: RequestInit;
  message: WebhookMessage;
}

/** Stand-in target: every answer is a status code, "cors" (refuses browsers) or "down" (unreachable). */
function target(...script: (number | 'cors' | 'down')[]) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const step = script.length > 1 ? script.shift()! : (script[0] ?? 200);
    const simple = init.mode === 'no-cors';
    if (step === 'down' || (step === 'cors' && !simple)) throw new TypeError('Failed to fetch');
    calls.push({ url: String(input), init, message: JSON.parse(String(init.body)) as WebhookMessage });
    return new Response('', { status: step === 'cors' ? 200 : step });
  }) as typeof fetch;
  return { calls, fetcher };
}

const events = (calls: Call[]) => calls.map((call) => call.message.event);
const headerOf = (call: Call, name: string) => new Headers(call.init.headers).get(name);

afterEach(() => vi.unstubAllGlobals());

describe('webhook: settings', () => {
  it('allows https only, except to this machine', () => {
    expect(validUrl('https://example.org/hook')).toBe(true);
    expect(validUrl('  https://example.org/hook  ')).toBe(true);
    expect(validUrl('http://localhost:5678/webhook/x')).toBe(true);
    expect(validUrl('http://127.0.0.1:8123/api/webhook/x')).toBe(true);
    expect(validUrl('http://homeassistant.local:8123/api/webhook/x')).toBe(false);
    expect(validUrl('example.org/hook')).toBe(false);
    expect(validUrl('')).toBe(false);
  });

  it('checks name and value of the header', () => {
    expect(validHeader('', '')).toBe(true);
    expect(validHeader('Authorization', 'Bearer abc.def-123')).toBe(true);
    expect(validHeader('X-Token', '')).toBe(true);
    expect(validHeader('X Token', 'abc')).toBe(false);
    expect(validHeader('X-Token:', 'abc')).toBe(false);
    expect(validHeader('X-Token', 'abc\ndef')).toBe(false);
  });

  it('probes a changed target again', async () => {
    const database = openDb();
    await saveConfig(config(), database);
    await database.device.put({ key: 'webhookState', value: { mode: 'simple', retryAt: 99, lastSentAt: 5 } });
    await saveConfig(config({ enabled: false }), database);
    expect(await getState(database)).toMatchObject({ mode: 'simple', retryAt: 99 });
    await saveConfig(config({ url: 'https://other.example.test/in' }), database);
    expect(await getState(database)).toEqual({ lastSentAt: 5, mode: undefined, retryAt: undefined });
  });
});

describe('webhook: message', () => {
  it('contains event, time, record with piece count, day total and goal', async () => {
    const database = openDb();
    await saveGoal('2026-11-01', { kcal: 2200, protein: 140, carbs: 250, fat: 70 }, database);
    await database.settings.put({ key: 'mealNames', value: ['Morning', 'Midday', 'Evening', 'Snacks'], updatedAt: 0 });
    await logFood(food('Oats', 370), 60, 0, '2026-11-21', database);
    const drops = food('Mint drops', 380, { portions: [{ label: 'Pastille', amount: 1.2 }] });
    const entry = await logFood(drops, 3.6, 0, '2026-11-21', database, { label: 'Pastille', count: 3 });
    await removeEntry((await logFood(food('Deleted', 999), 100, 0, '2026-11-21', database)).id, database);

    const message = await buildMessage({ event: 'entry.created', entry }, database, Date.UTC(2026, 10, 21, 12, 30));
    expect(message).toMatchObject({
      app: 'anotherpound',
      format: WEBHOOK_FORMAT,
      event: 'entry.created',
      time: '2026-11-21T12:30:00.000Z',
      entry: {
        id: entry.id,
        date: '2026-11-21',
        meal: 0,
        mealName: 'Morning',
        kind: 'food',
        name: 'Mint drops',
        amount: 3.6,
        unit: 'g',
        portion: 'Pastille',
        count: 3,
        nutrients: { kcal: 13.7, protein: 0.4, carbs: 1.8, fat: 0.2 },
      },
      day: { date: '2026-11-21', total: { kcal: 235.7 }, goal: { kcal: 2200, protein: 140, carbs: 250, fat: 70 } },
    });
    expect(message.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(message.text).toBe('Added: Mint drops, 3 × Pastille, 14 kcal (Morning). Day: 236 of 2,200 kcal.');
    expect(message.content).toBe(message.text);
  });

  it('works without a goal and without an amount and describes weight and goal', async () => {
    const database = openDb();
    const weight = await saveWeight('2026-11-21', 81.4, database);
    expect(await buildMessage({ event: 'weight.set', weight }, database)).toMatchObject({
      weight: { id: weight.id, date: '2026-11-21', kg: 81.4 },
      day: { date: '2026-11-21', total: { kcal: 0 }, goal: null },
      text: 'Weight: 81.4 kg (2026-11-21)',
    });
    const goal = await saveGoal('2026-11-21', { kcal: 2000, protein: 120, carbs: 220, fat: 65 }, database);
    expect(await buildMessage({ event: 'goal.changed', goal }, database)).toMatchObject({
      goal: { validFrom: '2026-11-21', kcal: 2000, protein: 120, carbs: 220, fat: 65 },
      text: 'Goal: 2,000 kcal, Protein 120 g, Carbs 220 g, Fat 65 g',
    });
    expect((await buildMessage({ event: 'test' }, database)).text).toBe('AnotherPound: test');
  });
});

describe('webhook: queue and sending', () => {
  it('queues only when switched on and valid', async () => {
    const database = openDb();
    expect(await enqueue({ event: 'test' }, database)).toBe(false);
    await saveConfig(config({ enabled: false }), database);
    expect(await enqueue({ event: 'test' }, database)).toBe(false);
    await saveConfig(config({ url: 'http://example.org/insecure' }), database);
    expect(await enqueue({ event: 'test' }, database)).toBe(false);
    await saveConfig(config(), database);
    expect(await enqueue({ event: 'test' }, database)).toBe(true);
    expect(await database.outbox.count()).toBe(1);
  });

  it('sends in order as JSON with the header and without cookies', async () => {
    const database = openDb();
    await saveConfig(config({ headerName: 'X-Token', headerValue: 'secret' }), database);
    const weight = { ...fresh(), date: '2026-11-21', kg: 80 };
    await enqueue({ event: 'weight.set', weight }, database, 1000);
    await enqueue({ event: 'weight.deleted', weight }, database, 2000);
    await enqueue({ event: 'test' }, database, 3000);

    const hook = target(200);
    await flush(database, hook.fetcher, () => 5000);
    expect(hook.calls.map((call) => call.url)).toEqual([URL_OK, URL_OK, URL_OK]);
    expect(events(hook.calls)).toEqual(['weight.set', 'weight.deleted', 'test']);
    const first = hook.calls[0]!;
    expect(first.init).toMatchObject({ method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(headerOf(first, 'Content-Type')).toBe('application/json');
    expect(headerOf(first, 'X-Token')).toBe('secret');
    expect(await database.outbox.count()).toBe(0);
    expect(await getState(database)).toEqual({ lastSentAt: 5000, unconfirmed: false, mode: 'cors' });
  });

  it('stops at the first failure, waits longer and then sends in the old order', async () => {
    const database = openDb();
    await saveConfig(config(), database);
    await enqueue({ event: 'test' }, database, 0);
    const weight = { ...fresh(), date: '2026-11-21', kg: 80 };
    await enqueue({ event: 'weight.set', weight }, database, 0);

    const hook = target(503, 503, 200);
    await flush(database, hook.fetcher, () => 1000);
    expect(hook.calls).toHaveLength(1);
    expect(await database.outbox.count()).toBe(2);
    expect(await getState(database)).toMatchObject({ lastError: 'HTTP 503', lastErrorAt: 1000, retryAt: 1000 + 60_000 });

    // Nothing happens before the wait is over.
    await flush(database, hook.fetcher, () => 30_000);
    expect(hook.calls).toHaveLength(1);

    await flush(database, hook.fetcher, () => 61_000);
    expect(hook.calls).toHaveLength(2);
    expect(await getState(database)).toMatchObject({ retryAt: 61_000 + 120_000 });

    await flush(database, hook.fetcher, () => 200_000);
    expect(events(hook.calls)).toEqual(['test', 'test', 'test', 'weight.set']);
    expect(await database.outbox.count()).toBe(0);
    expect((await getState(database)).lastError).toBeUndefined();
  });

  it('extends the wait to one hour at most', () => {
    expect([1, 2, 3, 7, 12].map(backoff)).toEqual([60_000, 120_000, 240_000, 3_600_000, 3_600_000]);
  });

  it('drops after too many failed attempts or too much time and sends the rest', async () => {
    const database = openDb();
    await saveConfig(config(), database);
    await database.outbox.bulkAdd([
      { createdAt: 0, attempts: 0, body: JSON.stringify({ event: 'too old' }) },
      { createdAt: MAX_AGE, attempts: MAX_ATTEMPTS, body: JSON.stringify({ event: 'too often' }) },
      { createdAt: MAX_AGE, attempts: MAX_ATTEMPTS - 1, body: JSON.stringify({ event: 'last attempt' }) },
      { createdAt: MAX_AGE, attempts: 0, body: JSON.stringify({ event: 'fresh' }) },
    ]);
    const hook = target(200);
    await flush(database, hook.fetcher, () => MAX_AGE + 1);
    expect(events(hook.calls)).toEqual(['last attempt', 'fresh']);
    expect(await database.outbox.count()).toBe(0);
  });

  it('keeps a fixed number of waiting messages at most', async () => {
    const database = openDb();
    await saveConfig(config(), database);
    await database.outbox.bulkAdd(Array.from({ length: MAX_QUEUE }, (_, index) => ({ createdAt: index, attempts: 0, body: '{}' })));
    await enqueue({ event: 'test' }, database, 9999);
    expect(await database.outbox.count()).toBe(MAX_QUEUE);
    expect((await database.outbox.orderBy(':id').first())!.createdAt).toBe(1);
    expect((await database.outbox.orderBy(':id').last())!.createdAt).toBe(9999);
  });

  it('falls back to the simple request without a header and remembers the way', async () => {
    const database = openDb();
    await saveConfig(config(), database);
    await enqueue({ event: 'test' }, database, 0);
    await enqueue({ event: 'test' }, database, 0);

    const hook = target('cors');
    await flush(database, hook.fetcher, () => 1000);
    // First message: the JSON attempt fails at the target, the simple request gets through. Second: simple right away.
    expect(hook.calls).toHaveLength(2);
    expect(hook.calls.every((call) => call.init.mode === 'no-cors' && call.init.headers === undefined)).toBe(true);
    expect(await getState(database)).toEqual({ lastSentAt: 1000, unconfirmed: true, mode: 'simple' });
  });

  it('does not fall back with a header: the secret would be lost otherwise', async () => {
    const database = openDb();
    await saveConfig(config({ headerName: 'Authorization', headerValue: 'Bearer abc' }), database);
    await enqueue({ event: 'test' }, database, 0);
    const hook = target('cors');
    await flush(database, hook.fetcher, () => 1000);
    expect(hook.calls).toHaveLength(0);
    expect(await database.outbox.count()).toBe(1);
    expect(await getState(database)).toMatchObject({ lastError: 'unreachable', retryAt: 61_000 });
  });

  it('sends nothing while the switch is off and keeps the queue', async () => {
    const database = openDb();
    await saveConfig(config(), database);
    await enqueue({ event: 'test' }, database);
    await saveConfig(config({ enabled: false }), database);
    const hook = target(200);
    await flush(database, hook.fetcher);
    expect(hook.calls).toHaveLength(0);
    await saveConfig(config(), database);
    await flush(database, hook.fetcher);
    expect(hook.calls).toHaveLength(1);
  });

  it('counts no failed attempt while offline and sends as soon as the network is back', async () => {
    const database = openDb();
    await saveConfig(config(), database);
    await enqueue({ event: 'test' }, database);
    const hook = target(200);

    vi.stubGlobal('navigator', { onLine: false });
    await flush(database, hook.fetcher);
    expect(hook.calls).toHaveLength(0);
    expect((await database.outbox.toArray())[0]!.attempts).toBe(0);
    expect(await getState(database)).toEqual({});

    vi.stubGlobal('navigator', { onLine: true });
    await flush(database, hook.fetcher);
    expect(hook.calls).toHaveLength(1);
    expect(await database.outbox.count()).toBe(0);
  });

  it('picks up what arrives during a run', async () => {
    const database = openDb();
    await saveConfig(config(), database);
    await enqueue({ event: 'test' }, database);
    const hook = target(200);
    const first = flush(database, hook.fetcher);
    await enqueue({ event: 'weight.set', weight: { ...fresh(), date: '2026-11-21', kg: 80 } }, database);
    expect(flush(database, hook.fetcher)).toBe(first);
    await first;
    expect(events(hook.calls)).toEqual(['test', 'weight.set']);
    expect(await database.outbox.count()).toBe(0);
  });

  it('tests at once, even with the switch off, and reports the result', async () => {
    const database = openDb();
    await saveConfig(config({ enabled: false }), database);
    expect(await sendTest(database, target(200).fetcher, () => 7)).toEqual({ ok: true, mode: 'cors', unconfirmed: false });
    expect(await getState(database)).toEqual({ lastSentAt: 7, unconfirmed: false, mode: 'cors' });
    expect(await sendTest(database, target(401).fetcher, () => 8)).toEqual({ ok: false, error: 'HTTP 401' });
    expect(await getState(database)).toMatchObject({ lastError: 'HTTP 401', lastErrorAt: 8 });
    expect(await sendTest(database, target('down').fetcher, () => 9)).toEqual({ ok: false, error: 'unreachable' });
    expect(await database.outbox.count()).toBe(0);
  });
});

describe('webhook: together with the rest', () => {
  it('reports entries, weight and goal in the order of the changes', async () => {
    const database = openDb();
    const hook = target(200);
    vi.stubGlobal('fetch', hook.fetcher);
    await saveConfig(config(), database);

    const entry = await logFood(food('Oats', 370), 60, 0, '2026-11-21', database);
    await updateEntry(entry, { amount: 80 }, database);
    await removeEntry(entry.id, database);
    const weight = await saveWeight('2026-11-21', 81.4, database);
    await removeWeight(weight.id, database);
    await saveGoal('2026-11-21', { kcal: 2000, protein: 120, carbs: 220, fat: 65 }, database);

    await vi.waitFor(() => expect(hook.calls).toHaveLength(6));
    expect(events(hook.calls)).toEqual(['entry.created', 'entry.updated', 'entry.deleted', 'weight.set', 'weight.deleted', 'goal.changed']);
    expect(hook.calls[1]!.message.entry).toMatchObject({ name: 'Oats', amount: 80, nutrients: { kcal: 296 } });
    await vi.waitFor(async () => expect(await database.outbox.count()).toBe(0));
  });

  it('does not let logging fail because of a broken webhook', async () => {
    const database = openDb();
    vi.stubGlobal('fetch', target('down').fetcher);
    await saveConfig(config(), database);
    // Even when the queue cannot be written, the entry is logged.
    vi.spyOn(database.outbox, 'add').mockRejectedValueOnce(new Error('full'));
    const first = await logFood(food('Apple', 55), 150, 3, '2026-11-21', database);
    const second = await logFood(food('Pear', 55), 150, 3, '2026-11-21', database);
    expect([first.name, second.name]).toEqual(['Apple', 'Pear']);
    expect(await database.entries.count()).toBe(2);
    await vi.waitFor(async () => expect(await getState(database)).toMatchObject({ lastError: 'unreachable' }));
    expect(await database.outbox.count()).toBe(1);
  });

  it('keeps address, secret and queue out of the backup and survives a restore', async () => {
    const database = openDb();
    await saveConfig(config({ url: 'https://secret.example.test/hook/abc123', headerName: 'X-Token', headerValue: 'top-secret' }), database);
    await logFood(food('Oats', 370), 60, 0, '2026-11-21', database);
    await enqueue({ event: 'test' }, database);

    const backup = await exportData(database);
    const text = JSON.stringify(backup);
    expect(text).not.toContain('secret.example.test');
    expect(text).not.toContain('top-secret');
    expect(Object.keys(backup.tables).sort()).toEqual(['dishes', 'entries', 'foods', 'goals', 'settings', 'templates', 'weights']);

    const queued = await database.outbox.count();
    await importData(backup, database);
    expect(await getConfig(database)).toMatchObject({ url: 'https://secret.example.test/hook/abc123', headerValue: 'top-secret' });
    expect(await database.outbox.count()).toBe(queued);
  });
});
