const { buildHumanizedWhatsappReply } = require('../src/utils/whatsappFormatter');

function runCase(userQuery, mainAnswer) {
  console.log('==============================');
  console.log('User Query:', userQuery);
  console.log('Simulated RAG Answer Preview:', mainAnswer.slice(0,120));
  console.log('--- Reply and TRACE ---');
  const out = buildHumanizedWhatsappReply({ mainAnswer, userQuery, intent: null, context: {} });
  console.log('--- Final Humanized Reply ---');
  console.log(out);
  console.log('==============================\n');
}

// Case 1: user explicitly asks TI but RAG returns Sistem Informasi (wrong chunk)
runCase('Berapa biaya TI?', 'Program Studi Sistem Informasi memiliki rincian biaya sebagai berikut:\n\nPendaftaran: - Biaya pendaftaran: Rp 500.000');

// Case 2: user asks Sistem Informasi and RAG matches Sistem Informasi
runCase('Berapa biaya Sistem Informasi?', 'Program Studi Sistem Informasi memiliki rincian biaya sebagai berikut:\n\nPendaftaran: - Biaya pendaftaran: Rp 600.000');

// Case 3: user asks Bisnis Digital and RAG returns Bisnis Digital
runCase('Berapa biaya Bisnis Digital?', 'Program Studi Bisnis Digital memiliki rincian biaya sebagai berikut:\n\nPendaftaran: - Biaya pendaftaran: Rp 550.000');
