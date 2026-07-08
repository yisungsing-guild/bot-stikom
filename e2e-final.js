const RAG = require('./src/engine/ragEngine.js');

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    END-TO-END VERIFICATION - RUNTIME TEST RESULTS                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Suppress debug output
  const orig = console.log;
  let suppress = false;
  console.log = (...args) => {
    if (!suppress) orig(...args);
  };

  // TEST 1
  suppress = true;
  const r1 = await RAG.query('Apa itu PMB di STIKOM Bali?', 8, { conversationContext: null, lastProgramHint: null });
  suppress = false;

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');
  console.log('TEST 1: PMB Query\n');
  console.log('Query: "Apa itu PMB di STIKOM Bali?"');
  console.log(`Source: ${r1.source}`);
  console.log(`\nAnswer:\n${r1.answer}`);
  console.log(`\nAnalysis:${
    /penerimaan\s+mahasiswa\s+baru|pmb/i.test(r1.answer.toLowerCase()) ? '\n  ✓ Contains PMB definition' : '\n  ✗ Missing PMB definition'
  }${
    /jadwal|gelombang/i.test(r1.answer.toLowerCase()) ? '\n  ✓ Contains schedule/gelombang' : '\n  ✗ Missing schedule info'
  }${
    /syarat|persyaratan/i.test(r1.answer.toLowerCase()) ? '\n  ✓ Contains requirements' : '\n  ✗ Missing requirements'
  }\n`);

  // TEST 2
  suppress = true;
  const r2 = await RAG.query('Berapa biaya TI gelombang 2C?', 8, { conversationContext: null, lastProgramHint: null });
  suppress = false;

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');
  console.log('TEST 2: Fee Breakdown Query\n');
  console.log('Query: "Berapa biaya TI gelombang 2C?"');
  console.log(`Source: ${r2.source}`);
  console.log(`\nAnswer:\n${r2.answer}`);
  console.log(`\nAnalysis:${
    /rp|biaya|pendaftaran|registrasi/i.test(r2.answer.toLowerCase()) ? '\n  ✓ Contains fee info' : '\n  ✗ Missing fee info'
  }${
    /pendaftaran|registrasi/i.test(r2.answer.toLowerCase()) ? '\n  ✓ Contains registration fee' : '\n  ✗ Missing registration'
  }${
    /dpp|dana\s+pendidikan/i.test(r2.answer.toLowerCase()) ? '\n  ✓ Contains DPP' : '\n  ✗ Missing DPP'
  }${
    /ukt|uang\s+kuliah/i.test(r2.answer.toLowerCase()) ? '\n  ✓ Contains UKT' : '\n  ✗ Missing UKT'
  }\n`);

  // TEST 3
  suppress = true;
  const r3 = await RAG.query('Apa perbedaan Sistem Informasi dan Teknik Informatika?', 8, { conversationContext: null, lastProgramHint: null });
  suppress = false;

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');
  console.log('TEST 3: Program Comparison Query\n');
  console.log('Query: "Apa perbedaan Sistem Informasi dan Teknik Informatika?"');
  console.log(`Source: ${r3.source}`);
  console.log(`\nAnswer:\n${r3.answer}`);
  console.log(`\nAnalysis:${
    /sistem\s+informasi|\\bsi\\b/i.test(r3.answer.toLowerCase()) ? '\n  ✓ Contains SI explanation' : '\n  ✗ Missing SI'
  }${
    /teknologi\s+informasi|teknik\s+informatika|informatika/i.test(r3.answer.toLowerCase()) ? '\n  ✓ Contains TI explanation' : '\n  ✗ Missing TI'
  }${
    /vs|perbedaan|berbeda|bedanya/i.test(r3.answer.toLowerCase()) ? '\n  ✓ Contains comparison' : '\n  ✗ Missing comparison'
  }\n`);

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                 VERIFICATION COMPLETE                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════╝\n');
}

main().catch(console.error);
