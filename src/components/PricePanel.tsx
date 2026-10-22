import { useEffect, useState } from 'react';
import { ExternalLink, PoundSterling, X } from 'lucide-react';
import type { CdItem, Marketplace, SoldSale } from '../lib/types';
import { dateDisplay, marketplaces, money, soldSearchUrl } from '../lib/helpers';
import { automaticCoverage, automaticPriceEnabled, manualSale, priceLabel } from '../lib/prices';

interface Props { cd: CdItem | null; onClose: () => void; onInsert: (cdId: string, sale: SoldSale) => void;
  onSearch: (cdId: string) => void; selected: Marketplace[]; onError: (e: string) => void; }
export default function PricePanel({ cd, onClose, onInsert, onSearch, selected, onError }: Props) {
  const [marketplace, setMarketplace] = useState<Marketplace>('IT');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [condition, setCondition] = useState('Usato');
  const [shipping, setShipping] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setTitle(cd ? `${cd.artist} ${cd.album} CD` : ''); setAmount(''); setDate(''); setUrl(''); setConfirmed(false); }, [cd?.id]);
  if (!cd) return null;
  const currency = marketplace === 'GB' ? 'GBP' : 'EUR';
  const links = marketplaces.filter(m => selected.includes(m.code));
  async function addSale(e: React.FormEvent) {
    e.preventDefault();
    if (!cd || !confirmed) return;
    setSaving(true);
    try {
      const sale = await manualSale(cd, { amount: Number(amount), currency, soldAt: date,
        marketplace, title, url, condition, shipping: shipping ? Number(shipping) : undefined });
      if (cd.sales.some(s => s.url === sale.url)) throw new Error('Questa fonte è già stata registrata.');
      onInsert(cd.id, sale);
      setAmount(''); setDate(''); setUrl(''); setConfirmed(false);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  return <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Prezzi di ${cd.artist} ${cd.album}`}>
    <button className="absolute inset-0 bg-ink/60" onClick={onClose} aria-label="Chiudi dettagli prezzi"/>
    <aside className="relative h-full w-full max-w-xl overflow-auto bg-white shadow-2xl p-5 sm:p-7">
      <div className="flex justify-between items-start gap-3"><div><h2 className="text-2xl font-extrabold text-navy">Vendite documentate</h2>
        <p className="text-slate-600 text-sm mt-1">{cd.artist} — {cd.album}</p></div>
        <button className="btn-soft px-2" onClick={onClose} aria-label="Chiudi"><X size={19}/></button></div>
      <div className="border-y border-slate-200 mt-5 py-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center justify-between"><h3 className="font-bold">Fino a 3 vendite registrate</h3>
          {automaticPriceEnabled && <button className="btn-primary" onClick={() => onSearch(cd.id)}><PoundSterling size={17}/> Cerca automaticamente UK</button>}</div>
        {!cd.sales.length && <p className="small">N.D. — nessuna vendita documentata per questo CD.</p>}
        {cd.sales.map((s, i) => <div key={s.id} className="rounded-xl border border-slate-200 p-3 bg-slate-50">
          <div className="flex gap-2 justify-between"><strong className="text-teal">Venduto {i + 1}: {priceLabel(s)}</strong><span className="text-xs text-slate-500">{s.marketplace} · {dateDisplay(s.soldAt)}</span></div>
          <p className="text-sm font-medium mt-1">{s.listingTitle}</p>
          <p className="text-xs text-slate-500 mt-1">Originale {money(s.amount, s.currency)} · Condizione: {s.condition} · Spedizione: {s.shippingAmount === undefined ? 'N.D.' : money(s.shippingAmount, s.currency)}</p>
          {s.rateToEur !== undefined && <p className="text-xs text-slate-500 mt-1">Cambio: 1 {s.currency} = {s.rateToEur.toFixed(5)} EUR ({s.rateDate})</p>}
          <p className="text-xs text-slate-500 mt-1">{s.priceNote}</p>
          <a className="text-teal underline inline-flex gap-1 items-center text-xs mt-2" target="_blank" rel="noopener noreferrer" href={s.url}><ExternalLink size={13}/> Visualizza la fonte eBay</a>
        </div>)}
        {cd.lastPriceCheck && <p className="text-xs text-slate-500">Ultima ricerca: {dateDisplay(cd.lastPriceCheck)}</p>}
      </div>
      <div className="py-5 space-y-3">
        <h3 className="font-bold">Ricerca assistita eBay</h3>
        <p className="small">Apri solo la sezione <strong>oggetti venduti</strong>. eBay può richiedere l'accesso al sito. Non usare annunci attivi o semplicemente terminati.</p>
        <div className="flex flex-wrap gap-2">{links.map(m => <a key={m.code} className="btn-soft" href={soldSearchUrl(cd, m.code)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> {m.label}</a>)}</div>
        <p className="text-xs text-amber-700">Automatico: {automaticPriceEnabled ? 'solo GB tramite Trawl' : 'non configurato'}. IT, DE, FR, ES richiedono verifica manuale o un provider autorizzato da integrare.</p>
      </div>
      <form onSubmit={addSale} className="border-t border-slate-200 pt-5 space-y-3">
        <h3 className="font-bold">Registra vendita realmente verificata</h3>
        <p className="small">Incolla la singola inserzione venduta e il prezzo <strong>effettivo</strong> che la fonte documenta. Non registrare offerte accettate con importo sconosciuto.</p>
        <div className="grid grid-cols-2 gap-3">
          <label><span className="label">Paese eBay</span><select className="field" value={marketplace} onChange={e => setMarketplace(e.target.value as Marketplace)}>{marketplaces.map(m => <option value={m.code} key={m.code}>{m.label}</option>)}</select></label>
          <label><span className="label">Prezzo ({currency})</span><input className="field" type="number" inputMode="decimal" min="0.01" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)}/></label>
          <label><span className="label">Data vendita</span><input className="field" type="date" required max={new Date().toISOString().slice(0, 10)} value={date} onChange={e => setDate(e.target.value)}/></label>
          <label><span className="label">Spedizione ({currency})</span><input className="field" type="number" min="0" step="0.01" value={shipping} onChange={e => setShipping(e.target.value)}/></label>
        </div>
        <label className="block"><span className="label">Titolo reale inserzione (non solo CD e album)</span><input required className="field" value={title} onChange={e => setTitle(e.target.value)}/></label>
        <label className="block"><span className="label">URL inserzione eBay venduta</span><input required className="field" type="url" placeholder="https://www.ebay.it/itm/..." value={url} onChange={e => setUrl(e.target.value)}/></label>
        <label className="block"><span className="label">Condizioni</span><input className="field" value={condition} onChange={e => setCondition(e.target.value)}/></label>
        <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>
          Ho controllato che l'oggetto sia stato <strong>venduto</strong>, che riguardi questo CD e che l'importo non sia una proposta accettata dal prezzo ignoto.</label>
        <button className="btn-primary w-full" disabled={!confirmed || saving}>{saving ? 'Verifica in corso…' : 'Aggiungi vendita verificata'}</button>
      </form>
    </aside>
  </div>;
}
