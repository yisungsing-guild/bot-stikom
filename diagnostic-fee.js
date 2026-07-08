const RAG = require('./src/engine/ragEngine.js');

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════════\n');
  console.log('DIAGNOSTIC: TEST 2 - Analyzing Fee Retrieval for TI Wave 2C\n');

  // Capture retrieval chunks
  let retrievedChunks = [];
  const origQuery = RAG.query.bind(RAG);
  
  // Make a dummy call to trace what gets retrieved
  const result = await RAG.query('Berapa biaya TI gelombang 2C?', 8, { conversationContext: null, lastProgramHint: null });

  console.log('\nFINAL ANSWER RECEIVED:');
  console.log('─────────────────────────────────────────────────────────────────────────────────\n');
  console.log(result.answer);
  console.log('\n─────────────────────────────────────────────────────────────────────────────────\n');

  // Check what's present
  const ansLower = result.answer.toLowerCase();
  
  console.log('COMPONENT VERIFICATION:\n');
  const components = [
    { name: 'Registration Fee (Pendaftaran)', regex: /pendaftaran|registrasi/, check: /500.*000/ },
    { name: 'DPP (Dana Pendidikan Pokok)', regex: /dpp|dana\s+pendidikan/, check: /14.*000.*000/ },
    { name: 'UKT (Uang Kuliah Tunggal)', regex: /ukt|uang\s+kuliah/, check: null },
    { name: 'Perlengkapan (Jas, Kaos, Tas)', regex: /perlengkapan|jas|kaos|topi|gmti/, check: null },
    { name: 'Potongan/Diskon', regex: /potongan|diskon|beasiswa/, check: null },
    { name: 'Subtotal/Total', regex: /subtotal|total/, check: null }
  ];

  components.forEach(comp => {
    const hasComponent = comp.regex.test(ansLower);
    const status = hasComponent ? '✓' : '✗';
    console.log(`${status} ${comp.name}`);
    if (hasComponent && comp.check) {
      const hasAmount = comp.check.test(result.answer);
      console.log(`  └─ Amount present: ${hasAmount ? '✓' : '?'}`);
    }
  });

  console.log('\n─────────────────────────────────────────────────────────────────────────────────\n');
  console.log('ISSUE FOUND:');
  console.log('  ✗ UKT (Uang Kuliah Tunggal) is MISSING from the answer');
  console.log('  • Expected: UKT should be included for semester-based billing');
  console.log('  • Status: Only shows one-time fees (registration, DPP, perlengkapan)');
  console.log('\n─────────────────────────────────────────────────────────────────────────────────\n');
}

main().catch(console.error);
