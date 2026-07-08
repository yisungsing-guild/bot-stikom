#!/usr/bin/env node
process.env.RAG_AUDIT_LOGGING='true';
process.env.RAG_DEBUG_INTENT_FILTERING='true';

const { query } = require('./src/engine/ragEngine');

const queries = [
  'Apa itu TI',
  'Apa itu SI',
  'TI belajar apa saja',
  'SI belajar apa saja',
  'Prospek kerja TI'
];

(async()=>{
  for (const q of queries){
    console.log('Running query:', q);
    try{
      const res = await query(q, 20);
      console.log('  success:', res.success, 'sources:', (res.sources||[]).length);
    }catch(e){
      console.error('  error:', e.message);
    }
  }
  console.log('Done');
})();
