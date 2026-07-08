const origLog = console.log, origWarn=console.warn, origError=console.error;
console.log = () => {}; console.warn=()=>{}; console.error=()=>{};
const { query } = require('../src/engine/ragEngine');
(async()=>{
 const qs=['halo','hai','hi','hello','permisi','selamat pagi','selamat siang','selamat sore','selamat malam','saya ingin tau tentang pmb','apa itu sk','apa itu TI','apa itu SI','rincian biaya TI gelombang 1C','biaya SI','jadwal pmb'];
 const out=[];
 for (const q of qs){
   const r=await query(q,5,{includeGlobal:true});
   out.push({q, source:r&&r.source, success:r&&r.success, answer:String((r&&r.answer)||'').slice(0,1500)});
 }
 console.log=origLog; console.warn=origWarn; console.error=origError;
 console.log(JSON.stringify(out,null,2));
})();
