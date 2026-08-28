// Run: node check.cjs [path/to/Hindavi_Tourism_CRM_Improved.html]
// No dependencies; checks the actual functions embedded in the deliverable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const defaultHtml=fs.existsSync(path.join(__dirname,'Hindavi_Tourism_CRM_Improved.html'))?'Hindavi_Tourism_CRM_Improved.html':'index.html';
const html=fs.readFileSync(process.argv[2] || path.join(__dirname,defaultHtml),'utf8').replace(/\r\n/g,'\n');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const context=vm.createContext({crypto:{randomUUID},console});
const core=script.split('// CORE START:')[1].split('\n').slice(1).join('\n').split('// CORE END')[0];
vm.runInContext(core,context);
const run=s=>vm.runInContext(s,context);
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
check('currency: plain, Indian/Western grouping, symbols and paise',()=>{
  for(const v of ['150000.50','₹1,50,000.50','INR 150,000.50','Rs. 1,50,000.50',' 150000.50 '])assert.equal(run(`parseAmount(${JSON.stringify(v)})`),150000.5);
  assert.equal(run('parseAmount("0.01")'),.01);
});
check('currency: rejects negative, malformed, exponent, blank and overflow',()=>{
  for(const v of ['-1','1,50','abc','1e5','','Infinity','NaN','12.345','10000000000','₹','1 500'])assert.throws(()=>run(`parseAmount(${JSON.stringify(v)})`));
});
check('quote: rounds each line, then tax, without whole-rupee loss',()=>{
  const q=run('quoteTotals([{name:"Hotel",cost:"₹1,50,000.50",markup:15},{name:"Flights",cost:52000,markup:8},{name:"Transfer",cost:24000,markup:12}],5,5)');
  assert.equal(q.cost,226000.5);assert.equal(q.markup,29540.08);assert.equal(q.tax,12777.03);assert.equal(q.total,268317.61);assert.equal(q.perPerson,53663.52);
});
check('quote: validates traveller counts, markup, tax and zero-tax totals',()=>{
  for(const count of [0,-1,1.5,10001])assert.throws(()=>run(`quoteTotals([{cost:100,markup:0}],${count},5)`));
  assert.throws(()=>run('quoteTotals([{cost:100,markup:-1}],1,5)'));
  assert.throws(()=>run('quoteTotals([{cost:100,markup:0}],1,101)'));
  assert.equal(run('quoteTotals([{cost:"0.10",markup:0},{cost:"0.20",markup:0}],1,0).total'),.3);
});
check('phone numbers: local India, leading zero, international',()=>{
  assert.equal(run('phoneNumber("9000000000")'),'919000000000');assert.equal(run('phoneNumber("09000000000")'),'919000000000');assert.equal(run('phoneNumber("+44 7700 900000")'),'447700900000');assert.equal(run('phoneNumber("00447700900000")'),'447700900000');assert.throws(()=>run('phoneNumber("123")'));
});
check('dates: real calendar dates only',()=>{assert.equal(run('validDate("2028-02-29")'),'2028-02-29');assert.throws(()=>run('validDate("2026-02-29")'));assert.throws(()=>run('validDate("2026-99-99")'));});
check('payments: repeated receipts update one invoice with a history',()=>{
  run('var p={total:150000.5,received:0,receipts:[]};applyReceipt(p,"50,000.25",{date:"2026-08-28"});applyReceipt(p,"1,00,000.25",{date:"2026-08-28"});');assert.equal(run('p.received'),150000.5);assert.equal(run('p.receipts.length'),2);
  assert.throws(()=>run('applyReceipt(p,"0.01",{})'));assert.throws(()=>run('applyReceipt(p,"0",{})'));
});
check('payment statuses derive from real due dates and balances',()=>{
  assert.equal(run('paymentStatus({total:100,received:25,due:"2026-08-27"},"2026-08-28")'),'Overdue');assert.equal(run('paymentStatus({total:100,received:25,due:"2026-08-28"},"2026-08-28")'),'Part paid');assert.equal(run('paymentStatus({total:100,received:100,due:"2026-08-27"},"2026-08-28")'),'Paid');
});
check('CSV neutralizes formula cells and escapes quotes',()=>{assert.equal(run('csvCell("=SUM(A1)")'),'"\'=SUM(A1)"');assert.equal(run('csvCell(\'a"b\')'),'"a""b"');});
const seed=script.match(/const seed=.*?;\n/)[0];
const migration=script.slice(script.indexOf('function migrate('),script.indexOf('let db, lastRaw='));
run(`const clone=x=>JSON.parse(JSON.stringify(x));const uid=p=>p+'-'+crypto.randomUUID();const collections=['leads','customers','bookings','visas','payments','suppliers','packages'];const leadStates=['New','Follow-up','Quotation','Confirmed','Lost'];const visaStates=['Documents pending','Appointment booked','Submitted','Approved','Rejected'];const bookingStages=Array(6).fill('stage');const defaultSettings={business:'Test',phone:'9000000000',email:'qa@example.test',address:'Test',gstin:'',payment:'',terms:''};${seed}${migration}`);
check('legacy migration links Anita’s existing invoice without duplication',()=>{run('var migrated=migrate(seed)');assert.equal(run('migrated.bookings[1].invoice'),'INV-1078');assert.equal(run('migrated.payments.length'),2);assert.equal(run('migrated.packages[2].type'),'Domestic');});
check('migration is repeatable and keeps identifiers / balances',()=>{assert.equal(run('JSON.stringify(migrate(migrated))'),run('JSON.stringify(migrated)'));});
check('malformed backups cannot replace working data',()=>{
  for(const change of ['x.payments.push(clone(x.payments[0]))','x.visas[0].total=0','x.payments[0].received=99999999','x.payments[0].receipts={}','x.bookings[0].completed="yes"','x.quote={fields:{},items:{}}','x.settings={business:42}','x.bookings[0].total=1'])assert.throws(()=>run(`(()=>{const x=clone(migrated);${change};return migrate(x);})()`));
});
const invoiceCode=script.slice(script.indexOf('function ensureInvoice('),script.indexOf('function validateLead('));run(invoiceCode);
check('invoice creation is idempotent and protects received money',()=>{
  run('var accounting=clone(migrated), booking={id:"TEST",customer:"QA",total:500,departure:"2026-09-01"};ensureInvoice(accounting,booking);ensureInvoice(accounting,booking);');assert.equal(run('accounting.payments.length'),3);run('accounting.payments[0].received=250;booking.total=200');assert.throws(()=>run('ensureInvoice(accounting,booking)'));
});
check('standalone delivery has no script dependencies or stale PDF generator',()=>{assert.ok(!/<script[^>]+src=/.test(html));assert.ok(!script.includes('Math.random()'));assert.ok(!script.includes('function pdfDoc'));assert.ok(html.includes('inputmode="decimal" data-money'));assert.ok(html.includes('id="sPayment"'));assert.ok(html.includes('id="sTerms"'));});
// Simulated storage only: these tests never touch the user's browser data.
run(`const KEY='test';let db=clone(migrated),lastRaw=null,storageBlocked=false;var savedRaw=null,failWrite=false,notices=[];const localStorage={getItem:()=>savedRaw,setItem:(key,value)=>{if(failWrite)throw Error('Quota exceeded');savedRaw=value;}};function notice(x){notices.push(x);}function toastMsg(){}function renderAll(){}`);
run(script.slice(script.indexOf('function mutate('),script.indexOf("window.addEventListener('storage'")));
check('successful writes persist the full data and report success',()=>{assert.equal(run('mutate(d=>{d.customers[0].name="Persisted";})'),true);assert.equal(run('JSON.parse(savedRaw).customers[0].name'),'Persisted');});
check('quota / access failures roll back data and never claim success',()=>{run('failWrite=true');assert.equal(run('mutate(d=>{d.customers[0].name="Must not save";})'),false);assert.equal(run('db.customers[0].name'),'Persisted');assert.ok(run('notices.at(-1)').includes('Quota exceeded'));run('failWrite=false');});
check('stale tabs cannot overwrite newer records',()=>{run('savedRaw="changed in another tab"');assert.equal(run('mutate(d=>{d.customers[0].name="Stale write";})'),false);assert.equal(run('db.customers[0].name'),'Persisted');run('savedRaw=lastRaw');});
check('corrupt-data recovery mode blocks mutation',()=>{run('storageBlocked=true');assert.equal(run('mutate(d=>{d.customers=[];})'),false);assert.ok(run('db.customers.length')>0);run('storageBlocked=false');});
run(`var quoteMock={fields:{qCustomer:'Keep customer',qDestination:'Old place',qItinerary:'Old itinerary',qTravelDetails:'Old hotel'},items:[{name:'Old item',cost:999,markup:12}]};var controls={travellers:{value:'3'},qCustomer:{focus(){}}};const $=selector=>controls[selector.slice(1)];const confirm=()=>true;const today=()=>'2026-08-28';function byId(key,id){return db[key].find(x=>x.id===id);}function readQuote(){return clone(quoteMock);}function loadQuote(d){quoteMock=clone(d);}function saveQuote(){return true;}function showPage(){}`);
run(script.slice(script.indexOf('function usePackage('),script.indexOf('function documentHeader(')));
check('using a package replaces stale contents and prices all travellers',()=>{
  run('usePackage(db.packages[0].id)');assert.equal(run('quoteMock.fields.qCustomer'),'Keep customer');assert.equal(run('quoteMock.fields.qDestination'),'Kashmir Paradise');assert.equal(run('quoteMock.items.length'),1);assert.equal(run('quoteMock.items[0].cost'),127500);assert.equal(run('quoteMock.items[0].unitPrice'),'42500');assert.equal(run('quoteMock.fields.qItinerary'),'');
});
check('new quotation clears every old cost and itinerary field',()=>{run('newQuote()');assert.equal(run('quoteMock.items.length'),0);assert.equal(run('quoteMock.fields.qCustomer'),'');assert.equal(run('quoteMock.fields.qItinerary'),'');assert.equal(run('quoteMock.fields.qTravelDetails'),'');assert.equal(run('quoteMock.fields.travellers'),'1');});
// Exercise the exact file-restore handler with fake local files and fake storage.
context.clearTimeout=()=>{};
run('controls.backupFile={};var quoteTimer;function loadSettings(){}');
run(script.slice(script.indexOf("$('#backupFile').onchange="),script.indexOf('const actions=')));
async function checkAsync(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
  await checkAsync('backup restore replaces data and reloads the draft from valid JSON',async()=>{
    run('var incoming=clone(migrated);incoming.customers[0].name="Restored customer";var restoreEvent={target:{files:[{size:100,text:async()=>JSON.stringify({version:2,data:incoming})}],value:"chosen.json"}}');
    await run('controls.backupFile.onchange(restoreEvent)');
    assert.equal(run('db.customers[0].name'),'Restored customer');assert.equal(run('JSON.parse(savedRaw).customers[0].name'),'Restored customer');assert.equal(run('restoreEvent.target.value'),'');
  });
  await checkAsync('invalid and oversized backup files leave existing data intact',async()=>{
    const before=run('savedRaw');
    await run('controls.backupFile.onchange({target:{files:[{size:100,text:async()=>"not JSON"}],value:"bad.json"}})');
    assert.equal(run('savedRaw'),before);
    await run('controls.backupFile.onchange({target:{files:[{size:20*1024*1024,text:async()=>"{}"}],value:"big.json"}})');
    assert.equal(run('savedRaw'),before);
  });
  await checkAsync('restore write failure preserves the loaded records',async()=>{
    const before=run('JSON.stringify(db)');run('failWrite=true;incoming.customers[0].name="Cannot persist"');await run('controls.backupFile.onchange(restoreEvent)');assert.equal(run('JSON.stringify(db)'),before);run('failWrite=false');
  });
  console.log(`\n${checks} checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
