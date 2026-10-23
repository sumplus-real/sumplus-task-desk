import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const usd=n=>'$'+(n/1e6).toFixed(6).replace(/0{1,4}$/,'');
let client,state,dirty=false,lastQuoteId=null,lastReceipt=null,showAll=false,pending=0,chain=Promise.resolve();
const call=(name,args={})=>{
 const result=chain.then(async()=>{
  pending++;syncButtons();
  const entry=el('li',name+' · calling');$('tool-log').prepend(entry);
  try{
   const r=await client.callTool({name,arguments:args});
   if(r.isError){const e=JSON.parse(r.content[0].text);entry.textContent=name+' · REFUSED '+e.code;throw Object.assign(Error(e.message),{code:e.code});}
   entry.textContent=name+' · OK';return r.structuredContent??JSON.parse(r.content[0].text);
  }catch(e){entry.textContent=name+' · '+(e.code??'ERROR');throw e;}
  finally{pending--;syncButtons();}
 });
 chain=result.catch(()=>{});return result;
};
function notice(title,message){$('notice').hidden=false;$('notice').replaceChildren(el('strong',title),el('span',message));}
function clearNotice(){$('notice').hidden=true;}
function failed(e){notice(e.code||'REQUEST FAILED',e.message);if(e.code==='WORKSPACE_GONE'){localStorage.removeItem('sumplus-task-desk-workspace');$('connection').textContent='Workspace unavailable · start a new one';}}
function talk(title,message){$('conversation').lastElementChild.replaceChildren(el('strong',title),el('p',message));}
function request(){
 const b=$('budget').value.trim();
 if(!/^\d+(\.\d{1,6})?$/.test(b))throw Error('Use a USD budget with at most six decimal places.');
 const [d,f='']=b.split('.');const budget=BigInt(d)*1000000n+BigInt(f.padEnd(6,'0'));
 if(budget>1000000000n)throw Error('Maximum simulated budget is $1000.');
 return {pricingMode:$('historical').checked?'historical':'snapshot',task:$('task').value,inputTokens:Number($('input-tokens').value),outputTokens:Number($('output-tokens').value),budgetMicro:Number(budget),modelId:$('model').value,allowedLine:$('line').value};
}
function loadRequest(r){if(!r)return;$('historical').checked=r.pricingMode==='historical';$('task').value=r.task;$('input-tokens').value=r.inputTokens;$('output-tokens').value=r.outputTokens;$('budget').value=String(r.budgetMicro/1e6);$('model').value=r.modelId;$('line').value=r.allowedLine;}
function syncButtons(){const busy=pending>0;document.body.classList.toggle('busy',busy);$('review').disabled=!client||busy;$('quote-best').disabled=!state?.comparison?.eligible.length||dirty||busy;$('confirm').disabled=!state?.quote||dirty||busy||Date.now()>=state.quote.expiresAt||state.receipts.some(r=>r.quoteId===state.quote.id);$('attempt-old').disabled=!lastQuoteId||busy;$('replay').disabled=!lastReceipt||busy;}
function apply(s){state=s;$('revision').textContent='REVISION '+s.revision;render();}
function render(){
 $('comparison').hidden=!state.comparison;
 if(state.comparison){
  const c=state.comparison;$('counts').textContent=c.eligible.length+' FIT / '+c.total+' OFFERS';$('offers').replaceChildren();
  for(const o of c.eligible.slice(0,showAll?undefined:4)){
   const row=el('article',undefined,'offer');const body=el('div');body.append(el('h3',o.modelId),el('small',o.line+' · '+o.context.toLocaleString()+' context · '+o.maxOutput.toLocaleString()+' max output'),el('small','$'+o.inputPerMillion+' input / $'+o.outputPerMillion+' output per 1M tokens'));
   const right=el('div',undefined,'price');right.append(el('div',usd(o.costMicro)));const b=el('button','Quote this offer');b.disabled=dirty||pending>0;b.onclick=()=>quote(o);right.append(b);row.append(body,right);$('offers').append(row);
  }
  $('more-offers').hidden=showAll||c.eligible.length<=4;
  $('rejected-count').textContent=c.rejected.length+' offers ruled out · inspect every reason';$('rejected').replaceChildren();
  for(const r of c.rejected){const row=el('div',undefined,'rejected-row');row.append(el('strong',r.modelId+' / '+r.line),el('span',r.reason));$('rejected').append(row);}
 }
 $('quote-empty').hidden=!!state.quote;$('quote').hidden=!state.quote;
 if(state.quote){
  const q=state.quote;lastQuoteId=q.id;$('quote').replaceChildren(el('div',usd(q.costMicro),'quote-amount'),el('div','Expected token-cost ceiling · one task','quote-caption'));
  const dl=el('dl',undefined,'quote-details');for(const [k,v] of [['Price mode',q.pricingMode==='historical'?'HISTORICAL REPLAY':'Captured snapshot'],['Model',q.offer.modelId],['Service line',q.offer.line],['Input / output',state.request.inputTokens.toLocaleString()+' / '+state.request.outputTokens.toLocaleString()],['Budget',usd(state.request.budgetMicro)],['Revision',String(q.revision)],['Snapshot',q.snapshotId.slice(0,12)+'…']]){const row=el('div');row.append(el('dt',k),el('dd',v));dl.append(row);}$('quote').append(dl,el('div','','quote-status'));updateClock();
 }
 const approved=state.quote&&state.receipts.some(r=>r.quoteId===state.quote.id);
 document.querySelectorAll('.steps li').forEach((li,i)=>li.classList.toggle('active',i< (approved?3:state.quote?2:1)));
 if(state.receipts.length){lastReceipt=state.receipts.at(-1);renderReceipt(lastReceipt);}
 syncButtons();
}
function updateClock(){
 if(!state?.quote)return;const q=state.quote,box=$('quote').querySelector('.quote-status');if(!box)return;
 const secs=Math.max(0,Math.ceil((q.expiresAt-Date.now())/1000));const done=state.receipts.some(r=>r.quoteId===q.id);
 box.textContent=done?'Approved in simulation · charged $0.00':dirty?'Draft changed · previous quote withdrawn':secs?'Review this exact scope · expires in '+secs+'s':'Quote expired · request a fresh estimate';syncButtons();
}
function renderReceipt(r){$('receipt').hidden=false;const download=el('button','Export receipt JSON ↗');download.onclick=()=>{const blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json'});const a=el('a');a.href=URL.createObjectURL(blob);a.download='sumplus-simulated-approval-'+r.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};$('receipt').replaceChildren(el('h3','✓ Simulated approval recorded'),el('p',r.offer.modelId+' / '+r.offer.line+' · '+usd(r.expectedCostMicro)+' expected. '+usd(r.amountChargedMicro)+' charged.'),el('p',(r.pricingMode==='historical'?'Historical snapshot replay. ':'Captured-price simulation. ')+r.execution),download);}
async function review(){
 clearNotice();try{const r=request();dirty=true;const s=await call('review_task',{workspaceId:state.id,request:r});dirty=false;showAll=false;apply(s);const c=s.comparison;
 if(c.eligible.length)talk('The scope is ready to quote.',c.eligible.length+' offers fit the token ceilings and your '+usd(r.budgetMicro)+' expected-cost budget. Lowest listed ceiling: '+usd(c.eligible[0].costMicro)+'. This compares capacity and price, not response quality.');
 else talk('No offer fits this purchase plan.',c.rejected.length+' offers were checked. Inspect the rejection reasons, then adjust the budget, token ceilings or preferences. I will not silently widen your budget.');
 }catch(e){failed(e);}finally{syncButtons();}
}
async function quote(o){clearNotice();try{if(dirty)throw Error('Review the updated task before quoting.');const s=await call('create_quote',{workspaceId:state.id,...o?{modelId:o.modelId,line:o.line}:{},ttlSeconds:$('fast-expiry').checked?5:90});apply(s);talk('Please review before confirming.',s.quote.offer.modelId+' on '+s.quote.offer.line+' is quoted at '+usd(s.quote.costMicro)+' against snapshot '+s.snapshot.snapshotId.slice(0,12)+'. Approval is a simulation only.');}catch(e){failed(e);}}
async function confirm(id){clearNotice();try{const s=await call('confirm_approval',{workspaceId:state.id,quoteId:id});apply(s);lastReceipt=s.receipt;renderReceipt(s.receipt);if(s.replayed)notice('IDEMPOTENT REPLAY','Returned the original receipt. No second approval was created.');talk(s.replayed?'The original approval was returned.':'Your simulated approval is recorded.','Export the receipt to keep the exact task, model/line, snapshot and estimate. Nothing was executed or charged.');}catch(e){failed(e);}}
function edit(){
 const first=!dirty;dirty=true;syncButtons();updateClock();$('revision').textContent='CHANGES NOT REVIEWED';
 if(first&&state?.quote){const old=state.quote.id;lastQuoteId=old;call('withdraw_quote',{workspaceId:state.id}).then(s=>{state=s;talk('Your previous quote has been withdrawn.','A task, budget or preference changed. Review the updated plan before creating a new quote.');syncButtons();}).catch(failed);}
}
const recipes={summary:{task:'Summarize a research report into an executive brief.',inputTokens:12000,outputTokens:1500,budgetMicro:50000,allowedLine:'',modelId:''},code:{task:'Review a codebase for authentication and error-handling defects.',inputTokens:100000,outputTokens:8000,budgetMicro:500000,allowedLine:'',modelId:''},translate:{task:'Translate a product guide into English while preserving headings.',inputTokens:16000,outputTokens:6000,budgetMicro:80000,allowedLine:'',modelId:''}};
$('task-form').onsubmit=e=>{e.preventDefault();review();};
for(const key of ['task','input-tokens','output-tokens','budget','model','line','historical'])$(key).addEventListener('input',edit);
for(const b of document.querySelectorAll('[data-recipe]'))b.onclick=()=>{edit();loadRequest(recipes[b.dataset.recipe]);};
$('quote-best').onclick=()=>quote();$('confirm').onclick=()=>confirm(state.quote.id);$('attempt-old').onclick=()=>confirm(lastQuoteId);$('replay').onclick=()=>confirm(lastReceipt.quoteId);$('more-offers').onclick=()=>{showAll=true;render();};
$('refresh-state').onclick=async()=>{try{apply(await call('inspect_workspace',{workspaceId:state.id}));}catch(e){failed(e);}};
$('new-session').onclick=async()=>{try{const s=await call('start_workspace');localStorage.setItem('sumplus-task-desk-workspace',s.id);dirty=false;lastQuoteId=null;lastReceipt=null;$('receipt').hidden=true;$('quote').replaceChildren();clearNotice();loadRequest(recipes.summary);apply(s);talk('A fresh workspace is ready.','Your previous workspace is not deleted. This tab now uses a new isolated workspace.');}catch(e){failed(e);}};
async function init(){
 try{
  const catalogue=await fetch('/catalogue.json').then(r=>{if(!r.ok)throw Error('Catalogue unavailable');return r.json();});
  for(const model of [...new Set(catalogue.offers.map(o=>o.modelId))].sort())$('model').append(new Option(model,model));
  for(const line of [...new Set(catalogue.offers.map(o=>o.line))].sort())$('line').append(new Option(line,line));
  $('catalogue-info').textContent=catalogue.offers.length+' model/line offers · captured '+new Date(catalogue.capturedAt).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC. Source: '+catalogue.source+'. Snapshot '+catalogue.snapshotId+'. Frozen until the operator explicitly refreshes it. Standard approval is blocked after 24 hours. Select Historical snapshot replay for a clearly labeled offline demonstration at any date.';
  client=new Client({name:'sumplus-task-desk-web',version:'0.1.0'},{capabilities:{}});
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',location.origin)));
  $('connection').textContent='MCP 2025-11-25 · connected';
  let s;const previous=localStorage.getItem('sumplus-task-desk-workspace');
  if(previous){try{s=await call('inspect_workspace',{workspaceId:previous});}catch{localStorage.removeItem('sumplus-task-desk-workspace');}}
  if(!s){s=await call('start_workspace');localStorage.setItem('sumplus-task-desk-workspace',s.id);}else{if(s.quote){lastQuoteId=s.quote.id;s=await call('withdraw_quote',{workspaceId:s.id});}loadRequest(s.request);talk('Your workspace has been restored.','Historical receipts are retained. Any pending quote was withdrawn on reload; review the scope again before approval.');}
  apply(s);setInterval(updateClock,500);
 }catch(e){$('connection').textContent='MCP unavailable';failed(e);}
}
init();
