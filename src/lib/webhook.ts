import { formatAmount, formatNumber, todayKey } from './dates';
import { db, getSetting, newId, type AppDB, type Entry, type Goal, type Nutrients, type Weight } from './db';
import { goalFor } from './goals';
import { mealNames } from './meals';
import { total } from './nutrition';
import { formatCount } from './portions';
import { t } from './texts';

/**
 * Outgoing webhook: reports changes as JSON to a freely chosen address.
 *
 * Messages first land in a queue in the database and go out from there
 * in order. Recording an entry never waits for this and never fails because of it.
 * Address, header and queue exist only on this device, not in the backup.
 */

/** Version of the message format. Rises when fields change or are removed. */
export const WEBHOOK_FORMAT = 1;
/** A message is discarded after this many failed attempts or after this much time. */
export const MAX_ATTEMPTS = 12;
export const MAX_AGE = 7 * 86_400_000;
/** The app does not keep more queued messages than this; the oldest drop out. */
export const MAX_QUEUE = 500;
const TIMEOUT = 15_000;

export interface WebhookConfig {
  url: string;
  enabled: boolean;
  /** Freely chosen header, for example "Authorization". Empty means: none. */
  headerName: string;
  headerValue: string;
}

export interface WebhookState {
  lastSentAt?: number;
  /** The last send went out, but the target's response was not readable. */
  unconfirmed?: boolean;
  /** "HTTP 401" or "unreachable". */
  lastError?: string;
  lastErrorAt?: number;
  /** How the target was last reachable: with a readable response or only as a plain request. */
  mode?: 'cors' | 'simple';
  /** No new attempt before this time. */
  retryAt?: number;
}

export type Change =
  | { event: 'entry.created' | 'entry.updated' | 'entry.deleted'; entry: Entry }
  | { event: 'weight.set' | 'weight.deleted'; weight: Weight }
  | { event: 'goal.changed'; goal: Goal }
  | { event: 'test' };

export type WebhookEvent = Change['event'];

type Macros = Pick<Nutrients, 'kcal' | 'protein' | 'carbs' | 'fat'>;

export interface WebhookMessage {
  app: 'anotherpound';
  format: number;
  appVersion: string;
  /** Unique per message. If a message arrives twice, it can be recognized by this. */
  id: string;
  event: WebhookEvent;
  /** Time of the change, ISO 8601 in UTC. */
  time: string;
  entry?: {
    id: string;
    date: string;
    meal: number;
    mealName: string;
    kind: Entry['kind'];
    name: string;
    amount?: number;
    unit?: string;
    portion?: string;
    count?: number;
    nutrients: Nutrients;
  };
  weight?: { id: string; date: string; kg: number };
  goal?: { id: string; validFrom: string } & Macros;
  /** Total of the affected day at the time of the message, with the goal of that day. */
  day: { date: string; total: Nutrients; goal: Macros | null };
  /** The same readable line twice: `content` is shown by Discord, `text` by Slack and similar services. */
  text: string;
  content: string;
}

const EMPTY: WebhookConfig = { url: '', enabled: false, headerName: '', headerValue: '' };

export async function getConfig(database: AppDB = db): Promise<WebhookConfig> {
  const row = await database.device.get('webhook');
  return { ...EMPTY, ...(row?.value as Partial<WebhookConfig> | undefined) };
}

export async function getState(database: AppDB = db): Promise<WebhookState> {
  return ((await database.device.get('webhookState'))?.value as WebhookState | undefined) ?? {};
}

async function setState(database: AppDB, state: WebhookState): Promise<void> {
  await database.device.put({ key: 'webhookState', value: state });
}

/** Saves address and header. A changed target is probed again and tried right away. */
export async function saveConfig(config: WebhookConfig, database: AppDB = db): Promise<void> {
  const before = await getConfig(database);
  await database.device.put({ key: 'webhook', value: { ...config } });
  if (before.url !== config.url || before.headerName !== config.headerName || before.headerValue !== config.headerValue) {
    const state = await getState(database);
    await setState(database, { ...state, mode: undefined, retryAt: undefined });
  }
}

/** https is required: a page loaded over https must not send to http. The exception is the local machine. */
export function validUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Header name: empty or a valid name. The value: printable characters without line breaks. */
export function validHeader(name: string, value: string): boolean {
  if (name.trim() === '') return true;
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name.trim()) && /^[\x20-\x7E\xA0-\xFF]*$/.test(value);
}

export function isActive(config: WebhookConfig): boolean {
  return config.enabled && validUrl(config.url) && validHeader(config.headerName, config.headerValue);
}

function rounded(nutrients: Nutrients): Nutrients {
  const round = (value: number) => Math.round(value * 10) / 10;
  const out: Nutrients = {
    kcal: round(nutrients.kcal),
    protein: round(nutrients.protein),
    carbs: round(nutrients.carbs),
    fat: round(nutrients.fat),
  };
  for (const key of ['sugar', 'satFat', 'fiber', 'salt'] as const) {
    const value = nutrients[key];
    if (value !== undefined) out[key] = round(value);
  }
  return out;
}

function macros(goal: Goal): Macros {
  return { kcal: goal.kcal, protein: goal.protein, carbs: goal.carbs, fat: goal.fat };
}

async function daySummary(date: string, database: AppDB): Promise<WebhookMessage['day']> {
  const entries = (await database.entries.where('date').equals(date).toArray()).filter((entry) => !entry.deleted);
  const goal = goalFor(date, await database.goals.toArray());
  return { date, total: rounded(total(entries.map((entry) => entry.nutrients))), goal: goal ? macros(goal) : null };
}

function amountText(entry: Entry): string | undefined {
  if (entry.count && entry.portion) return formatCount(entry.count, entry.portion);
  return entry.amount ? `${formatAmount(entry.amount)} ${entry.unit ?? 'g'}` : undefined;
}

/** Builds the message for a change, with the state of the affected day. */
export async function buildMessage(change: Change, database: AppDB = db, now = Date.now()): Promise<WebhookMessage> {
  const date =
    'entry' in change ? change.entry.date : 'weight' in change ? change.weight.date : 'goal' in change ? change.goal.validFrom : todayKey();
  const day = await daySummary(date, database);
  const dayText = t.hook.day(formatNumber(day.total.kcal), day.goal ? formatNumber(day.goal.kcal) : undefined);

  const message: WebhookMessage = {
    app: 'anotherpound',
    format: WEBHOOK_FORMAT,
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
    id: newId(),
    event: change.event,
    time: new Date(now).toISOString(),
    day,
    text: t.hook.testMessage,
    content: '',
  };

  if ('entry' in change) {
    const { entry } = change;
    const mealName = mealNames(await getSetting<string[]>('mealNames', database))[entry.meal]!;
    message.entry = {
      id: entry.id,
      date: entry.date,
      meal: entry.meal,
      mealName,
      kind: entry.kind,
      name: entry.name,
      ...(entry.amount !== undefined ? { amount: Math.round(entry.amount * 10) / 10, unit: entry.unit ?? 'g' } : {}),
      ...(entry.count && entry.portion ? { portion: entry.portion, count: entry.count } : {}),
      nutrients: rounded(entry.nutrients),
    };
    const parts = [entry.name, amountText(entry), `${formatNumber(entry.nutrients.kcal)} kcal`].filter(Boolean).join(', ');
    message.text = `${t.hook.events[change.event]}: ${parts} (${mealName}). ${dayText}`;
  } else if ('weight' in change) {
    const { weight } = change;
    message.weight = { id: weight.id, date: weight.date, kg: weight.kg };
    message.text = `${t.hook.events[change.event]}: ${formatAmount(weight.kg)} kg (${weight.date})`;
  } else if ('goal' in change) {
    const { goal } = change;
    message.goal = { id: goal.id, validFrom: goal.validFrom, ...macros(goal) };
    message.text = `${t.hook.events[change.event]}: ${formatNumber(goal.kcal)} kcal, ${t.n.protein} ${formatNumber(goal.protein)} g, ${t.n.carbs} ${formatNumber(goal.carbs)} g, ${t.n.fat} ${formatNumber(goal.fat)} g`;
  }
  message.content = message.text;
  return message;
}

/** Puts the message in the queue if the webhook is switched on. */
export async function enqueue(change: Change, database: AppDB = db, now = Date.now()): Promise<boolean> {
  if (!isActive(await getConfig(database))) return false;
  const message = await buildMessage(change, database, now);
  await database.outbox.add({ createdAt: now, attempts: 0, body: JSON.stringify(message) });

  const extra = (await database.outbox.count()) - MAX_QUEUE;
  if (extra > 0) await database.outbox.bulkDelete(await database.outbox.orderBy(':id').limit(extra).primaryKeys());
  return true;
}

const tails = new WeakMap<AppDB, Promise<unknown>>();

/**
 * Reports a change without the caller waiting for it. Several reports enter
 * the queue in the order they were called. Errors stop here:
 * no entry may fail because of the webhook.
 */
export function notify(change: Change | (() => Promise<Change | undefined>), database: AppDB = db): void {
  const now = Date.now();
  const next = (tails.get(database) ?? Promise.resolve())
    .then(async () => {
      const resolved = typeof change === 'function' ? await change() : change;
      if (resolved && (await enqueue(resolved, database, now))) void flush(database).catch(() => undefined);
    })
    .catch(() => undefined);
  tails.set(database, next);
}

export type SendResult = { ok: true; mode: 'cors' | 'simple'; unconfirmed: boolean } | { ok: false; error: string };

/**
 * Sends a message.
 *
 * First way: JSON with the chosen header. The target must allow requests from the browser
 * (CORS); in return the response is readable. Second way, only without a header: the same
 * text as a plain request, which the browser sends without asking the target first. It also
 * arrives at targets that do not know CORS, but their response stays unreadable.
 */
export async function send(
  config: WebhookConfig,
  mode: WebhookState['mode'],
  body: string,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  const url = config.url.trim();
  const headerName = config.headerName.trim();
  const base = { method: 'POST', body, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' } as const;

  const simple = async (): Promise<SendResult> => {
    try {
      await fetcher(url, { ...base, mode: 'no-cors', signal: AbortSignal.timeout(TIMEOUT) });
      return { ok: true, mode: 'simple', unconfirmed: true };
    } catch {
      return { ok: false, error: 'unreachable' };
    }
  };

  if (mode === 'simple' && headerName === '') return simple();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (headerName !== '') headers[headerName] = config.headerValue;
    const response = await fetcher(url, { ...base, mode: 'cors', headers, signal: AbortSignal.timeout(TIMEOUT) });
    return response.ok ? { ok: true, mode: 'cors', unconfirmed: false } : { ok: false, error: `HTTP ${response.status}` };
  } catch {
    // A custom header can only be sent along the first way.
    return headerName === '' ? simple() : { ok: false, error: 'unreachable' };
  }
}

/** Wait time after the nth failed attempt: 1, 2, 4 … minutes, at most one hour. */
export function backoff(attempts: number): number {
  return Math.min(60_000 * 2 ** (attempts - 1), 3_600_000);
}

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

const running = new WeakMap<AppDB, { run: Promise<void>; again: boolean }>();

/**
 * Sends the queue in order. At the first failure it stops, so the
 * order stays right; the next attempt follows after a growing wait time.
 * Only one pass runs at a time. A call made in the meantime triggers another pass afterwards,
 * so no message that arrived shortly before the end is left behind.
 */
export function flush(database: AppDB = db, fetcher: typeof fetch = fetch, clock: () => number = Date.now): Promise<void> {
  const active = running.get(database);
  if (active) {
    active.again = true;
    return active.run;
  }
  const slot = { again: false, run: Promise.resolve() };
  slot.run = (async () => {
    try {
      do {
        slot.again = false;
        await drain(database, fetcher, clock);
      } while (slot.again);
    } finally {
      running.delete(database);
    }
  })();
  running.set(database, slot);
  return slot.run;
}

async function drain(database: AppDB, fetcher: typeof fetch, clock: () => number): Promise<void> {
  for (;;) {
    const config = await getConfig(database);
    if (!isActive(config)) return;
    const head = await database.outbox.orderBy(':id').first();
    if (!head) return;
    if (clock() - head.createdAt > MAX_AGE || head.attempts >= MAX_ATTEMPTS) {
      await database.outbox.delete(head.seq!);
      continue;
    }
    const state = await getState(database);
    // Without a network no failed attempt is counted; it continues as soon as the connection is back.
    if ((state.retryAt && clock() < state.retryAt) || offline()) return;

    const result = await send(config, state.mode, head.body, fetcher);
    if (!result.ok) {
      const attempts = head.attempts + 1;
      await database.outbox.update(head.seq!, { attempts });
      await setState(database, { ...state, lastError: result.error, lastErrorAt: clock(), retryAt: clock() + backoff(attempts) });
      return;
    }
    await database.outbox.delete(head.seq!);
    await setState(database, { lastSentAt: clock(), unconfirmed: result.unconfirmed, mode: result.mode });
  }
}

/** Sends a test message right away, bypassing the queue, and probes the target again in the process. */
export async function sendTest(database: AppDB = db, fetcher: typeof fetch = fetch, clock: () => number = Date.now): Promise<SendResult> {
  const config = await getConfig(database);
  if (!validUrl(config.url) || !validHeader(config.headerName, config.headerValue)) return { ok: false, error: 'unreachable' };
  const body = JSON.stringify(await buildMessage({ event: 'test' }, database, clock()));
  const result = await send(config, undefined, body, fetcher);
  const state = await getState(database);
  await setState(
    database,
    result.ok
      ? { lastSentAt: clock(), unconfirmed: result.unconfirmed, mode: result.mode }
      : { ...state, lastError: result.error, lastErrorAt: clock() },
  );
  if (result.ok) void flush(database, fetcher, clock).catch(() => undefined);
  return result;
}

/** Drops the wait time and tries right away, for example when the network is back. */
export async function retryNow(database: AppDB = db): Promise<void> {
  const state = await getState(database);
  if (state.retryAt) await setState(database, { ...state, retryAt: undefined });
  await flush(database);
}

/** At start, when the network returns and regularly, check whether anything is waiting. */
export function startWebhook(): void {
  const attempt = () => void flush().catch(() => undefined);
  attempt();
  window.addEventListener('online', () => void retryNow().catch(() => undefined));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') attempt();
  });
  setInterval(attempt, 60_000);
}
