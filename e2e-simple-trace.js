const path = require('path');

// Suppress console.log selama loading, hanya capture yang penting
const originalLog = console.log;
let capturedLogs = [];
console.log = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a).substring(0, 100) : String(a)).join(' ');
  if (msg.includes('[TRACE_AFTER_RAG]') || msg.includes('source:')) {
    capturedLogs.push(msg);
  }
};

const RAG = require('./src/engine/ragEngine.js');

// Restore console.log
console.log = originalLog;

// ============================================================================
// SIMPLIFIED E2E TRACE - Only shows final output and analysis
// ============================================================================

async function traceQuery(testName, userQuery, expectedBehavior) {
  console.log('\n' + '═'.repeat(100));
  console.log(`TEST: ${testName}`);
  console.log('═'.repeat(100));
  console.log(`User Query: "${userQuery}"`);
  console.log(`Expected: ${expectedBehavior}\n`);

  try {
    const result = await RAG.query(userQuery, 8, {
      conversationContext: null,
      lastProgramHint: null
    });

    if (result) {
      console.log(`✓ Result Received`);
      console.log(`Source: ${result.source}`);
      console.log(`\n${'-'.repeat(100)}`);
      console.log(`FINAL ANSWER:\n`);
      console.log(result.answer);
      console.log(`\n${'-'.repeat(100)}`);
      console.log(`VERIFICATION:\n`);
      
      const answerLower = result.answer.toLowerCase();
      
      // Analyze based on query type
      if (userQuery.toLowerCase().includes('pmb')) {
        const checks = {
          'PMB Definition': /penerimaan\s+mahasiswa\s+baru|pmb/i.test(answerLower),
          'Has Schedule': /jadwal|gelombang/i.test(answerLower),
          'Has Requirements': /syarat|persyaratan|dokumen/i.test(answerLower),
          'NOT just program list': !/program studi\s+tersedia.*ti.*si.*bd.*sk/i.test(answerLower) || !/^[A-Z]{1,2}[,\s]+[A-Z]{1,2}/m.test(result.answer.split('\n')[2] || '')
        };
        Object.entries(checks).forEach(([key, pass]) => {
          console.log(`  ${pass ? '✓' : '✗'} ${key}`);
        });
      }
      
      if (userQuery.toLowerCase().includes('biaya')) {
        const checks = {
          'Contains fee info': /rp|biaya|pendaftaran|registrasi/i.test(answerLower),
          'Has registration fee': /pendaftaran|registrasi/i.test(answerLower),
          'Has DPP': /dpp|dana\s+pendidikan/i.test(answerLower),
          'Has UKT': /ukt|uang\s+kuliah/i.test(answerLower),
          'Complete component breakdown': /rincian|komponen|biaya per komponen/i.test(answerLower)
        };
        Object.entries(checks).forEach(([key, pass]) => {
          console.log(`  ${pass ? '✓' : '✗'} ${key}`);
        });
      }
      
      if (userQuery.toLowerCase().includes('perbedaan') || userQuery.toLowerCase().includes('bandingkan')) {
        const checks = {
          'Has SI info': /sistem\s+informasi|\\bsi\\b/i.test(answerLower),
          'Has TI info': /teknologi\s+informasi|teknik\s+informatika|informatika/i.test(answerLower),
          'Contains comparison': /vs|perbedaan|berbeda|bedanya|beda/i.test(answerLower),
          'Both programs covered': /sistem\s+informasi|\\bsi\\b/i.test(answerLower) && (/teknologi\s+informasi|teknik\s+informatika|informatika/i.test(answerLower))
        };
        Object.entries(checks).forEach(([key, pass]) => {
          console.log(`  ${pass ? '✓' : '✗'} ${key}`);
        });
      }
      
    } else {
      console.log('✗ ERROR: Query returned null');
    }
    
  } catch (err) {
    console.error('✗ RUNTIME ERROR:', err.message);
  }

  console.log('═'.repeat(100));
}

// ============================================================================
// RUN TESTS
// ============================================================================

async function main() {
  console.log('\n╔' + '═'.repeat(98) + '╗');
  console.log('║' + ' '.repeat(20) + 'END-TO-END VERIFICATION - ACTUAL RUNTIME OUTPUT' + ' '.repeat(32) + '║');
  console.log('╚' + '═'.repeat(98) + '╝');

  // TEST 1: PMB Query
  await traceQuery(
    'TEST 1 - PMB Definition',
    'Apa itu PMB di STIKOM Bali?',
    'Must explain PMB (Penerimaan Mahasiswa Baru) - NOT just program listing'
  );

  // TEST 2: Fee Breakdown
  await traceQuery(
    'TEST 2 - Fee Breakdown TI Wave 2C',
    'Berapa biaya TI gelombang 2C?',
    'Must show: Registration fee, DPP, UKT, discounts - complete breakdown'
  );

  // TEST 3: Program Comparison
  await traceQuery(
    'TEST 3 - Program Comparison SI vs TI',
    'Apa perbedaan Sistem Informasi dan Teknik Informatika?',
    'Must compare BOTH SI and TI - explain both programs side by side'
  );

  console.log('\n╔' + '═'.repeat(98) + '╗');
  console.log('║' + ' '.repeat(30) + 'VERIFICATION COMPLETE' + ' '.repeat(47) + '║');
  console.log('╚' + '═'.repeat(98) + '╝\n');
}

main().catch(console.error);
