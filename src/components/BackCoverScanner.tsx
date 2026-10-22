import { useEffect, useMemo, useRef, useState } from 'react';
import { Barcode, Camera, Search, UploadCloud } from 'lucide-react';
import { createWorker, PSM } from 'tesseract.js';
import { detectBarcode, loadBackImage, normalizedBarcode, validBarcode } from '../lib/barcode';
import { searchBarcodeReleases } from '../lib/musicbrainz';
import { uid } from '../lib/helpers';
import type { MBCandidate, OCRDraft } from '../lib/types';

interface Props {
  onDrafts: (drafts: OCRDraft[]) => void;
  onInfo: (message: string) => void;
}
function thumbnail(canvas: HTMLCanvasElement): string {
  const scale = Math.min(1, 1100 / Math.max(canvas.width, canvas.height));
  const display = document.createElement('canvas');
  display.width = Math.max(1, Math.round(canvas.width * scale));
  display.height = Math.max(1, Math.round(canvas.height * scale));
  display.getContext('2d')!.drawImage(canvas, 0, 0, display.width, display.height);
  return display.toDataURL('image/jpeg', 0.8);
}
async function readBackText(canvas: HTMLCanvasElement): Promise<{text:string;confidence:number}> {
  const worker = await createWorker('eng', 1, { cacheMethod: 'write' });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const data = (await worker.recognize(canvas)).data;
    return { text: data.text.trim().replace(/\n{3,}/g, '\n\n').slice(0, 450), confidence: data.confidence };
  } finally { await worker.terminate(); }
}
function initialDraft(image: string | undefined, barcode: string, photoId: string): OCRDraft {
  return {
    id: uid(), photoId, bounds: { x:0, y:0, width:0, height:0 },
    text: barcode ? 'EAN/UPC: ' + barcode : '',
    confidence: barcode ? 100 : 0, previewUrl: image,
    origin: barcode ? 'barcode' : 'back-ocr', barcode,
    artist: '', album: '', candidates: [], editions: [],
    selectedMbid: '', selectedReleaseId: '', loading: false, error: ''
  };
}
export default function BackCoverScanner({ onDrafts, onInfo }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [typedCode, setTypedCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map(file => ({ name: file.name, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach(p => URL.revokeObjectURL(p.url)), [previews]);
  const trimmed = normalizedBarcode(typedCode);

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    const allowed = Array.from(selected).filter(f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) && f.size <= 25_000_000);
    if (allowed.length !== selected.length) onInfo('Accetto solo JPG, PNG e WEBP fino a 25 MB per foto.');
    if (allowed.length) setFiles(current => [...current, ...allowed].slice(0, 25));
    if (fileInput.current) fileInput.current.value = '';
    if (cameraInput.current) cameraInput.current.value = '';
  }

  async function lookup(barcode: string, image?: string, photoId = uid(), source?: HTMLCanvasElement): Promise<OCRDraft> {
    const draft = initialDraft(image, barcode, photoId);
    if (barcode) {
      const matches = await searchBarcodeReleases(barcode);
      if (matches.length) {
        const first = matches[0];
        const candidates: MBCandidate[] = [...new Map(matches.map(m => [m.candidate.id, m.candidate])).values()];
        const editions = matches.filter(m => m.candidate.id === first.candidate.id).map(m => m.edition);
        return {
          ...draft, artist: first.candidate.artist, album: first.candidate.title,
          candidates, editions, selectedMbid: first.candidate.id,
          selectedReleaseId: matches.length === 1 && first.edition.format === 'CD' ? first.edition.id : '',
          error: matches.length > 1 ? 'Più edizioni condividono questo barcode: verifica il CD corretto prima di confermare.' : ''
        };
      }
    }
    // Il barcode può essere valido ma mancare nel database. Nessuna identificazione inventata.
    if (source) {
      try {
        const fallback = await readBackText(source);
        return {
          ...draft, text: [draft.text, fallback.text].filter(Boolean).join('\n'),
          confidence: barcode ? 100 : fallback.confidence,
          origin: 'back-ocr',
          error: barcode
            ? 'Codice valido ma non presente su MusicBrainz. Usa il testo OCR per cercare artista e titolo manualmente.'
            : 'Codice a barre non leggibile. OCR del retro disponibile: inserisci o correggi artista e album.'
        };
      } catch (e) {
        return { ...draft, origin: 'back-ocr', error: 'OCR del retro non disponibile: ' + String(e) + '. Inserisci artista e album manualmente.' };
      }
    }
    return { ...draft, error: 'Codice valido ma assente da MusicBrainz. Inserisci artista e album e premi Identifica.' };
  }

  async function scanBacks() {
    if (!files.length || busy) return;
    setBusy(true);
    const drafts: OCRDraft[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress('Foto ' + (i + 1) + '/' + files.length + ': lettura del codice a barre...');
        const canvas = await loadBackImage(files[i]);
        const code = await detectBarcode(canvas);
        setProgress('Foto ' + (i + 1) + '/' + files.length + ': ' + (code ? 'ricerca ' + code + ' su MusicBrainz' : 'OCR del retro...'));
        try {
          const draft = await lookup(code || '', thumbnail(canvas), uid(), canvas);
          drafts.push(draft);
        } catch (e) {
          drafts.push({ ...initialDraft(thumbnail(canvas), code || '', uid()),
            error: 'Ricerca online non riuscita: ' + String(e) + '. Riprova la ricerca dalla schermata di revisione.' });
        }
      }
      if (drafts.length) {
        onDrafts(drafts);
        onInfo('Elaborate ' + drafts.length + ' fotografie. Controlla barcode, artista e edizione prima di confermare.');
      }
    } catch (e) {
      onInfo('Scansione del retro interrotta: ' + String(e));
      if (drafts.length) onDrafts(drafts);
    } finally { setBusy(false); setProgress(''); }
  }

  async function searchManual() {
    if (!validBarcode(trimmed) || busy) return;
    setBusy(true);
    setProgress('Ricerca del barcode ' + trimmed + ' su MusicBrainz...');
    try {
      const draft = await lookup(trimmed);
      onDrafts([draft]);
      onInfo('Ricerca terminata. Controlla i risultati prima di aggiungere il CD.');
    } catch (e) {
      const draft = initialDraft(undefined, trimmed, uid());
      onDrafts([{ ...draft, error: 'MusicBrainz non raggiungibile: ' + String(e) + '. Riprova dalla revisione.' }]);
    } finally { setBusy(false); setProgress(''); }
  }

  return <section className="panel p-5 sm:p-6 space-y-4" id="retro">
    <div>
      <h2 className="text-xl font-bold text-navy flex items-center gap-2"><Barcode size={21}/> Scansiona retro CD / codice a barre</h2>
      <p className="small mt-1">Fotografa il retro di ogni custodia con il barcode EAN/UPC a fuoco e senza riflessi. Le immagini restano sul tuo dispositivo; solo il codice e le ricerche testuali vengono inviati a MusicBrainz.</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <input hidden ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => addFiles(e.target.files)}/>
      <input hidden ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={e => addFiles(e.target.files)}/>
      <button className="btn-primary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}><UploadCloud size={17}/> Carica foto retro CD</button>
      <button className="btn-soft" type="button" disabled={busy} onClick={() => cameraInput.current?.click()}><Camera size={17}/> Scatta il retro</button>
      <button className="btn-dark" type="button" disabled={busy || !files.length} onClick={() => void scanBacks()}><Search size={17}/> Leggi barcode e identifica CD ({files.length})</button>
      {files.length > 0 && <button type="button" className="btn-soft" disabled={busy} onClick={() => setFiles([])}>Svuota foto</button>}
    </div>
    {!!previews.length && <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
      {previews.map((p, i) => <div key={p.url} className="bg-slate-50 border rounded-lg p-2">
        <img src={p.url} alt={'Retro CD ' + (i + 1)} className="w-full h-36 object-contain"/>
        <p className="text-[11px] text-slate-600 truncate mt-1" title={p.name}>{p.name}</p>
      </div>)}
    </div>}
    <div className="border-t border-slate-200 pt-4">
      <label htmlFor="barcode-manual" className="label">Oppure inserisci il codice EAN/UPC stampato sotto le barre</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id="barcode-manual" inputMode="numeric" className="field max-w-xs" placeholder="EAN-13 / UPC-A" value={typedCode} onChange={e => setTypedCode(e.target.value)} maxLength={18}/>
        <button className="btn-soft" type="button" disabled={busy || !validBarcode(trimmed)} onClick={() => void searchManual()}><Search size={16}/> Cerca codice</button>
      </div>
      {!!typedCode && !validBarcode(trimmed) && <p className="text-xs text-amber-700 mt-1">Inserisci 8, 12, 13 o 14 cifre con codice di controllo valido.</p>}
    </div>
    {busy && <p role="status" className="text-sm font-semibold text-teal animate-pulse">{progress}</p>}
    <p className="small">Quando il codice non si legge o non è censito, prova l'OCR sul testo del retro e ti lascia correggere i dati manualmente. Non vengono aggiunti album senza la tua conferma.</p>
  </section>;
}
