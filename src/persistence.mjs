import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
export function persistence(desk,file){
 if(file===':memory:')return ()=>{};
 mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 try{
  const saved=JSON.parse(readFileSync(file,'utf8'));
  if(saved.version!==1||!Array.isArray(saved.workspaces)||saved.workspaces.length>500)throw Error('Invalid state format');
  for(const w of saved.workspaces){
   if(typeof w.id!=='string'||!Array.isArray(w.quotes)||!Array.isArray(w.receipts)||!Array.isArray(w.events))throw Error('Invalid workspace');
   // Receipts survive restart, but unapproved quotes require fresh human review.
   w.quote=null;desk.event(w,'server_restarted',{reason:'Unapproved quotes invalidated; historical receipts retained.'});desk.workspaces.set(w.id,w);
  }
 }catch(e){if(e.code!=='ENOENT')throw e;}
 return ()=>{const temp=file+'.tmp';writeFileSync(temp,JSON.stringify({version:1,workspaces:[...desk.workspaces.values()]}),{mode:0o600});renameSync(temp,file);};
}
