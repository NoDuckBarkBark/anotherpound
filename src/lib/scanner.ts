import { normalizeBarcode } from './ean';

/**
 * Barcode detection behind a narrow interface.
 * Chrome on Android ships the detection; everywhere else zxing-wasm
 * is loaded on demand, from our own deployment, not from a third-party server.
 */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

interface RawDetection {
  rawValue: string;
  format: string;
}

interface Detector {
  detect(source: ImageBitmapSource): Promise<RawDetection[]>;
}

interface NativeDetectorClass {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

export type Engine = 'native' | 'wasm';

export interface Detected {
  code: string;
  format: string;
}

let ready: Promise<{ detector: Detector; engine: Engine }> | null = null;

/** The browser's built-in detection, if it reads all required formats. */
async function nativeClass(): Promise<NativeDetectorClass | undefined> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Native) return undefined;
  try {
    const supported = await Native.getSupportedFormats();
    return FORMATS.every((f) => supported.includes(f)) ? Native : undefined;
  } catch {
    // Interface present but not usable: continue with the fallback.
    return undefined;
  }
}

/** Which detection this device will use, without loading the fallback for it. */
export async function scannerEngine(): Promise<Engine> {
  return (await nativeClass()) ? 'native' : 'wasm';
}

async function create(): Promise<{ detector: Detector; engine: Engine }> {
  const Native = await nativeClass();
  if (Native) return { detector: new Native({ formats: [...FORMATS] }), engine: 'native' };

  const [ponyfill, wasm] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  ponyfill.prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path),
    },
  });
  return { detector: new ponyfill.BarcodeDetector({ formats: [...FORMATS] }), engine: 'wasm' };
}

export function getDetector(): Promise<{ detector: Detector; engine: Engine }> {
  ready ??= create().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

/** Looks for a valid food barcode in an image or video frame. */
export async function detectIn(source: ImageBitmapSource): Promise<Detected | null> {
  const { detector } = await getDetector();
  for (const hit of await detector.detect(source)) {
    const code = normalizeBarcode(hit.rawValue, hit.format);
    if (code) return { code, format: hit.format };
  }
  return null;
}
