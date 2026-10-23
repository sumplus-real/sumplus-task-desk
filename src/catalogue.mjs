import {readFile,writeFile} from 'node:fs/promises';
import {catalogueOf,hash} from './desk.mjs';
export const SOURCE='https://router.sumplus.xyz/v1/models';
export async function loadCatalogue(){
 // No automatic paid requests or catalogue refresh at boot. Frozen provenance is preserved.
 const s=JSON.parse(await readFile(new URL('../snapshots/catalogue.json',import.meta.url),'utf8'));
 if(!Array.isArray(s.offers)||!s.offers.length||hash(s.offers)!==s.snapshotId||!Number.isFinite(Date.parse(s.capturedAt)))throw Error('Snapshot integrity check failed');
 return s;
}
export async function refreshCatalogue(){
 const res=await fetch(SOURCE,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error('Catalogue HTTP '+res.status);
 const raw=await res.json();const snapshot=catalogueOf(raw,SOURCE,new Date().toISOString());
 await writeFile(new URL('../snapshots/catalogue.json',import.meta.url),JSON.stringify(snapshot,null,2)+'\n');
 return snapshot;
}
