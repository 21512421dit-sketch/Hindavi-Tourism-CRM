import http from 'node:http';
import { mkdirSync,readFileSync,statSync } from 'node:fs';
import { dirname,extname,join,normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase,collections,estimateTravel } from './db.js';

const root=dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
const security={'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
function json(response,status,value){response.writeHead(status,{...security,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(value));}
function error(response,failure){if(!failure.status)console.error(failure);json(response,failure.status||500,{error:failure.status?failure.message:'The server could not complete the request.'});}
async function body(request){let text='';for await(const chunk of request){text+=chunk;if(text.length>1_000_000){const problem=new Error('Request is too large.');problem.status=413;throw problem;}}if(!text)return{};try{return JSON.parse(text);}catch{const problem=new Error('Request body must be valid JSON.');problem.status=400;throw problem;}}
export function createServer({database=join(root,'data','hindavi.sqlite')}={}){mkdirSync(dirname(database),{recursive:true});const db=openDatabase(database);const server=http.createServer(async(request,response)=>{try{const url=new URL(request.url,'http://localhost'),parts=url.pathname.split('/').filter(Boolean);
 if(url.pathname==='/api/health'&&request.method==='GET')return json(response,200,{ok:true});
 if(url.pathname==='/api/state'&&request.method==='GET')return json(response,200,db.state());
 if(url.pathname==='/api/backup'&&request.method==='GET')return json(response,200,db.backup());
 if(url.pathname==='/api/restore'&&request.method==='POST')return json(response,200,db.restore(await body(request)));
 if(url.pathname==='/api/travel/estimate'&&request.method==='POST')return json(response,200,estimateTravel(await body(request)));
 if(parts[0]==='api'&&parts[1]==='meta'&&parts[2]){if(request.method==='GET')return json(response,200,db.meta(parts[2]));if(request.method==='PUT')return json(response,200,db.meta(parts[2],await body(request)));}
 if(parts[0]==='api'&&parts[1]==='bookings'&&parts[2]&&parts[3]==='confirm'&&request.method==='POST')return json(response,200,db.confirmBooking(parts[2]));
 if(parts[0]==='api'&&parts[1]==='payments'&&parts[2]&&parts[3]==='receipts'&&request.method==='POST')return json(response,201,db.receipt(parts[2],await body(request)));
 if(parts[0]==='api'&&collections.includes(parts[1])){const collection=parts[1],id=parts[2];if(request.method==='GET')return json(response,200,id?db.get(collection,id):db.list(collection));if(request.method==='POST'&&!id)return json(response,201,db.save(collection,await body(request)));if(request.method==='PUT'&&id)return json(response,200,db.save(collection,await body(request),id));if(request.method==='DELETE'&&id){db.remove(collection,id);response.writeHead(204,security);return response.end();}}
 if(parts[0]==='api')return json(response,404,{error:'API route not found.'});serveStatic(url.pathname,response);
 }catch(failure){error(response,failure);}});server.on('close',()=>db.close());return server;}
function serveStatic(pathname,response){const publicRoot=join(root,'public'),relative=pathname==='/'?'index.html':decodeURIComponent(pathname).replace(/^\/+/,''),target=normalize(join(publicRoot,relative));if(!target.startsWith(publicRoot)){response.writeHead(403,security);return response.end('Forbidden');}try{if(!statSync(target).isFile())throw new Error();const extension=extname(target);response.writeHead(200,{...security,'Content-Type':types[extension]||'application/octet-stream','Cache-Control':'no-cache'});response.end(readFileSync(target));}catch{response.writeHead(404,{...security,'Content-Type':'text/plain; charset=utf-8'});response.end('Not found');}}
if(fileURLToPath(import.meta.url)===process.argv[1]){const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';createServer().listen(port,host,()=>console.log(`Hindavi CRM running at http://${host}:${port}`));}
