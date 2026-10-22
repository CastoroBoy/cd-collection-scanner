import type { CdItem } from './types';
import { money, saleValue } from './helpers';
export const csvHeader = ['CD', 'Album', 'Data uscita', 'Venduto 1', 'Venduto 2', 'Venduto 3'];
export const csvRows = (items: CdItem[]) => items.map(c => [
  c.artist, c.album, c.firstReleaseDate,
  ...Array.from({ length: 3 }, (_, i) => c.sales[i] ? (saleValue(c.sales[i]) === undefined ? money(c.sales[i].amount, c.sales[i].currency) : money(saleValue(c.sales[i]))) : 'N.D.')
]);
function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportCSV(items: CdItem[]) {
  const quote = (value: string) => {
    const safe = /^[\s]*[=+@-]/.test(value) ? `\'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const output = [csvHeader, ...csvRows(items)].map(row => row.map(quote).join(';')).join('\r\n');
  download(new Blob(['\uFEFF', output], { type: 'text/csv;charset=utf-8' }), 'collezione-cd.csv');
}
/** XLSX OpenXML reale creato nel browser, senza Node.js o polyfill. */
export async function exportXLSX(items: CdItem[]) {
  const { zipSync, strToU8 } = await import('fflate');
  const xml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const colName = (idx: number) => {
    let n = idx + 1, out = '';
    while (n > 0) { n--; out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26); }
    return out;
  };
  function worksheet(rows: (string | number)[][], widths: number[], moneyColumns: number[] = []) {
    const head = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
    const cols = widths.map((w, i) => `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
    const body = rows.map((cells, ri) => `<row r="${ri + 1}">` + cells.map((val, ci) => {
      const address = `${colName(ci)}${ri + 1}`;
      const style = ri === 0 ? ' s="1"' : typeof val === 'number' && moneyColumns.includes(ci) ? ' s="2"' : '';
      return typeof val === 'number' && Number.isFinite(val)
        ? `<c r="${address}"${style} t="n"><v>${val}</v></c>`
        : `<c r="${address}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(val)}</t></is></c>`;
    }).join('') + '</row>').join('');
    const lastColumn = colName(Math.max(0, widths.length - 1));
    return `${head}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${lastColumn}${Math.max(1, rows.length)}"/></worksheet>`;
  }
  const main: (string | number)[][] = [['CD','Album','Data uscita','Venduto 1 (EUR)','Venduto 2 (EUR)','Venduto 3 (EUR)']];
  for (const c of items) main.push([c.artist, c.album, c.firstReleaseDate || 'N.D.',
    ...[0,1,2].map(i => c.sales[i] && saleValue(c.sales[i]) !== undefined ? saleValue(c.sales[i])! : 'N.D.')]);
  const details: (string | number)[][] = [[
    'CD','Album','Prezzo originale','Valuta','Prezzo EUR','Cambio verso EUR','Data cambio','Data vendita',
    'Mercato','Titolo inserzione','Condizioni','URL fonte','Spedizione originale','Provider','Nota prezzo'
  ]];
  for (const c of items) for (const s of c.sales) details.push([
    c.artist, c.album, s.amount, s.currency, s.eurAmount ?? '', s.rateToEur ?? '', s.rateDate ?? '',
    s.soldAt, s.marketplace, s.listingTitle, s.condition, s.url, s.shippingAmount ?? '', s.provider, s.priceNote
  ]);
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const relationship = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Collezione" sheetId="1" r:id="rId1"/><sheet name="Fonti vendite" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const bookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;€&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF152444"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes), '_rels/.rels': strToU8(relationship),
    'xl/workbook.xml': strToU8(workbook), 'xl/_rels/workbook.xml.rels': strToU8(bookRels),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(worksheet(main,[28,40,18,20,20,20],[3,4,5])),
    'xl/worksheets/sheet2.xml': strToU8(worksheet(details,[28,40,18,12,18,18,15,18,12,55,20,70,20,14,65],[2,4,12]))
  };
  const archive = zipSync(files, { level: 6 });
  download(new Blob([new Uint8Array(archive)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'collezione-cd.xlsx');
}
export function exportJSON(items: CdItem[]) {
  download(new Blob([JSON.stringify({ application: 'CD Collection Scanner', version: 1,
    exportedAt: new Date().toISOString(), cds: items }, null, 2)], { type: 'application/json' }), 'collezione-cd-backup.json');
}
export async function parseBackup(file: File): Promise<CdItem[]> {
  if (file.size > 20_000_000) throw new Error('Backup troppo grande (limite 20 MB).');
  let parsed: any;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('JSON non valido.'); }
  if (parsed?.application !== 'CD Collection Scanner' || parsed?.version !== 1 || !Array.isArray(parsed.cds)) throw new Error('Formato del backup non riconosciuto.');
  if (parsed.cds.length > 100_000) throw new Error('Backup oltre il limite di 100.000 CD.');
  return parsed.cds.map((c: any) => {
    if (typeof c.id !== 'string' || typeof c.artist !== 'string' || typeof c.album !== 'string' || !Array.isArray(c.sales))
      throw new Error('Un CD contiene campi non validi.');
    const validUrl = (s: any) => {
      try {
        const u = new URL(s.url);
        return u.protocol === 'https:' && u.pathname.includes('/itm/') && /^(www\.)?ebay\.(it|de|fr|es|co\.uk|com)$/.test(u.hostname);
      } catch { return false; }
    };
    return { ...c, artist: c.artist.slice(0, 300), album: c.album.slice(0, 300),
      sales: c.sales.filter((s: any) => s && typeof s.url === 'string' && validUrl(s) &&
        typeof s.listingTitle === 'string' && typeof s.currency === 'string' &&
        typeof s.amount === 'number' && Number.isFinite(s.amount) && s.amount > 0 &&
        typeof s.soldAt === 'string' && typeof s.marketplace === 'string').slice(0, 3) } as CdItem;
  });
}
