const path = require('path');
const RAG = require('./src/engine/ragEngine.js');

// ============================================================================
// E2E FLOW TRACER - Full runtime simulation
// ============================================================================

async function traceFullFlow(testName, userQuery, expectedBehavior) {
  console.log('\n' + '='.repeat(80));
  console.log(`TEST: ${testName}`);
  console.log('='.repeat(80));
  console.log(`User Query: "${userQuery}"`);
  console.log(`Expected: ${expectedBehavior}\n`);

  try {
    // Call the actual query function as provider.js would
    const result = await RAG.query(userQuery, 8, {
      conversationContext: null,
      lastProgramHint: null
    });

    console.log('✓ RESULT RECEIVED');
    console.log('-'.repeat(80));
    
    if (result) {
      console.log(`Source: ${result.source}`);
      console.log(`\nFinal Answer:\n${result.answer}`);
      
      // Analysis
      console.log('\n' + '-'.repeat(80));
      console.log('ANALYSIS:');
      console.log('-'.repeat(80));
      
      // Detect what rule was triggered
      if (result.source.includes('pmb')) {
        console.log('✓ Detected: PMB routing active');
        console.log('  → Rule correctly identified PMB query');
      } else if (result.source.includes('fee')) {
        console.log('✓ Detected: Fee breakdown routing active');
        console.log('  → Rule correctly identified fee query');
      } else if (result.source.includes('comparison')) {
        console.log('✓ Detected: Program comparison routing active');
        console.log('  → Rule correctly identified comparison query');
      } else {
        console.log(`⚠ Detected: ${result.source} routing active`);
      }
      
      // Check answer completeness
      const answerLower = result.answer.toLowerCase();
      console.log('\nContent Check:');
      
      if (userQuery.toLowerCase().includes('pmb')) {
        const hasPMB = answerLower.includes('penerimaan mahasiswa baru') || answerLower.includes('pmb');
        const hasSchedule = answerLower.includes('jadwal') || answerLower.includes('gelombang');
        const hasRequirements = answerLower.includes('syarat') || answerLower.includes('persyaratan');
        console.log(`  ${hasPMB ? '✓' : '✗'} Contains PMB definition`);
        console.log(`  ${hasSchedule ? '✓' : '✗'} Contains schedule/gelombang info`);
        console.log(`  ${hasRequirements ? '✓' : '✗'} Contains requirements`);
      }
      
      if (userQuery.toLowerCase().includes('biaya') || userQuery.toLowerCase().includes('berapa')) {
        const hasFee = /rp|rupiah|biaya|pendaftaran|dpp|ukt/i.test(answerLower);
        const hasDpp = answerLower.includes('dpp');
        const hasUkt = answerLower.includes('ukt');
        const hasRegistration = answerLower.includes('pendaftaran') || answerLower.includes('registrasi');
        console.log(`  ${hasFee ? '✓' : '✗'} Contains fee/biaya info`);
        console.log(`  ${hasRegistration ? '✓' : '✗'} Contains registration fee`);
        console.log(`  ${hasDpp ? '✓' : '✗'} Contains DPP`);
        console.log(`  ${hasUkt ? '✓' : '✗'} Contains UKT`);
      }
      
      if (userQuery.toLowerCase().includes('perbedaan') || userQuery.toLowerCase().includes('bandingkan')) {
        const hasSI = answerLower.includes('sistem informasi') || answerLower.includes('si');
        const hasTI = answerLower.includes('teknologi informasi') || answerLower.includes('teknik informatika') || answerLower.includes('informatika');
        const hasComparison = answerLower.includes('vs') || answerLower.includes('perbedaan') || answerLower.includes('bandingkan');
        console.log(`  ${hasSI ? '✓' : '✗'} Contains SI explanation`);
        console.log(`  ${hasTI ? '✓' : '✗'} Contains TI explanation`);
        console.log(`  ${hasComparison ? '✓' : '✗'} Contains actual comparison`);
      }
      
    } else {
      console.log('✗ ERROR: Query returned null/undefined');
    }
    
  } catch (err) {
    console.error('✗ RUNTIME ERROR:');
    console.error(err.message);
    console.error(err.stack);
  }

  console.log('\n' + '='.repeat(80));
}

// ============================================================================
// RUN TESTS
// ============================================================================

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   END-TO-END FLOW VERIFICATION (E2E TRACE)                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // TEST 1: PMB Query
  await traceFullFlow(
    'TEST 1 - PMB Definition',
    'Apa itu PMB di STIKOM Bali?',
    'Must explain PMB (Penerimaan Mahasiswa Baru), schedule, requirements - NOT program listing'
  );

  // TEST 2: Fee Breakdown
  await traceFullFlow(
    'TEST 2 - Fee Breakdown TI Wave 2C',
    'Berapa biaya TI gelombang 2C?',
    'Must show: Reg Fee, DPP, UKT, discounts - complete component breakdown'
  );

  // TEST 3: Program Comparison
  await traceFullFlow(
    'TEST 3 - Program Comparison SI vs TI',
    'Apa perbedaan Sistem Informasi dan Teknik Informatika?',
    'Must compare BOTH SI and TI - explain both programs side by side'
  );

  console.log('\n' + '╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              VERIFICATION COMPLETE                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');
}

main().catch(console.error);
