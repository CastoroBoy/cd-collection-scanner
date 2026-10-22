import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

/** EAN-8, UPC-A, EAN-13, GTIN-14 con cifra di controllo obbligatoria. */
export function validBarcode(value: string): boolean {
  if (!/^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$/.test(value)) return false;
  let sum = 0;
  let weight = 3;
  for (let i = value.length - 2; i >= 0; i--) {
    sum += Number(value[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - sum % 10) % 10 === Number(value[value.length - 1]);
}

export function normalizedBarcode(value: string): string {
  return value.replace(/[\s-]/g, '');
}

/** I codici UPC-A vengono talvolta salvati su MusicBrainz come EAN-13 con zero iniziale. */
export function barcodeVariants(code: string): string[] {
  const digits = normalizedBarcode(code);
  if (!validBarcode(digits)) return [];
  return [...new Set([digits, ...(digits.length === 12 ? ['0' + digits] : []),
    ...(digits.length === 13 && digits.startsWith('0') ? [digits.slice(1)] : [])])];
}

function rotatedCanvas(source: HTMLCanvasElement, angle: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const sideways = angle % 180 !== 0;
  c.width = sideways ? source.height : source.width;
  c.height = sideways ? source.width : source.height;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(angle * Math.PI / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return c;
}
function lowerCrop(source: HTMLCanvasElement): HTMLCanvasElement {
  const y = Math.round(source.height * .48), height = source.height - y;
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = height;
  c.getContext('2d')!.drawImage(source, 0, y, source.width, height, 0, 0, source.width, height);
  return c;
}

interface NativeDetector {
  detect(image: HTMLCanvasElement): Promise<Array<{rawValue: string}>>;
}
type DetectorConstructor = new (args: { formats: string[] }) => NativeDetector;

export async function detectBarcode(canvas: HTMLCanvasElement): Promise<string | null> {
  const native = (globalThis as typeof globalThis & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  const candidates = [canvas, lowerCrop(canvas), rotatedCanvas(canvas, 180)];
  if (native) {
    try {
      const detector = new native({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      for (const image of candidates) {
        for (const result of await detector.detect(image)) {
          const code = normalizedBarcode(result.rawValue);
          if (validBarcode(code)) return code;
        }
      }
    } catch { /* Alcuni browser espongono BarcodeDetector senza supporto EAN: passa a ZXing. */ }
  }
  const hints = new Map<DecodeHintType, BarcodeFormat[]>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E
  ]);
  const reader = new BrowserMultiFormatReader(hints);
  for (const image of [...candidates, rotatedCanvas(canvas, 90), rotatedCanvas(canvas, 270)]) {
    try {
      const decoded = await reader.decodeFromCanvas(image);
      const code = normalizedBarcode(decoded.getText());
      if (validBarcode(code)) return code;
    } catch { /* prova la rotazione o il ritaglio successivo */ }
  }
  return null;
}

export async function loadBackImage(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Impossibile leggere la fotografia.'));
    });
    const scale = Math.min(1, 3200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
