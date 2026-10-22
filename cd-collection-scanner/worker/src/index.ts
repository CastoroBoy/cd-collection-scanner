interface Env { TRAWL_API_KEY: string; ALLOWED_ORIGIN: string; }
interface TrawlRecord {
  title?: unknown; sale_price?: unknown; date_sold?: unknown; condition_raw?: unknown; condition?: unknown;
  buying_format?: unknown; best_offer_available?: unknown; item_link?: unknown; item_id?: unknown;
  shipping_price?: unknown; details?: unknown;
}
const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
});
function originHeaders(request: Request, env: Env) {
  const origin = request.headers.get('Origin') || '';
  const permitted = origin === env.ALLOWED_ORIGIN || /^http:\/\/localhost:(5173|4173)$/.test(origin);
  return permitted ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept' } : null;
}
function allowedText(s: string) { return s.length > 0 && s.length <= 120 && !/[<>\r\n]/.test(s); }
function validEbayLink(value: string) {
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'www.ebay.co.uk' || u.hostname === 'www.ebay.com') && u.pathname.includes('/itm/'); }
  catch { return false; }
}
const strip = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function comparable(record: TrawlRecord, artist: string, album: string, edition: string) {
  const title = typeof record.title === 'string' ? strip(record.title) : '';
  if (!title || !/\bcd\b|\bcompact disc\b/.test(title)) return false;
  if (/\b(vinyl|vinile|cassette|dvd|vhs|blu ray|lp|lot|bundle|joblot|collection|boxset|box set|empty case|no disc|case only)\b/.test(title)) return false;
  const matches = (text: string) => {
    const tokens = strip(text).split(' ').filter(w => w.length > 2);
    return !tokens.length || tokens.filter(t => title.split(' ').includes(t)).length / tokens.length >= .8;
  };
  if (!matches(artist) || !matches(album)) return false;
  const version = /\b(remaster|remastered|deluxe|anniversary|expanded|reissue|special edition)\b/;
  if (version.test(title) !== version.test(strip(edition))) return false;
  return true;
}

/** Adattatore ufficiale eBay (Marketplace Insights) non incluso:
 * API Limited Release; non si chiamano endpoint finti e non si cerca su Browse (annunci attivi).
 * Questo adattatore usa Trawl e verifica il contratto documentato di /ebay/v1/sold.
 */
async function searchTrawl(artist: string, album: string, edition: string, env: Env) {
  if (!env.TRAWL_API_KEY) throw new Error('Chiave TRAWL_API_KEY non configurata');
  const q = `${artist} ${album} CD`.replace(/[^\p{L}\p{N} -]/gu, ' ').replace(/\s+/g, ' ').trim();
  const params = new URLSearchParams({ query: q, site: 'EBAY_GB', max_pages: '1' });
  const ctl = new AbortController(); const timeout = setTimeout(() => ctl.abort(), 16000);
  try {
    const response = await fetch(`https://api.trawl.dev/ebay/v1/sold?${params}`, {
      signal: ctl.signal, headers: { 'x-api-key': env.TRAWL_API_KEY, Accept: 'application/json' }
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('Quota Trawl esaurita o limite di richieste (429)');
      if ([500,502,503,504].includes(response.status)) throw new Error(`Servizio Trawl temporaneamente non disponibile (${response.status})`);
      throw new Error(`Provider vendite HTTP ${response.status}`);
    }
    const data = await response.json() as { site?: unknown; currency?: unknown; results?: unknown };
    if (data.site !== 'EBAY_GB' || data.currency !== 'GBP' || !Array.isArray(data.results))
      throw new Error('Risposta Trawl incompatibile con eBay GB');
    const unique = new Set<string>();
    const results = (data.results as TrawlRecord[]).filter(r => {
      if (!r || !comparable(r, artist, album, edition)) return false;
      if (typeof r.item_id !== 'string' || typeof r.item_link !== 'string' || !validEbayLink(r.item_link)) return false;
      if (!Number.isFinite(r.sale_price) || Number(r.sale_price) <= 0 || typeof r.date_sold !== 'string') return false;
      if (!/^\d{4}-\d{2}-\d{2}/.test(r.date_sold)) return false;
      // Trawl segnala che per le Best Offer il prezzo di ricerca può essere il prezzo annunciato.
      // Si preferisce perdere un risultato piuttosto che chiamarlo prezzo effettivo senza prova.
      if (r.best_offer_available !== false || /best offer/i.test(String(r.buying_format || ''))) return false;
      if (unique.has(r.item_id)) return false;
      unique.add(r.item_id);
      return true;
    }).slice(0, 3).map(r => ({
      itemId: r.item_id, title: r.title, amount: r.sale_price, soldAt: String(r.date_sold).slice(0,10),
      condition: String(r.condition_raw || r.condition || 'Non specificata'), url: r.item_link,
      shipping: typeof r.shipping_price === 'number' && r.shipping_price >= 0 ? r.shipping_price : null
    }));
    return { coverage: ['GB'], currency: 'GBP', results, checkedAt: new Date().toISOString(),
      note: 'Prezzi pubblicati per vendite effettive; Best Offer e prezzi incerti esclusi.' };
  } finally { clearTimeout(timeout); }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // /health è consultabile anche navigando direttamente all'URL; non espone alcuna chiave.
    if (new URL(request.url).pathname === '/health' && request.method === 'GET' && !request.headers.get('Origin'))
      return json({ ok: true, provider: 'trawl', coverage: ['GB'], automatic: Boolean(env.TRAWL_API_KEY) });
    const headers = originHeaders(request, env);
    if (!headers) return json({ error: 'Origine non autorizzata' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return json({ error: 'Metodo non supportato' }, 405, headers);
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, provider: 'trawl', coverage: ['GB'],
      automatic: Boolean(env.TRAWL_API_KEY) }, 200, headers);
    if (url.pathname !== '/sold') return json({ error: 'Endpoint non trovato' }, 404, headers);
    const artist = url.searchParams.get('artist')?.trim() || '';
    const album = url.searchParams.get('album')?.trim() || '';
    const edition = url.searchParams.get('edition')?.trim() || '';
    if (!allowedText(artist) || !allowedText(album) || edition.length > 100) return json({ error: 'Artista o album non validi (massimo 120 caratteri)' }, 400, headers);
    // La chiave non raggiunge mai il client. TTL limita ripetizioni; abilitare WAF/rate limit per un sito pubblico.
    const key = new Request(url.toString(), { method: 'GET' });
    const cache = caches.default;
    const stored = await cache.match(key);
    if (stored) { const response = new Response(stored.body, stored); Object.entries(headers).forEach(([k,v]) => response.headers.set(k, v)); return response; }
    try {
      const output = await searchTrawl(artist, album, edition, env);
      const body = json(output, 200, { ...headers, 'Cache-Control': 'public, max-age=0, s-maxage=21600' });
      // Salva nella cache edge indipendentemente dall'accesso del browser.
      ctx.waitUntil(cache.put(key, body.clone()));
      return body;
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'Errore provider', coverage: ['GB'] }, 502, headers);
    }
  }
} satisfies ExportedHandler<Env>;
