import { Check, ChevronRight, Music2, Search, X } from 'lucide-react';
import type { OCRDraft, MBCandidate, MBEdition } from '../lib/types';

interface Props {
  open: boolean; drafts: OCRDraft[]; onClose: () => void; onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<OCRDraft>) => void;
  onSearch: (id: string) => void; onChoose: (id: string, candidate: MBCandidate) => void;
  onAdd: (id: string) => void;
}
export default function ReviewDrawer({ open, drafts, onClose, onRemove, onUpdate, onSearch, onChoose, onAdd }: Props) {
  if (!open) return null;
  return <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Revisione OCR">
    <button className="absolute inset-0 bg-ink/60" aria-label="Chiudi revisione" onClick={onClose}/>
    <aside className="relative z-10 bg-white shadow-2xl h-full w-full max-w-xl overflow-auto p-5 sm:p-7">
      <div className="flex justify-between gap-3 items-start mb-5"><div><h2 className="font-extrabold text-2xl text-navy">Conferma i CD</h2>
        <p className="small mt-1">Correggi il testo OCR, seleziona MusicBrainz ed eventualmente l'edizione CD. Nessun dato incerto viene inventato.</p></div>
        <button className="btn-soft px-2" onClick={onClose} aria-label="Chiudi"><X size={19}/></button></div>
      {!drafts.length && <p className="small">Non ci sono CD in revisione.</p>}
      <div className="space-y-5">
        {drafts.map(d => <div key={d.id} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
          <div className="flex gap-3 justify-between"><div className="flex gap-3 items-start">
            {d.previewUrl && <img src={d.previewUrl} alt="Costa fotografata, ritagliata" className="h-32 w-14 object-contain rounded border bg-white" />}
            <div><span className="text-xs font-bold uppercase tracking-widest text-slate-500">Lettura OCR</span>
            <span className={`ml-3 text-xs font-semibold ${d.confidence >= 75 ? 'text-teal' : 'text-amber-700'}`}>{Math.round(d.confidence)}% affidabilità OCR</span>
            <p className="text-sm font-medium mt-1 break-words">{d.text || 'Testo non riconosciuto'}</p></div></div>
            <button className="text-rose-600 text-xs self-start" onClick={() => onRemove(d.id)} aria-label="Rimuovi candidato"><X size={17}/></button></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label><span className="label">Artista / gruppo</span><input className="field" value={d.artist} onChange={e => onUpdate(d.id, { artist: e.target.value, selectedMbid: '', candidates: [], editions: [] })} placeholder="Es. Pink Floyd"/></label>
            <label><span className="label">Album</span><input className="field" value={d.album} onChange={e => onUpdate(d.id, { album: e.target.value, selectedMbid: '', candidates: [], editions: [] })} placeholder="Es. The Wall"/></label>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button className="btn-soft" disabled={d.loading || !d.album.trim()} onClick={() => onSearch(d.id)}><Search size={16}/> {d.loading ? 'Ricerca online…' : 'Confronta artista, titolo e copertina'}</button>
            <a className="text-xs font-semibold underline text-teal" href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent([d.artist,d.album,'CD spine dorsetto'].filter(Boolean).join(' '))}`} target="_blank" rel="noopener noreferrer">Cerca foto delle coste online ↗</a>
          </div>
          <p className="text-xs text-slate-500">Il confronto con MusicBrainz è automatico sul testo; le immagini delle coste sul web vanno verificate visivamente. La foto originale resta nel browser.</p>
          {d.error && <p className="text-xs text-rose-600">{d.error}</p>}
          {!!d.candidates.length && <div className="space-y-2"><div className="label">Album compatibili (seleziona quello corretto)</div>
            {d.candidates.map(c => <button key={c.id} className={`block w-full text-left p-3 rounded-lg border ${d.selectedMbid === c.id ? 'bg-teal/10 border-teal' : 'bg-white border-slate-200'}`}
              onClick={() => onChoose(d.id, c)}>
              <div className="flex gap-3 items-start">
                {c.coverUrl && <img src={c.coverUrl} alt={`Copertina ${c.title}`} loading="lazy" onError={e=>{e.currentTarget.style.display='none';}} className="h-16 w-16 object-cover border rounded shrink-0 bg-slate-50" />}
                <div className="flex-1"><div className="flex gap-3 justify-between"><span className="text-sm font-semibold">{c.artist} — {c.title}</span><span className="text-xs text-slate-500">{c.score}%</span></div>
                <p className="text-[11px] text-slate-500 mt-1">Metadati confrontati con il testo OCR; verifica anche la copertina.</p></div></div>
              <p className="text-xs text-slate-500 mt-1">Prima uscita: {c.firstReleaseDate || 'non disponibile'} {c.disambiguation ? `· ${c.disambiguation}` : ''}</p></button>)}
          </div>}
          {!!d.selectedMbid && <label className="block"><span className="label">Edizione fisica (facoltativa)</span>
            <select className="field" value={d.selectedReleaseId} onChange={e => onUpdate(d.id, { selectedReleaseId: e.target.value })}>
              <option value="">Edizione non identificata</option>
              {d.editions.map((e: MBEdition) => <option key={e.id} value={e.id}>{e.title} · {e.date || 'anno N.D.'} · {e.country || 'paese N.D.'} · CD {e.disambiguation ? `(${e.disambiguation})` : ''}</option>)}
            </select>
            {d.loading && <span className="text-xs text-slate-500">Caricamento edizioni CD…</span>}
          </label>}
          <button className="btn-primary w-full" disabled={!d.artist.trim() || !d.album.trim() || d.loading} onClick={() => onAdd(d.id)}><Check size={17}/> Conferma e aggiungi al catalogo</button>
          {!d.selectedMbid && <p className="text-xs text-amber-700">Puoi aggiungere manualmente senza MusicBrainz: la scheda resterà evidenziata come incerta.</p>}
        </div>)}
      </div>
    </aside>
  </div>;
}
