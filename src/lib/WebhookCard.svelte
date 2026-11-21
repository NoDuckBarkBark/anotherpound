<script lang="ts">
  import { formatMoment } from './dates';
  import { db } from './db';
  import { live } from './live.svelte';
  import { t } from './texts';
  import { flush, getConfig, getState, saveConfig, sendTest, validHeader, validUrl, type WebhookState } from './webhook';

  /** Outgoing webhook: address, switch, header, test and send state. */
  let url = $state('');
  let enabled = $state(false);
  let headerName = $state('');
  let headerValue = $state('');
  let testing = $state(false);

  void getConfig().then((stored) => {
    url = stored.url;
    enabled = stored.enabled;
    headerName = stored.headerName;
    headerValue = stored.headerValue;
  });

  const status = live(
    () => 0,
    async () => ({ state: await getState(), waiting: await db.outbox.count() }),
    { state: {} as WebhookState, waiting: 0 },
  );
  const sent = $derived(status.value.state.lastSentAt);
  const failed = $derived(status.value.state.lastError);

  const urlOk = $derived(url.trim() === '' ? !enabled : validUrl(url));
  const headerOk = $derived(validHeader(headerName, headerValue));
  const usable = $derived(validUrl(url) && headerOk);

  async function save() {
    await saveConfig({ url: url.trim(), enabled, headerName: headerName.trim(), headerValue });
    void flush().catch(() => undefined);
  }

  async function test() {
    if (!usable || testing) return;
    testing = true;
    try {
      await save();
      await sendTest();
    } finally {
      testing = false;
    }
  }
</script>

<section class="card">
  <div class="row">
    <h2>{t.hook.title}</h2>
    <input class="switch" type="checkbox" role="switch" aria-label={t.hook.title} bind:checked={enabled} onchange={save} />
  </div>

  <label class="field">
    <span class="field-label">{t.hook.url}</span>
    <input
      type="url"
      inputmode="url"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      placeholder="https://"
      aria-invalid={!urlOk || undefined}
      bind:value={url}
      onchange={save}
    />
  </label>

  <div class="grid2 pair">
    <label>
      <span class="field-label">{t.hook.headerName}</span>
      <input
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-invalid={!headerOk || undefined}
        bind:value={headerName}
        onchange={save}
      />
    </label>
    <label>
      <span class="field-label">{t.hook.headerValue}</span>
      <!-- Deliberately not a password field: next to the name field it would look like a login to the browser,
           and it would offer to save the secret in its password storage. -->
      <input
        class="secret"
        type="text"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        aria-invalid={!headerOk || undefined}
        bind:value={headerValue}
        onchange={save}
      />
    </label>
  </div>

  <div class="row foot">
    <dl>
      {#if sent}
        <div>
          <dt>{t.hook.lastSent}</dt>
          <dd>{formatMoment(sent)}{status.value.state.unconfirmed ? ` · ${t.hook.unconfirmed}` : ''}</dd>
        </div>
      {/if}
      {#if status.value.waiting}
        <div>
          <dt>{t.hook.waiting}</dt>
          <dd>{status.value.waiting}</dd>
        </div>
      {/if}
      {#if failed}
        <div>
          <dt>{t.hook.lastError}</dt>
          <dd>
            {failed === 'unreachable' ? t.hook.unreachable : failed}{status.value.state.lastErrorAt
              ? ` · ${formatMoment(status.value.state.lastErrorAt)}`
              : ''}
          </dd>
        </div>
      {/if}
    </dl>
    <button type="button" onclick={test} disabled={!usable || testing}>{t.hook.test}</button>
  </div>
</section>

<style>
  .field {
    display: block;
    margin-top: 10px;
  }

  .pair {
    margin-top: 10px;
  }

  .secret {
    -webkit-text-security: disc;
  }

  .foot {
    align-items: flex-end;
    margin-top: 12px;
  }

  dl {
    margin: 0;
    min-width: 0;
    font-size: 14px;
  }

  dl div {
    display: flex;
    flex-wrap: wrap;
    gap: 0 6px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
  }

  button {
    flex: none;
  }
</style>
