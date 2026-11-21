<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { normalizeBarcode, StableReader } from './ean';
  import { detectIn, getDetector } from './scanner';
  import { t } from './texts';

  /**
   * Barcode scanner: the camera starts on opening. Alongside it there is always the choice
   * of an image file and typing the number by hand.
   */
  let { oncode }: { oncode: (code: string) => void } = $props();

  let video = $state<HTMLVideoElement>();
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  const reader = new StableReader();

  let running = $state(false);
  let torchAvailable = $state(false);
  let torchOn = $state(false);
  let message = $state('');
  let typed = $state('');

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      message = t.scanner.noCamera;
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
    } catch {
      message = t.scanner.noCamera;
      return;
    }
    if (!alive || !video) {
      stop();
      return;
    }
    running = true;
    video.srcObject = stream;
    await video.play().catch(() => {});

    const capabilities = stream.getVideoTracks()[0]?.getCapabilities?.() as { torch?: boolean } | undefined;
    torchAvailable = Boolean(capabilities?.torch);
    try {
      await getDetector();
    } catch {
      stop();
      message = t.scanner.noCode;
      return;
    }
    scan();
  }

  async function scan() {
    if (!running || !video) return;
    try {
      if (video.readyState >= 2) {
        const hit = await detectIn(video);
        const stable = reader.push(hit?.code ?? null);
        if (stable) {
          stop();
          oncode(stable);
          return;
        }
      }
    } catch (error) {
      console.error(error);
    }
    timer = setTimeout(scan, 120);
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    torchOn = false;
    torchAvailable = false;
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    torchOn = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: torchOn } as MediaTrackConstraintSet] });
    } catch {
      torchOn = false;
    }
  }

  async function fromImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    message = '';
    try {
      const bitmap = await createImageBitmap(file);
      const hit = await detectIn(bitmap);
      bitmap.close();
      if (hit) {
        stop();
        oncode(hit.code);
      } else {
        message = t.scanner.noCode;
      }
    } catch {
      message = t.scanner.noCode;
    }
  }

  function fromNumber(event: SubmitEvent) {
    event.preventDefault();
    const normalized = normalizeBarcode(typed);
    if (!normalized) {
      message = t.scanner.invalid;
      return;
    }
    stop();
    oncode(normalized);
  }

  onMount(() => {
    void start();
  });

  onDestroy(() => {
    alive = false;
    stop();
  });
</script>

<h2>{t.scanner.title}</h2>

<div class="view" class:on={running}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} playsinline muted></video>
</div>

<p class="message" aria-live="polite">{message}</p>

<div class="actions">
  {#if torchAvailable}
    <button type="button" aria-pressed={torchOn} onclick={toggleTorch}>{t.scanner.torch}</button>
  {/if}
  <label class="button">
    {t.scanner.image}
    <input class="visually-hidden" type="file" accept="image/*" onchange={fromImage} />
  </label>
</div>

<form class="number" onsubmit={fromNumber}>
  <input
    type="text"
    inputmode="numeric"
    autocomplete="off"
    aria-label={t.scanner.number}
    placeholder={t.scanner.number}
    bind:value={typed}
    oninput={() => (message = '')}
  />
  <button type="submit">{t.scanner.search}</button>
</form>

<style>
  h2 {
    margin-bottom: 12px;
  }

  .view {
    display: none;
    aspect-ratio: 4 / 3;
    background: #000;
    border-radius: var(--radius);
    overflow: hidden;
    margin-bottom: 12px;
  }

  .view.on {
    display: block;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .message {
    margin-bottom: 12px;
    color: var(--muted);
  }

  .message:empty {
    display: none;
  }

  .actions,
  .number {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
  }

  .actions > * {
    flex: 1;
  }

  .number {
    margin-bottom: 0;
  }

  button[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
