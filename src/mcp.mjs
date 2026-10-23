import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
const id=z.string().uuid();
const request=z.object({pricingMode:z.enum(['snapshot','historical']).default('snapshot'),task:z.string().min(1).max(600),inputTokens:z.number().int().min(1).max(2000000),outputTokens:z.number().int().min(1).max(2000000),budgetMicro:z.number().int().min(0).max(1000000000),allowedLine:z.string().max(100),modelId:z.string().max(150)}).strict();
export function mcpHandler(desk,save){return async(req,res)=>{
 const server=new McpServer({name:'sumplus-task-desk',version:'0.1.0'},{instructions:'Procurement simulation only. No purchases, provider calls, real reservations or payments. Show exact task, token ceilings, catalogue timestamp, model/line and expected cost before asking a human to confirm. Never call confirm_approval without explicit human approval of that exact quote. Monetary limits constrain this estimate, not execution.'});
 const register=(name,description,inputSchema,fn,readOnlyHint=false)=>server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint,destructiveHint:false,idempotentHint:name==='confirm_approval'||readOnlyHint,openWorldHint:false}},async args=>{
  try{const result=fn(args);save();return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
  catch(e){save();return {isError:true,content:[{type:'text',text:JSON.stringify({code:e.code||'INVALID_REQUEST',message:e.message})}]};}
 });
 register('start_workspace','Create an isolated server-side simulated procurement workspace. Keep workspace ID private.',{},()=>desk.start());
 register('review_task','Set exact task, token ceilings, model/line filters and one-task expected-cost approval budget. Any change invalidates an unapproved quote.',{workspaceId:id,request},a=>desk.update(a.workspaceId,a.request));
 register('withdraw_quote','Withdraw an unapproved quote immediately when the user edits a draft. Does not change historical receipts.',{workspaceId:id},a=>desk.invalidate(a.workspaceId));
 register('inspect_workspace','Read comparisons, all rejection reasons, quote, events and historical simulated receipts.',{workspaceId:id},a=>desk.view(desk.get(a.workspaceId)),true);
 register('create_quote','Create a short-lived estimate bound to task revision, snapshot, model and service line. Zero-priced and over-budget offers are excluded. Historical mode explicitly replays old catalogue prices; never present those as current prices.',{workspaceId:id,modelId:z.string().optional(),line:z.string().optional(),ttlSeconds:z.number().int().min(5).max(120).default(90)},a=>desk.quote(a.workspaceId,a));
 register('confirm_approval','Only after explicit human review and confirmation of this exact quote: record a SIMULATED approval. No execution or funds. Repeated calls return the original receipt.',{workspaceId:id,quoteId:id},a=>desk.confirm(a.workspaceId,a.quoteId));
 const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 // Stateless MCP transport; application workspace state is durable and independent of transport sessions.
 res.on('close',()=>{transport.close();server.close();});
 await server.connect(transport);
 await transport.handleRequest(req,res,req.body);
};}
