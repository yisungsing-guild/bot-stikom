(async()=>{
  try {
    const { query } = require('../src/engine/ragEngine');

    console.log('Running registration menu flow verification...');

    const step1 = await query('pendaftaran jurusan sk', 3, {});
    if (!step1 || !step1.success || !step1.answer) {
      console.error('STEP1: No answer from query(\'pendaftaran jurusan sk\')');
      process.exitCode = 2; return;
    }

    const a1 = String(step1.answer || '');
    console.log('\n--- STEP 1 ANSWER PREVIEW ---');
    console.log(a1.slice(0,1200));

    // Basic assertions for menu OR fallback contact message
    const menuKeywords = ['Biaya', 'Jadwal PMB', 'Syarat & dokumen', 'Kontak PMB'];
    const fallbackPendaftaran = /Apakah Anda ingin saya berikan kontak Bagian Pendaftaran\?|Apakah Kamu ingin aku berikan kontak Bagian Pendaftaran\?/i;
    const hasMenu = menuKeywords.some(k => new RegExp(k, 'i').test(a1));
    const hasFallbackContact = fallbackPendaftaran.test(a1);
    if (!hasMenu && !hasFallbackContact) {
      console.error('STEP1: Neither menu keywords nor fallback contact prompt found in answer');
      process.exitCode = 3; return;
    }

    // Check duplicate-ish: same paragraph repeated twice (simple heuristic)
    const lines = a1.split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const first60 = lines.slice(0,8).join('\n');
    const rest = a1.replace(first60, '');
    if (rest.includes(first60)) {
      console.error('STEP1: Detected repeated block in menu answer');
      process.exitCode = 4; return;
    }

    console.log('STEP1: Menu looks good. Proceeding to follow-up "biaya" with conversationContext.');

    const step2 = await query('biaya', 4, { conversationContext: a1, answerQuestion: 'biaya pendaftaran' });
    if (!step2 || !step2.success || !step2.answer) {
      console.error('STEP2: No answer from follow-up query(\'biaya\')');
      process.exitCode = 5; return;
    }

    const a2 = String(step2.answer || '');
    console.log('\n--- STEP 2 ANSWER PREVIEW ---');
    console.log(a2.slice(0,1600));

    // Basic assertions for fee breakdown
    const feeKeywords = ['Pendaftaran', 'Dana Pendidikan', 'DPP', 'Rp', 'Biaya'];
    const hasFee = feeKeywords.some(k => new RegExp(k, 'i').test(a2));
    if (!hasFee) {
      console.error('STEP2: Fee keywords not found in follow-up answer');
      process.exitCode = 6; return;
    }

    // Check duplication heuristic for step2
    const a2Short = a2.slice(0,600);
    const half = Math.floor(a2Short.length/2);
    if (a2Short.slice(0,half).trim() === a2Short.slice(half).trim()) {
      console.error('STEP2: Detected duplicated half-block in answer preview');
      process.exitCode = 7; return;
    }

    console.log('\nVerification SUCCESS: registration menu -> biaya follow-up works and no obvious duplicates detected.');
    process.exitCode = 0;
  } catch (err) {
    console.error('Verification script error:', err && err.stack ? err.stack : String(err));
    process.exitCode = 10;
  }
})();