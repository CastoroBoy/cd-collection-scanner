import type { CdItem, Marketplace, PriceSearchResult, SoldSale } from './types';
import { money, normalize, similarity, today, uid } from './helpers';

const ENDPOINT = String(import.meta.env.VITE_PRICE_API_URL || '').replace(/\/+$/, '');
export const automaticPriceEnabled = Boolean(ENDPOINT);
export const automaticCoverage: Marketplace[] = ['GB'];

function compatibleTitle(cd: CdItem, title: string): boolean {
  const name = normalize(title);
  if (!name) return false;
  if (/\b(vinyl|vinile|lp|33rpm|45rpm|cassette|cassetta|tape|vhs|dvd|blu ray|book|poster|empty case|no disc|case only)\b/i.test(name)) return false;
  if (/\b(lot|bundle|joblot|collection|assorted|mixed cds|various albums|box set|boxset|set of|lotto|sammlung|lot de cds)\b/i.test(name)) return false;
  if (!/\bcd\b|\bcompact disc\b|\bcdrom\b/i.test(name)) return false;
  const artistWords = normalize(cd.artist).split(' ').filter(w => w.length > 2);
  const albumWords = normalize(cd.album).split(' ').filter(w => w.length > 2);
  const contains = (words: string[]) => !words.length || words.filter(w => new RegExp(`\\b${w}\\b`).test(name)).length / words.length >= .8;
  if (!contains(artistWords) || !contains(albumWords)) return false;
  const versionMarkers = /\b(remaster|remastered|deluxe|anniversary|expanded|special edition|reissue|repress)\b/;
  const expectedEdition = normalize(cd.editionNote);
  if (versionMarkers.test(name) && !versionMarkers.test(expectedEdition)) return false;
  if (versionMarkers.test(expectedEdition) && !versionMarkers.test(name)) return false;
  return true;
}
export function validateSales(cd: CdItem, incoming: SoldSale[]): SoldSale[] {
  const seen = new Set<string>();
  return incoming.filter(s => {
    if (!Number.isFinite(s.amount) || s.amount <= 0 || !s.soldAt || !s.url || !compatibleTitle(cd, s.listingTitle)) return false;
    if (!['IT','DE','FR','ES','GB'].includes(s.marketplace)) return false;
    if (s.provider === 'trawl' && s.marketplace !== 'GB') return false;
    const key = `${s.marketplace}-${s.id || s.url}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => b.soldAt.localeCompare(a.soldAt)).slice(0, 3);
}

const cache = new Map<string, { rate: number; date: string; savedAt: number }>();
export async function fxToEur(currency: string): Promise<{ rate: number; date: string } | undefined> {
  if (currency === 'EUR') return { rate: 1, date: today().slice(0, 10) };
  const existing = cache.get(currency);
  if (existing && Date.now() - existing.savedAt < 86_400_000) return existing;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9500);
    try {
      const response = await fetch(`https://api.frankfurter.dev/v2/rate/${encodeURIComponent(currency)}/eur`, { signal: controller.signal });
      if (!response.ok) return undefined;
      const data = await response.json();
      if (!Number.isFinite(data.rate) || data.rate <= 0 || typeof data.date !== 'string') return undefined;
      const value = { rate: data.rate as number, date: data.date as string, savedAt: Date.now() };
      cache.set(currency, value);
      return value;
    } finally { clearTimeout(timer); }
  } catch { return undefined; }
}

async function retryFetch(url: string) {
  let lastError: Error = new Error('Connessione non riuscita');
  for (let n = 0; n < 3; n++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 18_000);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if ([429, 502, 503, 504].includes(res.status) && n < 2) {
        await new Promise(r => setTimeout(r, 700 * (n + 1))); continue;
      }
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`Servizio prezzi HTTP ${res.status}: ${msg.slice(0, 140)}`);
      }
      return res;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Errore sconosciuto');
      if (n < 2) await new Promise(r => setTimeout(r, 850 * (n + 1)));
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

export async function searchSold(cd: CdItem, requested: Marketplace[]): Promise<PriceSearchResult> {
  if (!automaticPriceEnabled) throw new Error('Servizio prezzi automatico non configurato. Usa la ricerca assistita.');
  const enabled = requested.filter(m => automaticCoverage.includes(m));
  if (!enabled.length) throw new Error('Il provider configurato copre soltanto eBay Regno Unito (GB).');
  if (!cd.artist.trim() || !cd.album.trim()) throw new Error('Indicare artista e album prima della ricerca.');
  const params = new URLSearchParams({ artist: cd.artist, album: cd.album, edition: cd.editionNote });
  const res = await retryFetch(`${ENDPOINT}/sold?${params}`);
  const data = await res.json();
  if (!Array.isArray(data.results) || data.coverage?.[0] !== 'GB') throw new Error('Risposta del provider non valida');
  const rate = await fxToEur('GBP');
  const sales: SoldSale[] = data.results.map((r: any) => {
    const amount = Number(r.amount);
    return {
      id: String(r.itemId), amount, currency: 'GBP',
      ...(rate ? { eurAmount: Number((amount * rate.rate).toFixed(2)), rateToEur: rate.rate, rateDate: rate.date } : {}),
      soldAt: String(r.soldAt), marketplace: 'GB' as const, listingTitle: String(r.title),
      condition: String(r.condition ?? 'Non specificata'), url: String(r.url),
      shippingAmount: r.shipping === null || r.shipping === undefined ? undefined : Number(r.shipping),
      provider: 'trawl' as const, checkedAt: String(data.checkedAt || today()),
      priceNote: 'Vendita registrata da Trawl; prezzo pubblicato per la vendita, escluse offerte accettate non verificabili.'
    };
  });
  return { sales: validateSales(cd, sales), checkedAt: String(data.checkedAt || today()), coverage: ['GB'] };
}
export async function manualSale(
  cd: CdItem, input: { amount: number; currency: string; soldAt: string; marketplace: Marketplace;
    title: string; condition: string; url: string; shipping?: number }
): Promise<SoldSale> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Inserisci un importo valido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.soldAt) || Number.isNaN(Date.parse(input.soldAt)) || input.soldAt > today().slice(0, 10)) throw new Error('Inserisci una data di vendita valida.');
  let url: URL;
  try { url = new URL(input.url); } catch { throw new Error('URL della vendita non valido.'); }
  const host = url.hostname.toLowerCase();
  if (!(/^(www\.)?ebay\.(it|de|fr|es|co\.uk|com)$/.test(host)) || !/^https:$/.test(url.protocol))
    throw new Error('È richiesto un collegamento HTTPS a una vendita eBay.');
  if (!url.pathname.includes('/itm/')) throw new Error('Inserisci il collegamento alla singola inserzione eBay (/itm/...), non una pagina di ricerca.');
  if (!input.title.trim() || !compatibleTitle(cd, input.title))
    throw new Error('Il titolo dell’inserzione deve identificare artista, album e formato CD senza lotti o edizioni incompatibili.');
  const allowedCurrency = input.marketplace === 'GB' ? 'GBP' : 'EUR';
  if (input.currency !== allowedCurrency) throw new Error(`Per questo marketplace usa ${allowedCurrency}.`);
  const rate = await fxToEur(input.currency);
  const sale: SoldSale = { id: uid(), amount: input.amount, currency: input.currency,
    ...(rate ? { eurAmount: Number((input.amount * rate.rate).toFixed(2)), rateToEur: rate.rate, rateDate: rate.date } : {}),
    soldAt: input.soldAt, marketplace: input.marketplace, listingTitle: input.title.trim(),
    condition: input.condition.trim() || 'Non indicata', url: url.href, shippingAmount: input.shipping,
    provider: 'manuale', checkedAt: today(), priceNote: 'Vendita verificata e dichiarata manualmente dall’utente.' };
  return sale;
}
export const priceLabel = (s: SoldSale) => saleValueText(s);
function saleValueText(s: SoldSale) { return s.currency === 'EUR' ? money(s.amount) : s.eurAmount !== undefined ? money(s.eurAmount) : money(s.amount, s.currency); }
