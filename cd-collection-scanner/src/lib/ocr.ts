import { createWorker, PSM } from 'tesseract.js';
import type { OCRDraft, PhotoFile } from './types';
import { uid, normalize, similarity } from './helpers';

export interface Region { x: number; y: number; width: number; height: number; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

/** Funzione pura: identifica confini di coste tramite picchi di discontinuità di luminanza. */
export function detectBoundaries(scores: number[], minWidth: number, maxRegions = 30): number[] {
  if (scores.length < 50) return [0, scores.length];
  const smoothed = scores.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(scores.length - 1, i + 2); j++) { sum += scores[j]; n++; }
    return sum / n;
  });
  const sorted = [...smoothed].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.50)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const threshold = median + Math.max(3, (high - median) * 0.35);
  const peaks: number[] = [];
  for (let i = minWidth; i < scores.length - minWidth; i++) {
    if (smoothed[i] < threshold || smoothed[i] < smoothed[i - 1] || smoothed[i] < smoothed[i + 1]) continue;
    if (peaks.length && i - peaks[peaks.length - 1] < minWidth) {
      if (smoothed[i] > smoothed[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
    } else peaks.push(i);
  }
  const result = [0, ...peaks, scores.length];
  const filtered = [0];
  for (const p of result.slice(1)) { if (p - filtered[filtered.length - 1] >= minWidth * 0.8) filtered.push(p); }
  if (filtered[filtered.length - 1] !== scores.length) filtered.push(scores.length);
  // Ricava al massimo maxRegions fessure, scartando gradualmente i confini meno forti.
  while (filtered.length > maxRegions + 1) {
    let weakest = 1;
    for (let i = 2; i < filtered.length - 1; i++) if (smoothed[filtered[i]] < smoothed[filtered[weakest]]) weakest = i;
    filtered.splice(weakest, 1);
  }
  return filtered;
}

export async function prepareCanvas(photo: PhotoFile): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = photo.objectUrl;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Immagine illeggibile')); });
  const rotated = photo.rotation === 90 || photo.rotation === 270;
  const sourceW = rotated ? image.naturalHeight : image.naturalWidth;
  const sourceH = rotated ? image.naturalWidth : image.naturalHeight;
  const scale = Math.min(1, 2100 / Math.max(sourceW, sourceH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceW * scale));
  canvas.height = Math.max(1, Math.round(sourceH * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((photo.rotation * Math.PI) / 180);
  ctx.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}
function columnGradient(canvas: HTMLCanvasElement): number[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const step = Math.max(1, Math.round(canvas.height / 350));
  const scores = Array(canvas.width).fill(0);
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 1; x < canvas.width; x++) {
      const p = (y * canvas.width + x) * 4;
      const q = p - 4;
      const l = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
      const r = data[q] * 0.299 + data[q + 1] * 0.587 + data[q + 2] * 0.114;
      scores[x] += Math.abs(l - r);
    }
  }
  return scores;
}
export function proposeRegions(canvas: HTMLCanvasElement): Region[] {
  const minW = Math.max(15, Math.floor(canvas.width / 85));
  const bounds = detectBoundaries(columnGradient(canvas), minW, 30);
  let regions = bounds.slice(0, -1).map((x, i) => ({ x, y: 0, width: bounds[i + 1] - x, height: canvas.height }))
    .filter(r => r.width >= minW && r.width <= canvas.width * 0.19 && r.height / r.width >= 2.0);
  if (regions.length < 3) {
    // Fallback: prova 10 settori. Non li cataloga senza OCR leggibile.
    const count = Math.min(10, Math.max(3, Math.floor(canvas.width / 24)));
    regions = Array.from({ length: count }, (_, i) => ({
      x: Math.floor(i * canvas.width / count), y: 0,
      width: Math.ceil(canvas.width / count), height: canvas.height
    }));
  }
  return regions;
}
function enhancedCrop(canvas: HTMLCanvasElement, b: Region, degrees: number): HTMLCanvasElement {
  const crop = document.createElement('canvas');
  const scale = clamp(70 / Math.min(b.width, b.height), 1.0, 4.0);
  crop.width = Math.round(b.width * scale);
  crop.height = Math.round(b.height * scale);
  const context = crop.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(canvas, b.x, b.y, b.width, b.height, 0, 0, crop.width, crop.height);
  const pixels = context.getImageData(0, 0, crop.width, crop.height);
  const grayscale = new Uint8Array(crop.width * crop.height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < grayscale.length; i++) {
    const q = i * 4;
    const v = Math.round(pixels.data[q] * .299 + pixels.data[q + 1] * .587 + pixels.data[q + 2] * .114);
    grayscale[i] = v; histogram[v]++;
  }
  const total = grayscale.length;
  let low = 0, high = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += histogram[i]; if (acc >= total * .04) { low = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += histogram[i]; if (acc >= total * .04) { high = i; break; } }
  const span = Math.max(20, high - low);
  for (let i = 0; i < grayscale.length; i++) {
    const v = clamp((grayscale[i] - low) * 255 / span, 0, 255);
    const x = i % crop.width, y = Math.floor(i / crop.width);
    const nearest = x > 0 && y > 0 && x < crop.width - 1 && y < crop.height - 1
      ? (grayscale[i-1] + grayscale[i+1] + grayscale[i-crop.width] + grayscale[i+crop.width]) / 4
      : grayscale[i];
    const edge = clamp(v * 1.25 - .25 * clamp((nearest - low) * 255 / span, 0, 255), 0, 255);
    const q = i * 4;
    pixels.data[q] = pixels.data[q + 1] = pixels.data[q + 2] = edge;
  }
  context.putImageData(pixels, 0, 0);
  if (!degrees) return crop;
  const turned = document.createElement('canvas');
  turned.width = degrees % 180 ? crop.height : crop.width;
  turned.height = degrees % 180 ? crop.width : crop.height;
  const c = turned.getContext('2d')!;
  c.translate(turned.width / 2, turned.height / 2);
  c.rotate(degrees * Math.PI / 180);
  c.drawImage(crop, -crop.width / 2, -crop.height / 2);
  return turned;
}
function parseSpine(text: string): { artist: string; album: string } {
  const clean = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  const split = clean.split(/\s+(?:[-–—|•:])\s+/);
  if (split.length >= 2 && split[0].length > 1 && split[1].length > 1) return { artist: split[0], album: split.slice(1).join(' - ') };
  return { artist: '', album: clean }; // mai indovinare un artista senza separatore
}
export function draftFromText(photoId: string, region: Region, text: string, confidence: number): OCRDraft {
  const parsed = parseSpine(text);
  return { id: uid(), photoId, bounds: region, text, confidence,
    artist: parsed.artist, album: parsed.album, candidates: [], editions: [],
    selectedMbid: '', selectedReleaseId: '', loading: false, error: '' };
}
export async function scanCanvas(
  canvas: HTMLCanvasElement, photoId: string, regions: Region[],
  onProgress: (n: number, total: number) => void
): Promise<OCRDraft[]> {
  const worker = await createWorker('eng', 1, { cacheMethod: 'write' });
  const result: OCRDraft[] = [];
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, preserve_interword_spaces: '1' });
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      const reads: Array<{ text: string; confidence: number }> = [];
      for (const angle of [90, 270, 0]) {
        const rendered = enhancedCrop(canvas, r, angle);
        const { data } = await worker.recognize(rendered);
        const text = data.text.trim().replace(/\s+/g, ' ');
        if (text.length >= 5 && /[A-Za-zÀ-ÿ]{3}/.test(text)) reads.push({ text, confidence: data.confidence });
      }
      const best = reads.sort((a, b) => (b.confidence + Math.min(20, b.text.length)) - (a.confidence + Math.min(20, a.text.length)))[0];
      if (best && best.confidence >= 22 && normalize(best.text).length >= 5 &&
        !result.some(d => similarity(d.text, best.text) >= .94)) {
        result.push(draftFromText(photoId, r, best.text, Math.round(best.confidence)));
      }
      onProgress(i + 1, regions.length);
    }
  } finally { await worker.terminate(); }
  return result;
}
export async function scanPhoto(photo: PhotoFile, onProgress: (n: number, total: number) => void) {
  const canvas = await prepareCanvas(photo);
  return scanCanvas(canvas, photo.id, proposeRegions(canvas), onProgress);
}
