import type { MBCandidate, MBEdition } from './types';
import { similarity, safeDate } from './helpers';

// Coda condivisa: massimo una richiesta MusicBrainz ogni 1,2 secondi.
let tail: Promise<unknown> = Promise.resolve();
let lastCall = 0;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function fetchMB(path: string): Promise<any> {
  const run = async () => {
    const pause = Math.max(0, 1250 - (Date.now() - lastCall));
    if (pause) await delay(pause);
    lastCall = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 13000);
      try {
        const response = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
          headers: { Accept: 'application/json' }, signal: controller.signal
        });
        if ((response.status === 429 || response.status === 503) && attempt < 2) {
          await delay(1500 * (attempt + 1)); continue;
        }
        if (!response.ok) throw new Error(`MusicBrainz: HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        if (attempt === 2) throw error;
        await delay(700 * (attempt + 1));
      } finally { clearTimeout(timer); }
    }
    throw new Error('Impossibile leggere MusicBrainz');
  };
  const promise = tail.then(run, run);
  tail = promise.catch(() => undefined);
  return promise;
}
function quote(s: string) { return `"${s.replace(/[\\"]/g, '\\$&').replace(/[+!(){}\[\]^~*?:/|&-]/g, ' ').trim()}"`; }
interface RawRG { id: string; title: string; score?: number; disambiguation?: string; 'first-release-date'?: string;
  'artist-credit'?: Array<string | { name?: string; artist?: { name?: string } }> }
const artistName = (group: RawRG) => (group['artist-credit'] ?? [])
  .map(part => typeof part === 'string' ? part : (part.name ?? part.artist?.name ?? '')).join('').trim();
export async function searchAlbums(artist: string, album: string): Promise<MBCandidate[]> {
  if (!artist.trim() && !album.trim()) return [];
  const terms = artist.trim() && album.trim()
    ? `releasegroup:${quote(album)} AND artist:${quote(artist)}`
    : `releasegroup:${quote(album || artist)}`;
  const params = new URLSearchParams({ query: terms, fmt: 'json', limit: '12' });
  const data = await fetchMB(`release-group/?${params}`);
  let groups: RawRG[] = Array.isArray(data['release-groups']) ? data['release-groups'] : [];
  // Fallback controllato: il gruppo può avere indicizzazioni o punteggi troppo severi.
  if (!groups.length && artist && album) {
    const p = new URLSearchParams({ query: `releasegroup:${quote(album)}`, fmt: 'json', limit: '15' });
    const more = await fetchMB(`release-group/?${p}`);
    groups = Array.isArray(more['release-groups']) ? more['release-groups'] : [];
  }
  return groups.map(group => {
    const a = artistName(group);
    const text = similarity(album || artist, group.title);
    const person = artist ? similarity(artist, a) : 0;
    const score = Math.round((artist ? 0.53 * text + 0.47 * person : text) * 100);
    return { id: group.id, title: group.title, artist: a || 'Artista non specificato',
      firstReleaseDate: safeDate(group['first-release-date'] || ''), score,
      disambiguation: group.disambiguation, coverUrl: `https://coverartarchive.org/release-group/${group.id}/front-250` };
  }).filter(c => c.score >= 20).sort((a, b) => b.score - a.score).slice(0, 10);
}
/** Cerca possibili separazioni artista/album anche quando sulla costa non c'è un trattino. */
export async function searchSpineText(raw: string): Promise<MBCandidate[]> {
  const words = raw.trim().replace(/[\r\n]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 15);
  if (words.length < 3) return [];
  const all = new Map<string, MBCandidate>();
  const limit = Math.min(5, words.length - 2);
  for (let split = 1; split <= limit; split++) {
    const artist = words.slice(0, split).join(' ');
    const album = words.slice(split).join(' ');
    const candidates = await searchAlbums(artist, album);
    for (const c of candidates) {
      if ((all.get(c.id)?.score ?? -1) < c.score) all.set(c.id, c);
    }
    if (candidates[0] && candidates[0].score >= 97) break;
  }
  return [...all.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}

export async function findCDEditions(groupId: string): Promise<MBEdition[]> {
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) return [];
  const data = await fetchMB(`release/?${new URLSearchParams({ 'release-group': groupId, inc: 'media', limit: '100', fmt: 'json' })}`);
  const releases: any[] = Array.isArray(data.releases) ? data.releases : [];
  return releases.filter(r => Array.isArray(r.media) && r.media.some((m: any) => m.format === 'CD'))
    .map(r => ({ id: String(r.id), title: String(r.title), date: safeDate(r.date || ''),
      country: String(r.country ?? ''), format: 'CD', disambiguation: String(r.disambiguation ?? '') }))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
}

/** Ricerca delle edizioni pubblicate tramite EAN/UPC, non dei gruppi di album generici. */
export interface BarcodeMatch { candidate: MBCandidate; edition: MBEdition; barcode: string; }
interface RawRelease {
  id: string; title: string; date?: string; country?: string; barcode?: string;
  disambiguation?: string; media?: Array<{format?: string}>;
  'release-group'?: { id: string; title?: string; 'first-release-date'?: string };
  'artist-credit'?: RawRG['artist-credit'];
}
function formatIsCD(release: RawRelease): boolean {
  return !!release.media?.some(m => /^CD(?:$|\s)/i.test(m.format || ''));
}
function hasKnownNonCDFormat(release: RawRelease): boolean {
  return !!release.media?.length && !formatIsCD(release)
    && release.media.some(m => (m.format || '').trim().length > 0);
}
function asMatch(release: RawRelease, barcode: string): BarcodeMatch | null {
  const group = release['release-group'];
  if (!group?.id || !/^[0-9a-f-]{36}$/i.test(group.id) || hasKnownNonCDFormat(release)) return null;
  const title = (group.title || release.title || '').trim();
  const artist = artistName({ id: group.id, title, 'artist-credit': release['artist-credit'] });
  return {
    barcode,
    candidate: { id: group.id, title, artist: artist || 'Artista non specificato',
      firstReleaseDate: safeDate(group['first-release-date'] || release.date || ''),
      score: 100, coverUrl: 'https://coverartarchive.org/release-group/' + group.id + '/front-250' },
    edition: { id: release.id, title: release.title || title,
      date: safeDate(release.date || ''), country: String(release.country || ''),
      format: formatIsCD(release) ? 'CD' : 'Non verificato',
      disambiguation: String(release.disambiguation || '') }
  };
}
export async function searchBarcodeReleases(code: string): Promise<BarcodeMatch[]> {
  const { barcodeVariants, normalizedBarcode } = await import('./barcode');
  const variants = barcodeVariants(code);
  if (!variants.length) return [];
  const matches = new Map<string, BarcodeMatch>();
  for (const variant of variants) {
    const params = new URLSearchParams({ query: 'barcode:' + variant, fmt: 'json', limit: '30' });
    const data = await fetchMB('release/?' + params);
    const releases = (Array.isArray(data.releases) ? data.releases : []) as RawRelease[];
    for (const original of releases.slice(0, 20)) {
      if (!original?.id) continue;
      // Evita risultati con barcode diverso. Le varianti UPC/EAN sono considerate equivalenti.
      if (original.barcode && !variants.includes(normalizedBarcode(original.barcode))) continue;
      let release = original;
      if (!release['release-group']?.id || !release.media?.length) {
        try {
          release = await fetchMB('release/' + original.id + '?' + new URLSearchParams({
            inc: 'release-groups+media+artists', fmt: 'json'
          })) as RawRelease;
        } catch { /* I dati indicizzati sono comunque disponibili. */ }
      }
      const match = asMatch(release, variant);
      if (match) matches.set(match.edition.id, match);
      if (matches.size >= 12) break;
    }
    if (matches.size) break;
  }
  return [...matches.values()].sort((a, b) =>
    Number(b.edition.format === 'CD') - Number(a.edition.format === 'CD')
    || b.edition.date.localeCompare(a.edition.date));
}
