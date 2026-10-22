import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp, BadgeCheck, BookOpen, CircleHelp, Database, Download, FileJson, HardDriveDownload,
  Music2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload, Wallet, X
} from 'lucide-react';
import PhotoScanner from './components/PhotoScanner';
import type { ScannerActions } from './components/PhotoScanner';
import ReviewDrawer from './components/ReviewDrawer';
import PricePanel from './components/PricePanel';
import type { CdItem, MBCandidate, Marketplace, OCRDraft, PriceProgress, SoldSale } from './lib/types';
import { dateDisplay, estimate, equivalent, marketplaces, money, normalize, saleValue, today, uid, uniqueCds } from './lib/helpers';
import { readCollection, writeCollection } from './lib/storage';
import { exportCSV, exportJSON, exportXLSX, parseBackup } from './lib/export';
import { findCDEditions, searchAlbums, searchSpineText } from './lib/musicbrainz';
import { automaticCoverage, automaticPriceEnabled, priceLabel, searchSold } from './lib/prices';

type SortField = 'artist' | 'album' | 'date' | 'price';
function meanPrice(cd: CdItem): number | undefined {
  const values = cd.sales.map(saleValue).filter((n): n is number => n !== undefined && Number.isFinite(n));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}
function makeItem(d: OCRDraft): CdItem {
  const choice = d.candidates.find(c => c.id === d.selectedMbid);
  const edition = d.editions.find(e => e.id === d.selectedReleaseId);
  const now = today();
  return {
    id: uid(), artist: choice?.artist || d.artist.trim(), album: choice?.title || d.album.trim(),
    firstReleaseDate: choice?.firstReleaseDate || '', editionDate: edition?.date || '',
    editionCountry: edition?.country || '', editionNote: edition?.disambiguation || '',
    mbid: choice?.id || '', releaseId: edition?.id || '',
    ocrText: d.text, ocrConfidence: d.confidence, confidence: choice ? 'confermato' : 'incerto',
    sales: [], lastPriceCheck: '', lastMusicCheck: choice ? now : '', createdAt: now, updatedAt: now
  };
}
export default function App() {
  const [items, setItems] = useState<CdItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [saveStatus, setSaveStatus] = useState('Caricamento archivio…');
  const [drafts, setDrafts] = useState<OCRDraft[]>([]);
  const draftsRef = useRef<OCRDraft[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [priceId, setPriceId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [markets, setMarkets] = useState<Marketplace[]>(['IT','DE','FR','ES','GB']);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('artist');
  const [sortAsc, setSortAsc] = useState(true);
  const [progress, setProgress] = useState<PriceProgress | null>(null);
  const [busyPrices, setBusyPrices] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const scanner = useRef<ScannerActions>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const writing = useRef<Promise<void>>(Promise.resolve());
  const itemsRef = useRef<CdItem[]>([]);
  const stats = useMemo(() => estimate(items), [items]);
  const selectedCd = items.find(c => c.id === selectedId);
  const priceCd = items.find(c => c.id === priceId) || null;
  const mostRecent = items.map(c => c.lastPriceCheck).filter(Boolean).sort().at(-1) || '';
  const priced = items.filter(c => c.sales.length > 0).length;
  const visible = useMemo(() => items.filter(c => normalize(`${c.artist} ${c.album} ${c.editionNote}`).includes(normalize(query))).sort((a, b) => {
    let result = 0;
    if (sortBy === 'artist') result = a.artist.localeCompare(b.artist, 'it', { sensitivity: 'base' }) || a.album.localeCompare(b.album, 'it');
    if (sortBy === 'album') result = a.album.localeCompare(b.album, 'it', { sensitivity: 'base' });
    if (sortBy === 'date') result = (a.firstReleaseDate || '9999').localeCompare(b.firstReleaseDate || '9999');
    if (sortBy === 'price') result = (meanPrice(a) ?? Infinity) - (meanPrice(b) ?? Infinity);
    return sortAsc ? result : -result;
  }), [items, query, sortBy, sortAsc]);

  function show(text: string) { setNotice(text); }
  function save(snapshot: CdItem[]) {
    setSaveStatus('Salvataggio…');
    writing.current = writing.current.catch(() => {}).then(() => writeCollection(snapshot)).then(() => setSaveStatus(`Salvato in locale · ${new Date().toLocaleTimeString('it-IT')}`))
      .catch(e => { setSaveStatus('Errore salvataggio'); show(`IndexedDB: ${String(e)}`); });
    return writing.current;
  }
  useEffect(() => {
    readCollection().then(data => { setItems(data); itemsRef.current = data; setLoaded(true); setSaveStatus('Archivio locale caricato'); })
      .catch(e => { setLoaded(true); setSaveStatus('Archivio non disponibile'); show(`Salvataggio locale non disponibile: ${String(e)}`); });
  }, []);
  useEffect(() => { itemsRef.current = items; if (loaded) void save(items); }, [items, loaded]);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);
  function editDraft(id: string, patch: Partial<OCRDraft>) { setDrafts(ds => ds.map(d => d.id === id ? { ...d, ...patch } : d)); }
  function addDrafts(newDrafts: OCRDraft[]) {
    setDrafts(current => [...current, ...newDrafts.filter(d => !current.some(old => old.text === d.text && old.photoId === d.photoId))]);
    setReviewOpen(true);
    // Ricerca metadata automatica soltanto quando artista e album sono distinguibili nel testo.
    const toLookup = newDrafts.filter(d => d.album && d.confidence >= 45).slice(0, 20);
    void (async () => { for (const draft of toLookup) {
      try {
        const results = draft.artist ? await searchAlbums(draft.artist, draft.album) : await searchSpineText(draft.album);
        const best = results[0];
        const other = results[1];
        const latest = draftsRef.current.find(d => d.id === draft.id);
        const stillUnchanged = latest && latest.artist === draft.artist && latest.album === draft.album;
        if (!stillUnchanged) continue;
        // Auto-conferma solo un match inequivocabile con OCR alto e almeno un'edizione fisica CD.
        if (draft.confidence >= 88 && best && best.score >= 98 && (!other || other.score <= 78)) {
          let editions = [] as Awaited<ReturnType<typeof findCDEditions>>;
          try { editions = await findCDEditions(best.id); } catch { /* conferma manuale */ }
          if (editions.length && draftsRef.current.some(d => d.id === draft.id && d.artist === draft.artist && d.album === draft.album)) {
            const resolved = makeItem({ ...draft, candidates: results, selectedMbid: best.id });
            setItems(prev => prev.some(c => equivalent(c, resolved)) ? prev : [...prev, resolved]);
            setDrafts(prev => prev.filter(d => d.id !== draft.id));
            setSelectedId(resolved.id);
            continue;
          }
        }
        const confidentSplit = Boolean(best && best.score >= 92 && (!other || best.score - other.score >= 8));
        setDrafts(previous => previous.map(d => d.id === draft.id && d.artist === draft.artist && d.album === draft.album
          ? { ...d, candidates: results, artist: !d.artist && confidentSplit && best ? best.artist : d.artist,
              album: !d.artist && confidentSplit && best ? best.title : d.album } : d));
      } catch { /* L'OCR rimane utilizzabile senza MusicBrainz. */ }
    } })();
  }
  async function lookupDraft(id: string) {
    const d = drafts.find(x => x.id === id);
    if (!d?.album.trim()) return;
    editDraft(id, { loading: true, error: '' });
    try {
      const candidates = d.artist ? await searchAlbums(d.artist, d.album) : await searchSpineText(d.album);
      editDraft(id, { candidates, loading: false, selectedMbid: '', editions: [],
        error: candidates.length ? '' : 'Nessuna corrispondenza affidabile. Modifica artista o album e riprova.' });
    } catch (e) { editDraft(id, { loading: false, error: e instanceof Error ? e.message : String(e) }); }
  }
  async function chooseCandidate(id: string, candidate: MBCandidate) {
    editDraft(id, { selectedMbid: candidate.id, selectedReleaseId: '', editions: [],
      artist: candidate.artist, album: candidate.title, loading: true, error: '' });
    try {
      const editions = await findCDEditions(candidate.id);
      editDraft(id, { editions, loading: false });
    } catch (e) { editDraft(id, { loading: false, error: `Edizioni CD non disponibili: ${String(e)}. Puoi confermare l'album senza edizione.` }); }
  }
  function insertDraft(id: string) {
    const d = drafts.find(x => x.id === id);
    if (!d || !d.artist.trim() || !d.album.trim()) return;
    const candidate = makeItem(d);
    if (items.some(existing => equivalent(existing, candidate))) {
      show('Questo artista e album (edizione) sono già nel catalogo: duplicato evitato.');
      setDrafts(current => current.filter(x => x.id !== id)); return;
    }
    setItems(prev => [...prev, candidate]); setSelectedId(candidate.id);
    setDrafts(current => current.filter(x => x.id !== id));
    show(`CD aggiunto: ${candidate.artist} — ${candidate.album}`);
  }
  function addManual() {
    const draft: OCRDraft = { id: uid(), photoId: '', text: '', confidence: 0,
      artist: '', album: '', bounds: { x:0,y:0,width:0,height:0 }, candidates: [], editions: [],
      selectedMbid: '', selectedReleaseId: '', loading: false, error: '' };
    setDrafts(ds => [...ds, draft]); setReviewOpen(true);
  }
  function editCd(id: string, field: 'artist' | 'album' | 'firstReleaseDate', next: string) {
    const current = items.find(c => c.id === id); if (!current || current[field] === next) return;
    if (!next.trim() && field !== 'firstReleaseDate') { show('Artista e album sono obbligatori.'); return; }
    if (field === 'firstReleaseDate' && next && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(next)) { show('Usa AAAA, AAAA-MM oppure AAAA-MM-GG.'); return; }
    const identityChanged = field === 'artist' || field === 'album';
    if (identityChanged && current.sales.length && !window.confirm('Modificando l’identità del CD, i prezzi documentati potrebbero non riferirsi più al disco. Vuoi azzerarli?')) return;
    const changed = { ...current, [field]: next.trim(),
      confidence: identityChanged ? 'incerto' as const : current.confidence,
      mbid: identityChanged ? '' : current.mbid, releaseId: identityChanged ? '' : current.releaseId,
      sales: identityChanged ? [] : current.sales, lastPriceCheck: identityChanged ? '' : current.lastPriceCheck, updatedAt: today() };
    if (items.some(i => i.id !== id && equivalent(i, changed))) { show('Esiste già questo CD nel catalogo.'); return; }
    setItems(prev => prev.map(c => c.id === id ? changed : c));
  }
  function manualInsert(cdId: string, sale: SoldSale) {
    setItems(prev => prev.map(c => c.id === cdId ? {
      ...c, sales: [...c.sales, sale].sort((a,b) => b.soldAt.localeCompare(a.soldAt)).slice(0,3),
      lastPriceCheck: today(), updatedAt: today() } : c));
    show('Vendita registrata nell’archivio con fonte eBay.');
  }
  async function refreshPrices(ids?: string[]) {
    if (busyPrices) return;
    const target = items.filter(c => !ids || ids.includes(c.id));
    if (!target.length) { show('Aggiungi almeno un CD.'); return; }
    if (!automaticPriceEnabled) { setPriceId(target[0].id); show('Ricerca automatica non configurata: apri le ricerche eBay e registra solo vendite documentate, oppure configura il Worker.'); return; }
    if (!markets.includes('GB')) { show('Trawl copre solo eBay Regno Unito. Attiva GB per la ricerca automatica.'); setPriceId(target[0].id); return; }
    setBusyPrices(true);
    let state: PriceProgress = { processed:0,total:target.length,found:0,missing:0,errors:0 };
    setProgress(state);
    for (const c of target) {
      try {
        const result = await searchSold(c, markets);
        if (result.sales.length) state = { ...state, found: state.found + 1 };
        else state = { ...state, missing: state.missing + 1 };
        setItems(prev => prev.map(cd => cd.id === c.id ? {
          ...cd, sales: [...result.sales, ...cd.sales.filter(s => !result.sales.some(n => n.url === s.url))]
            .sort((a,b) => b.soldAt.localeCompare(a.soldAt)).slice(0,3),
          lastPriceCheck: result.checkedAt, updatedAt: today()
        } : cd));
      } catch (e) {
        state = { ...state, errors: state.errors + 1 };
        show(`Ricerca ${c.artist} — ${c.album}: ${e instanceof Error ? e.message : String(e)}. Prezzi precedenti mantenuti.`);
      }
      state = { ...state, processed: state.processed + 1 };
      setProgress({ ...state });
    }
    setBusyPrices(false);
    show(`Ricerca conclusa: ${state.processed} CD, ${state.found} con vendite, ${state.missing} senza risultati, ${state.errors} errori.`);
  }
  async function importBackup(file: File) {
    try {
      const incoming = await parseBackup(file);
      if (!window.confirm(`Importare ${incoming.length} CD dal backup? I dischi nuovi saranno aggiunti, i duplicati conservati una sola volta.`)) return;
      setItems(prev => uniqueCds([...prev, ...incoming])); show('Backup importato e duplicati esclusi.');
    } catch (e) { show(e instanceof Error ? e.message : String(e)); }
    if (backupRef.current) backupRef.current.value = '';
  }
  function sort(field: SortField) { if (sortBy === field) setSortAsc(a => !a); else { setSortBy(field); setSortAsc(true); } }
  function toggleMarket(market: Marketplace) { setMarkets(prev => prev.includes(market) ? prev.filter(c => c !== market) : [...prev, market]); }
  if (!loaded) return <div className="min-h-screen grid place-items-center text-navy text-xl font-semibold">Apertura archivio locale CD…</div>;
  return <div className="min-h-screen">
    <header className="bg-ink text-white shadow-lg">
      <div className="max-w-[1480px] mx-auto p-5 sm:p-7">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-5">
          <div><p className="text-teal text-xs font-semibold tracking-[.25em] uppercase mb-1">Music library manager</p>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight flex items-center gap-3"><Music2 className="text-teal" size={32}/> CD COLLECTION SCANNER</h1>
            <p className="text-slate-300 mt-2 text-sm">Fotografa · riconosci · cataloga · confronta vendite documentate</p></div>
          <button className="btn-soft text-slate-800" onClick={() => setHelpOpen(true)}><CircleHelp size={17}/> Guida e limiti</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => scanner.current?.openFiles()}><Upload size={17}/> 📷 Carica foto</button>
          <button className="btn-dark border border-white/20" onClick={() => scanner.current?.scanAll()}><Search size={17}/> 🔎 Scansiona CD</button>
          <button className="btn-dark border border-white/20" disabled={busyPrices} onClick={() => void refreshPrices()}><Wallet size={17}/> 💰 Cerca prezzi eBay</button>
          <button className="btn-dark border border-white/20" disabled={busyPrices} onClick={() => void refreshPrices()}><RefreshCw size={17}/> 🔄 Aggiorna prezzi</button>
          <button className="btn-dark border border-white/20" onClick={() => void save(items)}><Database size={17}/> 💾 Salva collezione</button>
          <button className="btn-dark border border-white/20" onClick={() => void exportXLSX(items).catch(e => show(String(e)))}><Download size={17}/> 📥 Esporta Excel</button>
        </div>
      </div>
    </header>
    <main className="max-w-[1480px] mx-auto p-4 sm:p-7 space-y-6">
      {notice && <div role="status" className="panel flex justify-between items-start gap-4 p-3 border-l-4 border-l-teal text-sm text-slate-700"><span>{notice}</span>
        <button aria-label="Chiudi avviso" onClick={() => setNotice('')}><X size={16}/></button></div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="stat"><div className="small flex items-center gap-2"><Music2 size={16}/> CD catalogati</div><div className="text-3xl font-extrabold mt-2 text-navy">{items.length}</div></div>
        <div className="stat"><div className="small flex items-center gap-2"><BadgeCheck size={16}/> CD con prezzi documentati</div><div className="text-3xl font-extrabold mt-2 text-navy">{priced}</div></div>
        <div className="stat"><div className="small flex items-center gap-2"><Wallet size={16}/> Valore stimato collezione</div><div className="text-2xl font-extrabold mt-2 text-navy">{stats.included ? money(stats.total) : 'N.D.'}</div>
          <p className="text-xs text-slate-500 mt-2">{stats.included} inclusi · {stats.excluded} esclusi · media per CD: {stats.included ? money(stats.total / stats.included) : 'N.D.'}</p></div>
        <div className="stat"><div className="small flex items-center gap-2"><RefreshCw size={16}/> Ultimo aggiornamento prezzi</div><div className="text-base font-bold mt-3 text-navy">{mostRecent ? dateDisplay(mostRecent) : 'Mai'}</div><p className="text-xs text-slate-500 mt-2">{saveStatus}</p></div>
      </div>
      <section id="foto"><PhotoScanner ref={scanner} onDrafts={addDrafts} onInfo={show}/></section>
      <section className="panel p-5 space-y-4">
        <div className="flex flex-wrap justify-between gap-4"><div><h2 className="text-xl font-bold text-navy">Ricerca vendite eBay</h2>
          <p className="small mt-1">Paesi selezionati per ricerca assistita; il provider automatico Trawl copre soltanto UK.</p></div>
          <span className={`self-start text-xs font-bold rounded-full px-3 py-1 ${automaticPriceEnabled ? 'bg-teal/10 text-teal' : 'bg-amber-50 text-amber-800'}`}>
            {automaticPriceEnabled ? 'Automazione UK configurata' : 'Automazione non configurata'}</span></div>
        <div className="flex flex-wrap gap-4">{marketplaces.map(m => <label key={m.code} className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={markets.includes(m.code)} onChange={() => toggleMarket(m.code)}/> {m.label} {automaticCoverage.includes(m.code) ? <span className="text-[10px] text-teal">API</span> : <span className="text-[10px] text-amber-700">manuale</span>}
        </label>)}</div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busyPrices} onClick={() => void refreshPrices()}><Wallet size={17}/> 💰 CERCA PREZZI VENDUTI SU EBAY</button>
          <button className="btn-soft" disabled={busyPrices} onClick={() => void refreshPrices()}><RefreshCw size={17}/> 🔄 AGGIORNA PREZZI</button>
          <button className="btn-soft" onClick={() => selectedCd ? (automaticPriceEnabled && markets.includes('GB') ? void refreshPrices([selectedCd.id]) : setPriceId(selectedCd.id)) : show('Seleziona prima un CD dalla tabella.') }><Search size={17}/> 🔍 CERCA PREZZO SINGOLO</button>
        </div>
        {progress && <div role="status" className="rounded-xl bg-slate-50 border border-slate-200 p-3">
          <div className="text-sm flex justify-between gap-2"><strong>{busyPrices ? 'Ricerca in corso' : 'Ultima ricerca'}</strong><span>{progress.processed}/{progress.total} elaborati</span></div>
          <div className="h-2 bg-slate-200 rounded-full mt-2 overflow-hidden"><div className="h-full bg-teal transition-all" style={{ width: `${progress.total ? 100 * progress.processed / progress.total : 0}%` }}/></div>
          <p className="small mt-2">Con risultati: {progress.found} · Non trovati: {progress.missing} · Errori: {progress.errors}</p>
        </div>}
      </section>
      <section className="panel overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-wrap justify-between gap-3 items-center">
          <div><h2 className="text-xl font-bold text-navy">La tua collezione</h2><p className="small mt-1">Clicca sulle celle per modificarle, sui prezzi per vedere le fonti. Seleziona un CD per la ricerca singola.</p></div>
          <div className="flex flex-wrap gap-2"><button className="btn-soft" onClick={addManual}><Plus size={16}/> Aggiungi CD</button>
            <button className="btn-soft" onClick={() => exportCSV(items)}><Download size={15}/> CSV</button>
            <button className="btn-soft" onClick={() => void exportXLSX(items).catch(e => show(String(e)))}><Download size={15}/> Excel</button>
            <button className="btn-soft" onClick={() => exportJSON(items)}><FileJson size={15}/> Backup JSON</button>
            <input hidden type="file" accept="application/json,.json" ref={backupRef} onChange={e => e.target.files?.[0] && void importBackup(e.target.files[0])}/>
            <button className="btn-soft" onClick={() => backupRef.current?.click()}><HardDriveDownload size={15}/> Importa JSON</button></div>
        </div>
        <div className="p-4 border-b border-slate-100 flex gap-3 items-center"><Search size={19} className="text-slate-400"/>
          <input className="field max-w-xl" aria-label="Cerca nel catalogo" placeholder="Cerca subito per artista, album o edizione…" value={query} onChange={e => setQuery(e.target.value)}/>
          <span className="text-sm text-slate-500 whitespace-nowrap">{visible.length} CD</span></div>
        <div className="overflow-auto max-h-[680px]"><table className="w-full min-w-[940px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-navy text-white"><tr>
            <th className="p-3 text-xs font-semibold" scope="col">Sel.</th>
            {([['artist','CD / ARTISTA'],['album','ALBUM'],['date','DATA USCITA'],['price','VENDUTO 1']] as [SortField,string][]).map(([field,label]) =>
              <th key={label} scope="col" className="p-3 text-xs font-bold"><button className="flex items-center gap-1 hover:text-teal" onClick={() => sort(field)}>{label} <ArrowDownUp size={13}/></button></th>)}
            <th scope="col" className="p-3 text-xs font-bold">VENDUTO 2</th><th scope="col" className="p-3 text-xs font-bold">VENDUTO 3</th><th scope="col" className="p-3 text-xs font-bold">AZIONI</th>
          </tr></thead>
          <tbody>{visible.map((c,i) => <tr key={c.id} className={`${i%2 ? 'bg-slate-50' : 'bg-white'} ${selectedId===c.id ? 'ring-1 ring-inset ring-teal/60' : ''}`}>
            <td className="table-cell"><input type="radio" name="selected-cd" aria-label={`Seleziona ${c.artist} ${c.album}`} checked={selectedId === c.id} onChange={() => setSelectedId(c.id)}/></td>
            <td className="table-cell"><input aria-label={`Artista per ${c.album}`} title="Modifica artista e conferma uscendo dal campo" className={`field !w-48 ${c.confidence === 'incerto' ? '!border-amber-400' : ''}`}
              key={`${c.id}:artist:${c.artist}`} defaultValue={c.artist} onBlur={e => editCd(c.id,'artist',e.target.value)}/></td>
            <td className="table-cell"><input aria-label={`Album di ${c.artist}`} className={`field !w-60 ${c.confidence === 'incerto' ? '!border-amber-400' : ''}`}
              key={`${c.id}:album:${c.album}`} defaultValue={c.album} onBlur={e => editCd(c.id,'album',e.target.value)}/></td>
            <td className="table-cell"><input aria-label={`Data prima uscita di ${c.album}`} className="field !w-32" placeholder="N.D." title="AAAA, AAAA-MM o AAAA-MM-GG"
              key={`${c.id}:date:${c.firstReleaseDate}`} defaultValue={c.firstReleaseDate} onBlur={e => editCd(c.id,'firstReleaseDate',e.target.value)}/></td>
            {[0,1,2].map(n => <td className="table-cell" key={n}><button className={`font-semibold underline underline-offset-4 ${c.sales[n] ? 'text-teal hover:text-navy' : 'text-slate-400'}`}
              title={c.sales[n] ? 'Apri dettagli e fonte' : 'Nessun dato di vendita'} onClick={() => { setSelectedId(c.id); setPriceId(c.id); }}>{c.sales[n] ? priceLabel(c.sales[n]) : 'N.D.'}</button></td>)}
            <td className="table-cell"><div className="flex gap-2 items-center">
              <button className="text-teal" title="Dettagli, ricerca e aggiunta prezzi" onClick={() => { setSelectedId(c.id); setPriceId(c.id); }}><Wallet size={18}/></button>
              {c.confidence === 'incerto' && <span title="Identificazione non verificata con MusicBrainz" className="text-amber-600 text-lg">!</span>}
              <button className="text-rose-600" title="Elimina CD" onClick={() => { if (window.confirm(`Eliminare ${c.artist} — ${c.album}? È possibile recuperarlo solo da un backup.`)) {
                setItems(prev => prev.filter(item => item.id !== c.id)); if (selectedId===c.id) setSelectedId(''); } }}><Trash2 size={17}/></button>
            </div></td>
          </tr>)}</tbody>
        </table></div>
        {!visible.length && <p className="text-center py-12 text-slate-500">{items.length ? 'Nessuna corrispondenza.' : 'Archivio vuoto. Carica le foto o aggiungi un CD manualmente.'}</p>}
        <div className="p-4 bg-slate-50 border-t text-xs text-slate-500">Dati salvati in IndexedDB su questo browser. Le vendite vengono aggiunte solo con fonte documentata; non sono quotazioni garantite di rivendita.</div>
      </section>
      <footer className="text-xs text-slate-500 pb-8 flex flex-wrap gap-3 items-center justify-between"><p>CD Collection Scanner · OCR locale · MusicBrainz · Trawl (opzionale) · Frankfurter</p>
        <p>Backup JSON consigliato prima di cancellare dati del browser.</p></footer>
    </main>
    <ReviewDrawer open={reviewOpen} drafts={drafts} onClose={() => setReviewOpen(false)} onUpdate={editDraft}
      onRemove={id => setDrafts(prev => prev.filter(d => d.id !== id))} onSearch={id => void lookupDraft(id)}
      onChoose={(id, candidate) => void chooseCandidate(id, candidate)} onAdd={insertDraft}/>
    <PricePanel cd={priceCd} onClose={() => setPriceId(null)} onInsert={manualInsert}
      onSearch={id => { setPriceId(null); void refreshPrices([id]); }} selected={markets} onError={show}/>
    {helpOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4" role="dialog" aria-modal="true" aria-label="Guida">
      <div className="bg-white rounded-2xl max-w-2xl p-6 sm:p-8 max-h-[90vh] overflow-auto">
        <div className="flex justify-between gap-4"><h2 className="text-xl font-bold text-navy">Guida rapida e limiti reali</h2><button onClick={() => setHelpOpen(false)}><X size={20}/></button></div>
        <div className="text-sm text-slate-700 mt-4 space-y-3">
          <p><strong>1. Foto:</strong> carica immagini, ruotale se le coste non sono verticali, avvia la scansione. L'OCR gira nel browser; puoi disegnare una zona e ripetere. L'esito dipende da risoluzione, riflessi, caratteri e disposizione delle custodie.</p>
          <p><strong>2. Verifica:</strong> correggi artista e album, cerca MusicBrainz e scegli l'edizione CD. Se le informazioni non sono sufficienti, aggiungi manualmente e la riga resta incerta.</p>
          <p><strong>3. Vendite:</strong> con Worker e chiave Trawl il programma cerca automaticamente eBay GB, escludendo offerte dal prezzo ignoto e risultati non comparabili. Altri paesi: collegamenti alla ricerca venduti e inserimento verificato.</p>
          <p><strong>4. Valore:</strong> somma delle medie dei prezzi documentati dei CD coperti; non rappresenta un'offerta di acquisto o un valore assicurativo.</p>
          <p><strong>5. Privacy:</strong> le immagini sono elaborate nel browser; testo artista/album viene inviato a MusicBrainz solo per l'identificazione e al Worker scelto per i prezzi. Catalogo e dati delle vendite rimangono su IndexedDB.</p>
          <p><strong>6. Backup:</strong> esporta JSON periodicamente; modalità privata, pulizia dei dati del browser e cambio dispositivo possono rimuovere IndexedDB.</p>
        </div><button className="btn-primary mt-5" onClick={() => setHelpOpen(false)}>Ho capito</button>
      </div></div>}
  </div>;
}
