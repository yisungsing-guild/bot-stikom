const origLog=console.log, origWarn=console.warn, origError=console.error;
console.log=()=>{}; console.warn=()=>{}; console.error=()=>{};
const { query } = require('../src/engine/ragEngine');
(async()=>{
 const qs=['apa itu sk','apa itu TI','apa itu SI','rincian biaya TI gelombang 1C'];
 const out=[];
 for (const q of qs){ const r=await query(q,5,{includeGlobal:true}); out.push({q,source:r.source,answer:r.answer}); }
 console.log=origLog; console.warn=origWarn; console.error=origError; console.log(JSON.stringify(out,null,2));
})();
