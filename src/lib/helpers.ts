import type { CdItem, Marketplace, SoldSale } from './types';
export const uid = () => crypto.randomUUID();
export const today = () => new Date().toISOString();
export const normalize = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const keyFor = (c: Pick<CdItem, 'artist' | 'album' | 'releaseId' | 'editionNote'>): string =>
  [normalize(c.artist), normalize(c.album), c.releaseId || normalize(c.editionNote)].join('::');
export function equivalent(a: CdItem, b: CdItem): boolean {
  if (normalize(a.artist) !== normalize(b.artist) || normalize(a.album) !== normalize(b.album)) return false;
  if (a.releaseId && b.releaseId) return a.releaseId === b.releaseId;
  if (a.editionNote && b.editionNote) return normalize(a.editionNote) === normalize(b.editionNote);
  return true; // un'edizione sconosciuta non deve creare un duplicato della stessa foto
}
export function uniqueCds(items: CdItem[]): CdItem[] {
  const result: CdItem[] = [];
  for (const item of items) { if (!result.some(existing => equivalent(existing, item))) result.push(item); }
  return result;
}
export const marketplaces: { code: Marketplace; label: string; host: string }[] = [
  { code: 'IT', label: 'Italia', host: 'www.ebay.it' },
  { code: 'DE', label: 'Germania', host: 'www.ebay.de' },
  { code: 'FR', label: 'Francia', host: 'www.ebay.fr' },
  { code: 'ES', label: 'Spagna', host: 'www.ebay.es' },
  { code: 'GB', label: 'Regno Unito', host: 'www.ebay.co.uk' }
];
export const money = (value: number | undefined, code = 'EUR') => value === undefined || !Number.isFinite(value)
  ? 'N.D.' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: code }).format(value);
export const dateDisplay = (date: string) => date ? /^\d{4}$/.test(date) ? date : /^\d{4}-\d{2}$/.test(date) ? date : new Date(date.length <= 10 ? `${date}T12:00:00` : date).toLocaleDateString('it-IT') : 'N.D.';
export const saleValue = (s: SoldSale): number | undefined => s.currency === 'EUR' ? s.amount : s.eurAmount;
export function estimate(items: CdItem[]) {
  const eligible = items.filter(c => c.sales.some(s => saleValue(s) !== undefined));
  const values = eligible.map(c => {
    const amounts = c.sales.map(saleValue).filter((v): v is number => v !== undefined && Number.isFinite(v));
    return amounts.reduce((x, y) => x + y, 0) / amounts.length;
  });
  return { total: values.reduce((a, b) => a + b, 0), included: values.length, excluded: items.length - values.length };
}
export function soldSearchUrl(c: Pick<CdItem, 'artist' | 'album'>, market: Marketplace) {
  const host = marketplaces.find(m => m.code === market)?.host ?? 'www.ebay.it';
  const q = `${c.artist} ${c.album} CD`.trim();
  return `https://${host}/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1`;
}
export function similarity(a: string, b: string): number {
  const x = normalize(a), y = normalize(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  const ax = new Set(x.split(' ')), by = new Set(y.split(' '));
  const common = [...ax].filter(w => by.has(w)).length;
  return (2 * common) / (ax.size + by.size);
}
export const safeDate = (s: string) => /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) ? s : '';
