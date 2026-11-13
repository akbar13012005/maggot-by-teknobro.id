const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2] || 'js/app.js', 'utf8');
const selector = source.slice(source.indexOf('  function selectedHistoryRows()'), source.indexOf('  function renderHistory()'));
const exporter = source.slice(source.indexOf('  window.exportCSV ='), source.indexOf('  window.saveWiFiConfig ='));
const inputs = { dateFrom: {value: ''}, dateTo: {value: ''}, dataLimit: {value: '100'} };
let blob, clicks=0, revoked=0, message;
const sandbox = {historyRows: [], $: id => inputs[id], window: {}, Blob,
 document: {body: {appendChild(){}}, createElement: () => ({click(){clicks++},remove(){}})},
 URL: {createObjectURL: b => {blob=b;return 'blob:test'}, revokeObjectURL: () => revoked++},
 setTimeout: fn => fn(), toast: m => {message=m}};
vm.createContext(sandbox);vm.runInContext(selector+exporter,sandbox);
(async()=>{
 sandbox.historyRows=[
  {timestamp:1700000060,suhu_media:30.5,kelembaban:72,target:32,mode:'auto'},
  {timestamp:1700000000,suhu_media:29.25,kelembaban:70},
  {timestamp:1699900000,suhu_media:28,kelembaban:69}];
 inputs.dateFrom.value=inputs.dateTo.value='2023-11-15';inputs.dataLimit.value='2';
 sandbox.window.exportCSV();
 let text=await blob.text();
 assert.equal(text.replace(/^\uFEFF/,''), '"Suhu (°C)","Kelembapan (%)","Waktu (WIB)"\r\n"29.25","70","2023-11-15 05:13:20"\r\n"30.5","72","2023-11-15 05:14:20"');
 assert.equal(clicks,1);assert.equal(revoked,1);
 assert.equal(text.split('\r\n').length,3);
 inputs.dataLimit.value='1';sandbox.window.exportCSV();text=await blob.text();assert.equal(text.split('\r\n').length,2);assert.ok(text.includes('30.5'));
 sandbox.historyRows=[{timestamp:1700000000,suhu_media:'=1+1',kelembaban:null}];
 sandbox.window.exportCSV();text=await blob.text();assert.ok(text.endsWith('"","","2023-11-15 05:13:20"'));
 const before=clicks;sandbox.historyRows=[];sandbox.window.exportCSV();assert.equal(clicks,before);assert.ok(message.includes('Tidak ada data'));
 console.log('PASS: exactly three columns; date/limit filters; ascending time; WIB; invalid values stay blank; no formula injection; empty export; URL cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
