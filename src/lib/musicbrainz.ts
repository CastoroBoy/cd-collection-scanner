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
