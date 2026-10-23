// Integer pricing and offer identity adapted from Sumplus Model Desk (MIT).
import {createHash,randomUUID} from 'node:crypto';
export const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const usd=n=>'$'+(n/1e6).toFixed(6).replace(/0{1,4}$/,'');
// Convert the decimal text supplied by JSON to an exact fraction, including exponents.
// The source API's binary JSON Number has already been decoded; String preserves its
// round-trip decimal value. No Math.round(rate*1e6) reduction is performed.
export function decimalRate(value){
 const [mantissa,exp='0']=String(value).toLowerCase().split('e');
 const [whole,decimal='']=mantissa.split('.');
 const digits=BigInt(whole+decimal);const power=6+Number(exp)-decimal.length;
 return power>=0?{numerator:String(digits*10n**BigInt(power)),denominator:'1'}:{numerator:String(digits),denominator:String(10n**BigInt(-power))};
}
export const costOf=(n,rate)=>{
 if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid tokens');
 const a=typeof rate==='object'?BigInt(rate.numerator):BigInt(rate);
 const d=1000000n*(typeof rate==='object'?BigInt(rate.denominator):1n);
 if(a<0n||d<=0n)throw Error('Invalid rate');
 const value=(BigInt(n)*a+d-1n)/d;
 if(value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Cost overflow');
 return Number(value);
};
export function catalogueOf(raw,source,capturedAt){
 const rows=Array.isArray(raw)?raw:raw.data;
 if(!Array.isArray(rows)||!rows.length)throw Error('No catalogue rows');
 const offers=[],invalid=[];
 for(const r of rows){
  const nums=[r.context,r.max_output,r.input_per_million,r.output_per_million];
  if(typeof r.id!=='string'||typeof r.line!=='string'||nums.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0)||!Number.isSafeInteger(r.context)||!Number.isSafeInteger(r.max_output)||Math.max(...nums)>1e9){invalid.push({id:r.id??null,reason:'Missing or invalid limits/prices'});continue;}
  offers.push({modelId:r.id,line:r.line,name:typeof r.name==='string'?r.name:r.id,context:r.context,maxOutput:r.max_output,availability:r.availability??'unknown',inputRate:decimalRate(r.input_per_million),outputRate:decimalRate(r.output_per_million),inputPerMillion:String(r.input_per_million),outputPerMillion:String(r.output_per_million)});
 }
 const keys=new Set();for(const o of offers){const k=JSON.stringify([o.modelId,o.line]);if(keys.has(k))throw Error('Duplicate model/line identity');keys.add(k);}
 if(!offers.length)throw Error('No valid offers');
 offers.sort((a,b)=>JSON.stringify([a.modelId,a.line]).localeCompare(JSON.stringify([b.modelId,b.line])));
 return {snapshotId:hash(offers),source,capturedAt,offers,inputRows:rows.length,invalid};
}
export function validateRequest(r){
 if(!r||typeof r!=='object')throw Error('Task required');
 if(typeof r.task!=='string'||!r.task.trim()||r.task.length>600)throw Error('Describe a task in 1–600 characters');
 for(const k of ['inputTokens','outputTokens'])if(!Number.isSafeInteger(r[k])||r[k]<1||r[k]>2000000)throw Error(k+' must be a whole number from 1 to 2000000');
 if(!Number.isSafeInteger(r.budgetMicro)||r.budgetMicro<0||r.budgetMicro>1000000000)throw Error('Budget must be 0–1000 USD in whole micro-dollars');
 if(typeof r.allowedLine!=='string'||r.allowedLine.length>100)throw Error('Invalid service line');
 if(typeof r.modelId!=='string'||r.modelId.length>150)throw Error('Invalid model filter');
 if(r.pricingMode!==undefined&&!['snapshot','historical'].includes(r.pricingMode))throw Error('Invalid pricing mode');
 return {pricingMode:r.pricingMode??'snapshot',task:r.task.trim(),inputTokens:r.inputTokens,outputTokens:r.outputTokens,budgetMicro:r.budgetMicro,allowedLine:r.allowedLine,modelId:r.modelId};
}
export function compare(snapshot,r){
 const eligible=[],rejected=[];
 for(const o of snapshot.offers){
  let reason;
  const cost=costOf(r.inputTokens,o.inputRate)+costOf(r.outputTokens,o.outputRate);
  if(!o.context||!o.maxOutput)reason='Not token priced';
  else if(BigInt(o.inputRate.numerator)<=0n||BigInt(o.outputRate.numerator)<=0n)reason='Zero/missing price is not approvable';
  else if(o.availability!=='live')reason='Not marked live';
  else if(r.allowedLine&&o.line!==r.allowedLine)reason='Outside requested service line';
  else if(r.modelId&&o.modelId!==r.modelId)reason='Outside requested model';
  else if(r.inputTokens+r.outputTokens>o.context)reason=`Context ${o.context} < requested ${r.inputTokens+r.outputTokens}`;
  else if(r.outputTokens>o.maxOutput)reason=`Output limit ${o.maxOutput} < requested ${r.outputTokens}`;
  else if(cost>r.budgetMicro)reason=`Over budget: ${usd(cost)} > ${usd(r.budgetMicro)}`;
  const row={...o,costMicro:cost};
  if(reason)rejected.push({...row,reason});else eligible.push(row);
 }
 eligible.sort((a,b)=>a.costMicro-b.costMicro||a.modelId.localeCompare(b.modelId)||a.line.localeCompare(b.line));
 return {eligible,rejected,total:snapshot.offers.length};
}
export class DeskError extends Error{constructor(code,message){super(message);this.code=code;}}
export class Desk{
 constructor(snapshot,{now=()=>Date.now(),maxSnapshotAgeMs=86400000}={}){this.snapshot=snapshot;this.now=now;this.maxSnapshotAgeMs=maxSnapshotAgeMs;this.workspaces=new Map();}
 fail(w,code,message){if(w)this.event(w,'refused',{code,message});throw new DeskError(code,message);}
 event(w,type,data={}){w.events.push({at:new Date(this.now()).toISOString(),type,...data});if(w.events.length>100)w.events.shift();}
 get(id){const w=this.workspaces.get(id);if(!w)throw new DeskError('WORKSPACE_GONE','This workspace is unknown or the server restarted. Start a new session.');w.lastSeen=this.now();return w;}
 start(){
  // Keep demo memory bounded; oldest idle workspaces expire first. No funds or credentials exist here.
  if(this.workspaces.size>=500){const oldest=[...this.workspaces.values()].sort((a,b)=>a.lastSeen-b.lastSeen)[0];this.workspaces.delete(oldest.id);}
  const w={id:randomUUID(),revision:0,request:null,quote:null,quotes:[],receipts:[],events:[],lastSeen:this.now()};this.workspaces.set(w.id,w);this.event(w,'started');return this.view(w);
 }
 update(id,request){const w=this.get(id);const r=validateRequest(request);if(hash(r)!==hash(w.request)){w.request=r;w.revision++;w.quote=null;this.event(w,'task_updated',{revision:w.revision,reason:'Any previous unapproved quote is invalid.'});}return this.view(w);}
 quote(id,{modelId,line,ttlSeconds=90}={}){
  const w=this.get(id);if(!w.request)this.fail(w,'NEEDS_TASK','Review task and token limits first.');
  if(!Number.isInteger(ttlSeconds)||ttlSeconds<5||ttlSeconds>120)this.fail(w,'INVALID_TTL','Quote lifetime must be 5–120 seconds.');
  const age=this.now()-Date.parse(this.snapshot.capturedAt);
  if(!Number.isFinite(age)||age< -60000||(w.request.pricingMode!=='historical'&&age>this.maxSnapshotAgeMs))this.fail(w,'STALE_CATALOGUE','Catalogue is too old for approval. Refresh it and request a new quote.');
  const compared=compare(this.snapshot,w.request);
  const o=modelId||line?compared.eligible.find(o=>o.modelId===modelId&&o.line===line):compared.eligible[0];
  if(!o)this.fail(w,'NO_APPROVABLE_OFFER','No offer fits the reviewed task, line, model, capacity and budget. Inspect rejection reasons.');
  const q={id:randomUUID(),pricingMode:w.request.pricingMode,workspaceId:id,revision:w.revision,requestHash:hash(w.request),snapshotId:this.snapshot.snapshotId,offer:{modelId:o.modelId,line:o.line},inputRate:o.inputRate,outputRate:o.outputRate,costMicro:o.costMicro,expiresAt:this.now()+ttlSeconds*1000,issuedAt:this.now()};
  q.digest=hash(q);w.quote=q;w.quotes.push(structuredClone(q));if(w.quotes.length>100)w.quotes.shift();this.event(w,'quote_created',{quoteId:q.id,costMicro:q.costMicro,expiresAt:q.expiresAt});return this.view(w);
 }
 invalidate(id){const w=this.get(id);if(w.quote){w.quote=null;w.revision++;this.event(w,'draft_changed',{revision:w.revision,reason:'Unapproved quote withdrawn before draft editing.'});}return this.view(w);}
 confirm(id,quoteId){
  const w=this.get(id);const existing=w.receipts.find(r=>r.quoteId===quoteId);if(existing)return {...this.view(w),receipt:existing,replayed:true};
  const q=w.quotes.find(q=>q.id===quoteId);if(!q)this.fail(w,'UNKNOWN_QUOTE','This quote does not belong to this workspace.');
  if(w.quote?.id!==quoteId||q.revision!==w.revision||q.requestHash!==hash(w.request))this.fail(w,'INPUT_CHANGED','The task or selection changed. Request and review a new quote.');
  if(this.now()>=q.expiresAt)this.fail(w,'QUOTE_EXPIRED','The quote expired. Request and review a fresh quote.');
  if(q.snapshotId!==this.snapshot.snapshotId)this.fail(w,'CATALOGUE_CHANGED','The catalogue changed. Review a fresh quote.');
  if(q.pricingMode!=='historical'&&this.now()-Date.parse(this.snapshot.capturedAt)>this.maxSnapshotAgeMs)this.fail(w,'STALE_CATALOGUE','Catalogue is too old. Refresh before approval.');
  const o=compare(this.snapshot,w.request).eligible.find(o=>o.modelId===q.offer.modelId&&o.line===q.offer.line);
  if(!o||o.costMicro!==q.costMicro)this.fail(w,'QUOTE_MISMATCH','Recalculation failed. Review a fresh quote.');
  const receipt={id:randomUUID(),quoteId:q.id,revision:w.revision,approvedAt:new Date(this.now()).toISOString(),kind:'SIMULATED_PROCUREMENT_APPROVAL',pricingMode:q.pricingMode,request:structuredClone(w.request),offer:q.offer,expectedCostMicro:q.costMicro,amountChargedMicro:0,snapshot:{id:this.snapshot.snapshotId,source:this.snapshot.source,capturedAt:this.snapshot.capturedAt},quoteDigest:q.digest,execution:'No purchase, model request, reservation, or payment was made.'};
  w.receipts.push(receipt);this.event(w,'simulated_approval',{receiptId:receipt.id,quoteId:q.id,amountChargedMicro:0});return {...this.view(w),receipt,replayed:false};
 }
 view(w){return structuredClone({id:w.id,revision:w.revision,request:w.request,quote:w.quote,receipts:w.receipts,events:w.events,now:this.now(),snapshot:{snapshotId:this.snapshot.snapshotId,source:this.snapshot.source,capturedAt:this.snapshot.capturedAt,offerCount:this.snapshot.offers.length,invalidCount:this.snapshot.invalid.length},comparison:w.request?compare(this.snapshot,w.request):null});}
}
