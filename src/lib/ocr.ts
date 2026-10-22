import { createWorker, PSM } from 'tesseract.js';
import type { OCRDraft, PhotoFile } from './types';
import { uid, normalize, similarity } from './helpers';

export interface Region { x: number; y: number; width: number; height: number; }
export interface ScanSettings { thorough?: boolean; }
export interface ReadCandidate { text: string; confidence: number; score: number; angle: number; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

/** Funzione pura: identifica confini di coste tramite picchi di discontinuità di luminanza. */
export function detectBoundaries(scores: number[], minWidth: number, maxRegions = 30): number[] {
  if (scores.length < 50) return [0, scores.length];
  const smoothed = scores.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(scores.length - 1, i + 2); j++) { sum += scores[j]; n++; }
    return sum / n;
  });
  const sorted = [...smoothed].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.50)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const threshold = median + Math.max(3, (high - median) * 0.35);
  const peaks: number[] = [];
  for (let i = minWidth; i < scores.length - minWidth; i++) {
    if (smoothed[i] < threshold || smoothed[i] < smoothed[i - 1] || smoothed[i] < smoothed[i + 1]) continue;
    if (peaks.length && i - peaks[peaks.length - 1] < minWidth) {
      if (smoothed[i] > smoothed[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
    } else peaks.push(i);
  }
  const result = [0, ...peaks, scores.length];
  const filtered = [0];
  for (const p of result.slice(1)) { if (p - filtered[filtered.length - 1] >= minWidth * 0.8) filtered.push(p); }
  if (filtered[filtered.length - 1] !== scores.length) filtered.push(scores.length);
  // Ricava al massimo maxRegions fessure, scartando gradualmente i confini meno forti.
  while (filtered.length > maxRegions + 1) {
    let weakest = 1;
    for (let i = 2; i < filtered.length - 1; i++) if (smoothed[filtered[i]] < smoothed[filtered[weakest]]) weakest = i;
    filtered.splice(weakest, 1);
  }
  return filtered;
}

export async function prepareCanvas(photo: PhotoFile): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = photo.objectUrl;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Immagine illeggibile')); });
  const rotated = photo.rotation === 90 || photo.rotation === 270;
  const sourceW = rotated ? image.naturalHeight : image.naturalWidth;
  const sourceH = rotated ? image.naturalWidth : image.naturalHeight;
  const scale = Math.min(1, 3600 / Math.max(sourceW, sourceH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceW * scale));
  canvas.height = Math.max(1, Math.round(sourceH * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((photo.rotation * Math.PI) / 180);
  ctx.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}
function columnGradient(canvas: HTMLCanvasElement): number[] {
  const {width:w,height:h}=canvas;
  const {data}=canvas.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,w,h);
  const step=Math.max(1,Math.floor(h/260));
  const sum=new Float64Array(w), count=new Uint32Array(w);
  let rows=0;
  for(let y=Math.floor(h*.05);y<Math.floor(h*.95);y+=step){
    rows++;
    for(let x=1;x<w;x++){
      const k=(y*w+x)*4,j=k-4;
      const delta=Math.abs(data[k]-data[j])*.299+Math.abs(data[k+1]-data[j+1])*.587+Math.abs(data[k+2]-data[j+2])*.114;
      sum[x]+=delta;
      if(delta>27)count[x]++;
    }
  }
  return Array.from({length:w},(_,x)=>sum[x]/Math.max(1,rows)+35*count[x]/Math.max(1,rows));
}
export function proposeRegions(canvas:HTMLCanvasElement):Region[] {
  const minW=Math.max(16,Math.round(canvas.width/130));
  const limits=detectBoundaries(columnGradient(canvas),minW,36);
  const regions=limits.slice(0,-1).map((x,i)=>({x,y:0,width:limits[i+1]-x,height:canvas.height}))
    .filter(r=>r.width>=minW && r.height/r.width>=1.65 && r.width<=canvas.width*.35);
  // Non suddividere mai artificialmente una foto in 10 dischi.
  if(!regions.length && canvas.height>canvas.width*1.6)
    return [{x:0,y:0,width:canvas.width,height:canvas.height}];
  return regions;
}
type Variant = 'contrast' | 'adaptive';
function enhancedCrop(canvas:HTMLCanvasElement,b:Region,degrees:number,variant:Variant):HTMLCanvasElement {
  const x=clamp(Math.floor(b.x-2),0,canvas.width-1),y=clamp(Math.floor(b.y-2),0,canvas.height-1);
  const w=Math.max(1,Math.min(canvas.width-x,Math.ceil(b.width+4)));
  const h=Math.max(1,Math.min(canvas.height-y,Math.ceil(b.height+4)));
  const scale=clamp(Math.min(2.8,3000/Math.max(w,h),84/Math.min(w,h)),1,2.8);
  const raw=document.createElement('canvas');
  raw.width=Math.max(1,Math.round(w*scale));
  raw.height=Math.max(1,Math.round(h*scale));
  const ctx=raw.getContext('2d',{willReadFrequently:true})!;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(canvas,x,y,w,h,0,0,raw.width,raw.height);
  const img=ctx.getImageData(0,0,raw.width,raw.height),px=img.data;
  const n=raw.width*raw.height,gray=new Uint8Array(n),hist=new Uint32Array(256);
  let borderSum=0,borderCount=0;
  for(let i=0;i<n;i++){
    const k=i*4,v=Math.round(px[k]*.299+px[k+1]*.587+px[k+2]*.114);
    gray[i]=v;hist[v]++;
    const cx=i%raw.width,cy=Math.floor(i/raw.width);
    if(cx<3||cx>=raw.width-3||cy<3||cy>=raw.height-3){borderSum+=v;borderCount++;}
  }
  let lo=0,hi=255,acc=0;
  for(let i=0;i<256;i++){acc+=hist[i];if(acc>=n*.035){lo=i;break;}}
  acc=0;
  for(let i=255;i>=0;i--){acc+=hist[i];if(acc>=n*.035){hi=i;break;}}
  const inverted=borderCount>0 && borderSum/borderCount<118,span=Math.max(28,hi-lo);
  const normalized=new Uint8Array(n);
  for(let i=0;i<n;i++){
    const value=clamp(Math.round((gray[i]-lo)*255/span),0,255);
    normalized[i]=inverted?255-value:value;
  }
  let integral:Uint32Array|undefined;
  if(variant==='adaptive'){
    const stride=raw.width+1;
    integral=new Uint32Array(stride*(raw.height+1));
    for(let yy=1;yy<=raw.height;yy++){
      let rowSum=0;
      for(let xx=1;xx<=raw.width;xx++){
        rowSum+=normalized[(yy-1)*raw.width+xx-1];
        integral[yy*stride+xx]=integral[(yy-1)*stride+xx]+rowSum;
      }
    }
  }
  for(let i=0;i<n;i++){
    const cx=i%raw.width,cy=Math.floor(i/raw.width);
    let value=normalized[i];
    if(integral){
      const radius=clamp(Math.round(raw.width*.08),8,24),left=Math.max(0,cx-radius),right=Math.min(raw.width,cx+radius+1);
      const top=Math.max(0,cy-radius),bottom=Math.min(raw.height,cy+radius+1),stride=raw.width+1;
      const average=(integral[bottom*stride+right]-integral[top*stride+right]-integral[bottom*stride+left]+integral[top*stride+left])/((right-left)*(bottom-top));
      value=value<average-9?0:255;
    }else if(cx>0&&cx<raw.width-1){
      value=clamp(Math.round(value*1.18-(normalized[i-1]+normalized[i+1])*.09),0,255);
    }
    const k=i*4;px[k]=px[k+1]=px[k+2]=value;px[k+3]=255;
  }
  ctx.putImageData(img,0,0);
  const turned=document.createElement('canvas'),sideways=Math.abs(degrees)%180===90;
  turned.width=(sideways?raw.height:raw.width)+32;
  turned.height=(sideways?raw.width:raw.height)+32;
  const out=turned.getContext('2d')!;
  out.fillStyle='white';out.fillRect(0,0,turned.width,turned.height);
  out.translate(turned.width/2,turned.height/2);
  out.rotate(degrees*Math.PI/180);
  out.drawImage(raw,-raw.width/2,-raw.height/2);
  return turned;
}
export function assessOCR(text:string,confidence:number):number {
  const s=text.trim().replace(/\s+/g,' ');
  if(s.length<4)return -100;
  const letters=(s.match(/\p{L}/gu)||[]).length,alnum=(s.match(/[\p{L}\p{N}]/gu)||[]).length;
  if(letters<3||alnum/s.length<.56)return -100;
  const punctuation=s.length-alnum-(s.match(/\s/g)||[]).length;
  const repeats=/(.)\1{4,}/u.test(s)?20:0;
  const words=s.split(' ').filter(Boolean).length;
  return clamp(confidence,0,100)*.8+Math.min(16,letters*.65)-punctuation*2-repeats-Math.max(0,words-16)*3;
}
export function chooseRead(reads:ReadCandidate[]):ReadCandidate|undefined {
  const valid=reads.filter(r=>assessOCR(r.text,r.confidence)>=24);
  if(!valid.length)return undefined;
  for(const read of valid){
    read.score=assessOCR(read.text,read.confidence);
    const matches=valid.filter(other=>other!==read&&similarity(read.text,other.text)>.78).length;
    read.score+=Math.min(9,matches*4.5);
  }
  return valid.sort((a,b)=>b.score-a.score)[0];
}
function parseSpine(text: string): { artist: string; album: string } {
  const clean = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  const split = clean.split(/\s+(?:[-–—|•:])\s+/);
  if (split.length >= 2 && split[0].length > 1 && split[1].length > 1) return { artist: split[0], album: split.slice(1).join(' - ') };
  return { artist: '', album: clean }; // mai indovinare un artista senza separatore
}
export function draftFromText(photoId: string, region: Region, text: string, confidence: number): OCRDraft {
  const parsed = parseSpine(text);
  return { id: uid(), photoId, bounds: region, text, confidence,
    artist: parsed.artist, album: parsed.album, candidates: [], editions: [],
    selectedMbid: '', selectedReleaseId: '', loading: false, error: '' };
}
export async function scanCanvas(
  canvas:HTMLCanvasElement,photoId:string,regions:Region[],
  onProgress:(n:number,total:number)=>void,settings:ScanSettings={thorough:true}
):Promise<OCRDraft[]> {
  if(!regions.length){onProgress(0,0);return [];}
  const worker=await createWorker('eng',1,{cacheMethod:'write'});
  const result:OCRDraft[]=[];
  try {
    await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300',tessedit_pageseg_mode:PSM.SINGLE_LINE});
    let currentMode:string=PSM.SINGLE_LINE;
    const read=async(r:Region,angle:number,variant:Variant,psm:PSM):Promise<ReadCandidate>=>{
      if(currentMode!==psm){await worker.setParameters({tessedit_pageseg_mode:psm});currentMode=psm;}
      const image=enhancedCrop(canvas,r,angle,variant);
      const {data}=await worker.recognize(image);
      const text=data.text.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
      return {text,confidence:data.confidence,score:assessOCR(text,data.confidence),angle};
    };
    for(let i=0;i<regions.length;i++){
      const r=regions[i],angles=r.height>r.width*1.25?[90,270]:[0,180];
      const reads:ReadCandidate[]=[];
      for(const angle of angles)reads.push(await read(r,angle,'contrast',PSM.SINGLE_LINE));
      let best=chooseRead(reads);
      if(settings.thorough!==false&&(!best||best.confidence<77||best.score<77)){
        for(const angle of angles)reads.push(await read(r,angle,'adaptive',PSM.SINGLE_LINE));
        best=chooseRead(reads);
        if(!best||best.confidence<56){
          reads.push(await read(r,best?.angle??angles[0],'contrast',PSM.SPARSE_TEXT));
          best=chooseRead(reads);
        }
      }
      if(best&&best.confidence>=25&&assessOCR(best.text,best.confidence)>=30&&normalize(best.text).length>=4
        &&!result.some(d=>similarity(d.text,best.text)>=.93)){
        result.push(draftFromText(photoId,r,best.text,Math.round(best.confidence)));
      }
      onProgress(i+1,regions.length);
    }
  }finally{await worker.terminate();}
  return result;
}
export async function scanPhoto(photo: PhotoFile, onProgress: (n: number, total: number) => void) {
  const canvas = await prepareCanvas(photo);
  return scanCanvas(canvas, photo.id, proposeRegions(canvas), onProgress);
}
