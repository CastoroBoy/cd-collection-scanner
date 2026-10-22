import { describe, expect, it } from 'vitest';
import { equivalent, estimate, normalize, soldSearchUrl, uniqueCds } from '../lib/helpers';
import { validateSales } from '../lib/prices';
import { assessOCR, chooseRead, detectBoundaries } from '../lib/ocr';
import type { CdItem, SoldSale } from '../lib/types';
const cd: CdItem = { id:'a',artist:'Pink Floyd',album:'The Wall',firstReleaseDate:'1979',editionDate:'',editionCountry:'',editionNote:'',
  mbid:'',releaseId:'',ocrText:'',ocrConfidence:null,confidence:'confermato',sales:[],lastPriceCheck:'',lastMusicCheck:'',createdAt:'',updatedAt:'' };
const makeSale = (title: string): SoldSale => ({ id:'sale1',amount:12.5,currency:'GBP',eurAmount:14,soldAt:'2026-10-15',
  marketplace:'GB',listingTitle:title,condition:'Used',url:'https://www.ebay.co.uk/itm/1234',provider:'trawl',checkedAt:'2026-10-16',priceNote:'documented' });
describe('integrità catalogo e vendite', () => {
  it('normalizza caratteri accentati senza cambiare artista', () => expect(normalize('Björk – Début')).toBe('bjork debut'));
  it('rimuove duplicati dopo due foto della stessa edizione', () => expect(uniqueCds([cd,{...cd,id:'b'}])).toHaveLength(1));
  it('distingue edizioni fisiche diverse', () => expect(equivalent({...cd,releaseId:'edition1'}, {...cd,releaseId:'edition2'})).toBe(false));
  it('non accetta vinili, lotti, DVD o titoli diversi', () => {
    expect(validateSales(cd,[makeSale('Pink Floyd The Wall vinyl LP')])).toHaveLength(0);
    expect(validateSales(cd,[makeSale('Pink Floyd The Wall CD lot collection')])).toHaveLength(0);
    expect(validateSales(cd,[makeSale('Queen The Wall CD')])).toHaveLength(0);
  });
  it('conserva soltanto vendite CD comparabili e non le inventa', () => {
    expect(validateSales(cd,[])).toHaveLength(0);
    expect(validateSales(cd,[makeSale('Pink Floyd The Wall CD Original')])).toHaveLength(1);
    expect(validateSales(cd,[makeSale('Pink Floyd The Wall CD Original'),makeSale('Pink Floyd The Wall CD Original')])).toHaveLength(1);
  });
  it('esclude dalla stima CD senza vendite documentate', () => {
    const result = estimate([{...cd, sales:[makeSale('Pink Floyd The Wall CD Original')]},{...cd,id:'new',album:'Animals'}]);
    expect(result).toEqual({ total:14,included:1,excluded:1 });
  });
  it('costruisce link ai venduti e non annunci attivi', () => expect(soldSearchUrl(cd,'IT')).toContain('LH_Sold=1'));
});
describe('riconoscimento geometrico', () => {
  it('segmenta un profilo sintetico con dieci coste', () => {
    const scores = Array(500).fill(2);
    for (let i=50; i<500; i+=50) scores[i]=150;
    const limits = detectBoundaries(scores, 20, 30);
    expect(limits[0]).toBe(0);
    expect(limits.at(-1)).toBe(500);
    expect(limits.length).toBeGreaterThanOrEqual(9);
  });
});

describe('qualità OCR della costa', () => {
  it('rifiuta sequenze di rumore invece di generare un disco', () => {
    expect(assessOCR('!! | / --?', 95)).toBeLessThan(0);
    expect(chooseRead([{text:'### | ---',confidence:99,score:0,angle:90}])).toBeUndefined();
  });
  it('preferisce una scritta riconoscibile a testo casuale', () => {
    const best=chooseRead([
      {text:'!;!;--- / / / $$$',confidence:96,score:0,angle:90},
      {text:'Pink Floyd - The Wall',confidence:81,score:0,angle:270}
    ]);
    expect(best?.text).toBe('Pink Floyd - The Wall');
  });
  it('non inventa dieci dorsi in un profilo privo di confini', () => {
    expect(detectBoundaries(new Array(700).fill(0),20)).toEqual([0,700]);
  });
});
