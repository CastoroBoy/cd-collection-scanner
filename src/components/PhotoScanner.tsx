import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Camera, Images, RotateCw, ScanLine, Trash2, UploadCloud } from 'lucide-react';
import type { OCRDraft, PhotoFile } from '../lib/types';
import { uid } from '../lib/helpers';
import { prepareCanvas, scanCanvas, proposeRegions, previewSpine } from '../lib/ocr';
import type { Region } from '../lib/ocr';

interface Props { onDrafts: (drafts: OCRDraft[]) => void; onInfo: (text: string) => void; }
type Point = { x: number; y: number };
export interface ScannerActions { openFiles: () => void; scanAll: () => void; }
const PhotoScanner = forwardRef<ScannerActions, Props>(function PhotoScanner({ onDrafts, onInfo }, ref) {
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const photosRef = useRef<PhotoFile[]>([]);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState('');
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [thorough, setThorough] = useState(true);
  const [autoRegions, setAutoRegions] = useState<Region[]>([]);
  const [showRegions, setShowRegions] = useState(true);
  const [verticalOnly, setVerticalOnly] = useState(true);
  const [separated, setSeparated] = useState<string[]>([]);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragEnd, setDragEnd] = useState<Point | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const active = useMemo(() => photos.find(p => p.id === selected), [photos, selected]);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => { for (const photo of photosRef.current) URL.revokeObjectURL(photo.objectUrl); }, []);
  useEffect(() => {
    let cancelled = false;
    setPreview(''); setCanvas(null); setAutoRegions([]); setSeparated([]); setDragStart(null); setDragEnd(null);
    if (active) prepareCanvas(active).then(c => {
      if (cancelled) return;
      const detected = proposeRegions(c, { verticalOnly });
      setCanvas(c); setAutoRegions(detected); setSeparated(detected.map(r=>previewSpine(c,r))); setPreview(c.toDataURL('image/jpeg', .9));
    }).catch(e => onInfo(String(e)));
    return () => { cancelled = true; };
  }, [active?.id, active?.rotation, verticalOnly]);
  function upload(files: FileList | File[] | null) {
    if (!files) return;
    const incoming = Array.from(files).filter(f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) && f.size <= 25_000_000);
    if (incoming.length !== Array.from(files).length) onInfo('Alcuni file sono stati ignorati: sono ammessi JPG, PNG e WEBP fino a 25 MB.');
    const newPhotos: PhotoFile[] = incoming.slice(0, 20).map(file => ({ id: uid(), file, name: file.name, objectUrl: URL.createObjectURL(file), rotation: 0 }));
    setPhotos(prev => { const combined = [...prev, ...newPhotos].slice(0, 30); for (const excess of [...prev, ...newPhotos].slice(30)) URL.revokeObjectURL(excess.objectUrl); return combined; });
    if (newPhotos.length) setSelected(newPhotos[0].id);
    if (fileRef.current) fileRef.current.value = '';
    if (cameraRef.current) cameraRef.current.value = '';
  }
  async function scan(all: boolean, crop?: Region) {
    if (!photos.length || working) { onInfo('Carica una foto prima di eseguire la scansione.'); return; }
    setWorking(true);
    try {
      const batch = all ? photos : (active ? [active] : []);
      const drafts: OCRDraft[] = [];
      for (let i = 0; i < batch.length; i++) {
        const photo = batch[i];
        setProgress(`Foto ${i + 1}/${batch.length}: preparazione immagine…`);
        const c = crop && !all && canvas ? canvas : await prepareCanvas(photo);
        const regions = crop ? [crop] : proposeRegions(c, { verticalOnly });
        const found = await scanCanvas(c, photo.id, regions, (done, total) => {
          setProgress(`Foto ${i + 1}/${batch.length} • dorsi analizzati ${done}/${total}`);
        }, { thorough, verticalOnly: !crop && verticalOnly });
        drafts.push(...found);
      }
      onDrafts(drafts);
      if (!drafts.length) onInfo('Nessun testo affidabile. Seleziona a mano una sola costa e premi “Scansiona zona selezionata”. Non vengono creati CD casuali.');
      else onInfo(`Estratte ${drafts.length} possibili coste. Controlla le trascrizioni prima di confermarle.`);
      setDragStart(null); setDragEnd(null);
    } catch (e) { onInfo(`Scansione non riuscita: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setWorking(false); setProgress(''); }
  }
  function coords(e: React.PointerEvent<HTMLDivElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }
  const box = dragStart && dragEnd ? { x: Math.min(dragStart.x, dragEnd.x), y: Math.min(dragStart.y, dragEnd.y),
    w: Math.abs(dragStart.x - dragEnd.x), h: Math.abs(dragStart.y - dragEnd.y) } : null;
  const roi: Region | null = box && canvas && box.w > .012 && box.h > .025 ? {
    x: Math.round(box.x * canvas.width), y: Math.round(box.y * canvas.height),
    width: Math.max(1, Math.round(box.w * canvas.width)), height: Math.max(1, Math.round(box.h * canvas.height)) } : null;
  useImperativeHandle(ref, () => ({ openFiles: () => fileRef.current?.click(), scanAll: () => { void scan(true); } }));
  return <section className="panel overflow-hidden">
    <div className="p-5 border-b border-slate-100 flex flex-wrap gap-3 justify-between items-center">
      <div><h2 className="text-lg font-bold text-navy flex items-center gap-2"><Images size={20}/> Scansione fotografie</h2>
        <p className="small mt-1">Le foto restano sul dispositivo. OCR locale con Tesseract.js; risultati da confermare.</p></div>
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => upload(e.target.files)}/>
        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={e => upload(e.target.files)}/>
        <button className="btn-primary" onClick={() => fileRef.current?.click()}><UploadCloud size={18}/> 📷 CARICA FOTO DEI CD</button>
        <button className="btn-soft" onClick={() => cameraRef.current?.click()} title="Scatta con la fotocamera"><Camera size={18}/> Scatta foto</button>
      </div>
    </div>
    <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files); }} className="p-4 sm:p-5">
      {!photos.length && <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
        <UploadCloud className="mx-auto mb-3 text-teal" size={36}/>
        <strong className="block text-slate-700">Trascina qui una o più fotografie delle coste</strong>
        <span className="block mt-1 text-sm">JPG · PNG · WEBP · fino a 25 MB per file</span>
      </div>}
      {!!photos.length && <>
        <div className="flex gap-2 overflow-auto pb-3">
          {photos.map(p => <div key={p.id} className={`flex-none rounded-xl border p-2 min-w-32 max-w-52 ${p.id === selected ? 'border-teal bg-teal/5' : 'border-slate-200'}`}>
            <button onClick={() => setSelected(p.id)} className="block text-xs font-semibold truncate w-full text-left" title={p.name}>{p.name}</button>
            <button className="mt-1 text-xs text-rose-600 flex items-center gap-1" disabled={working} onClick={() => {
              URL.revokeObjectURL(p.objectUrl); setPhotos(old => old.filter(q => q.id !== p.id));
              if (p.id === selected) setSelected(photos.find(q => q.id !== p.id)?.id || '');
            }}><Trash2 size={12}/> Rimuovi</button>
          </div>)}
        </div>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <button className="btn-soft" disabled={!active || working} onClick={() => setPhotos(current => current.map(p => p.id === selected ? { ...p, rotation: ((p.rotation + 90) % 360) as PhotoFile['rotation'] } : p))}><RotateCw size={17}/> Ruota 90°</button>
          <button type="button" disabled={working} aria-pressed={verticalOnly} onClick={() => setVerticalOnly(old => !old)}
            className={`btn-soft ${verticalOnly ? '!bg-teal/10 !border-teal text-teal' : ''}`} title="Escludi le regioni che non hanno le proporzioni di una costa CD verticale">
            {verticalOnly ? '✓ ' : ''}Rileva solo dorsi verticali
          </button>
          <label className="flex gap-2 items-center text-sm text-slate-700"><input type="checkbox" checked={thorough} disabled={working} onChange={e => setThorough(e.target.checked)}/> OCR accurato (più lento)</label>
          <label className="flex gap-2 items-center text-sm text-slate-700"><input type="checkbox" checked={showRegions} onChange={e => setShowRegions(e.target.checked)}/> Mostra dorsi rilevati ({autoRegions.length})</label>
          <span className="text-xs text-slate-500">Trascina un rettangolo attorno a UNA costa per una scansione mirata</span>
        </div>
        <div className="bg-slate-100 border rounded-xl p-3">
          {preview && <div className="relative w-fit max-w-full mx-auto">
            <img alt="Anteprima delle coste CD" src={preview} draggable={false} className="block select-none w-auto max-w-full h-auto max-h-[68vh] object-contain rounded-lg"/>
            <div className="absolute inset-0 cursor-crosshair touch-none" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); const p = coords(e); setDragStart(p); setDragEnd(p); }}
              onPointerMove={e => { if (dragStart) setDragEnd(coords(e)); }} onPointerUp={e => setDragEnd(coords(e))} />
            {showRegions && canvas && autoRegions.map((r,i) => <div key={i} className="absolute border border-amber-400/80 pointer-events-none" style={{left:`${r.x*100/canvas.width}%`,top:`${r.y*100/canvas.height}%`,width:`${r.width*100/canvas.width}%`,height:`${r.height*100/canvas.height}%`}}><span className="absolute top-0 left-0 text-[9px] bg-amber-400/90 px-1">{i+1}</span></div>)}
            {box && <div className="absolute border-2 border-teal bg-teal/20 pointer-events-none" style={{ left:`${box.x*100}%`, top:`${box.y*100}%`, width:`${box.w*100}%`, height:`${box.h*100}%` }}/>}</div>}
          {!preview && <p className="p-6 small">Preparazione anteprima…</p>}
        </div>
        {canvas && autoRegions.length===0 && <p className="text-sm text-amber-700 mt-2">Non sono stati individuati confini affidabili: seleziona manualmente una costa alla volta e ripeti la scansione.</p>}
        {!!separated.length && <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-bold text-navy">Coste ritagliate e distanziate: {separated.length}</h3>
            <span className="text-xs text-slate-500">Zone OCR indipendenti, senza sovrapposizioni. Seleziona un CD per una scansione singola.</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {separated.map((src,i)=><button type="button" key={i} disabled={working}
              onClick={()=>autoRegions[i]&&void scan(false,autoRegions[i])}
              className="w-[92px] shrink-0 rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:border-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
              title={`Scansiona singolarmente il CD ${i+1}`}>
              <img src={src} alt={`Costa CD ${i+1}`} className="block w-full h-44 object-contain bg-slate-50 rounded"/>
              <span className="block mt-2 text-center text-xs font-semibold">CD {i+1}</span>
            </button>)}
          </div>
        </div>}
        <div className="flex flex-wrap gap-2 mt-4 items-center">
          <button className="btn-dark" disabled={working} onClick={() => scan(true)}><ScanLine size={17}/> 🔎 SCANSIONA TUTTE LE FOTO</button>
          <button className="btn-soft" disabled={working || !roi} onClick={() => roi && scan(false, roi)}>Scansiona zona selezionata</button>
          {box && <button className="btn-soft" onClick={() => { setDragStart(null); setDragEnd(null); }}>Annulla selezione</button>}
        </div>
        {working && <div role="status" className="mt-3 text-sm text-teal font-semibold">{progress}<div className="mt-1 h-2 bg-slate-200 rounded-full overflow-hidden"><div className="w-1/2 h-full bg-teal animate-pulse"/></div></div>}
      </>}
    </div>
  </section>;
});
export default PhotoScanner;
