import type { CdItem } from './types';
const DB = 'cd-collection-scanner-v1';
const STORE = 'archive';
let opening: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}
export async function readCollection(): Promise<CdItem[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('collection');
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result as CdItem[] : []);
    req.onerror = () => reject(req.error);
  });
}
export async function writeCollection(items: CdItem[]): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(items, 'collection');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transazione IndexedDB annullata'));
  });
}
