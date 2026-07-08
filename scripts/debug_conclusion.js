const { buildWhatsappConversationalReply, deriveConclusionSentence, detectIntentFromAnswer } = require('../src/utils/whatsappFormatter');

// Test jadwal pendaftaran specifically
const userQuery = 'Jadwal pendaftaran';
const mainAnswer = 'Pendaftaran dibuka setiap gelombang: Gelombang 1 (Januari), Gelombang 2 (Mei), Gelombang 3 (September); deadline dan persyaratan tiap gelombang tercantum di situs.';

console.log('=== JADWAL PENDAFTARAN DEBUG ===');
console.log('userQuery:', userQuery);
console.log('mainAnswer:', mainAnswer);

// Step 1: Detect intent
const intent = detectIntentFromAnswer(mainAnswer, userQuery);
console.log('\nDetected intent:', intent);

// Step 2: Derive conclusion with detected intent
const concl = deriveConclusionSentence(mainAnswer, null, intent);
console.log('Derived conclusion:', concl);

// Step 3: Full build
const full = buildWhatsappConversationalReply({ rawMainAnswer: mainAnswer, userQuery, includeMeta: true });
console.log('\nFull output:\n', full);

// Test akreditasi
console.log('\n\n=== AKREDITASI DEBUG ===');
const q2 = 'Akreditasi kampus';
const a2 = 'STIKOM Bali terakreditasi B untuk institusi dan beberapa program studi memiliki akreditasi B atau A sesuai SK terbaru.';
const intent2 = detectIntentFromAnswer(a2, q2);
console.log('Detected intent:', intent2);
const concl2 = deriveConclusionSentence(a2, null, intent2);
console.log('Derived conclusion:', concl2);

// Test cara daftar
console.log('\n\n=== CARA DAFTAR DEBUG ===');
const q3 = 'Cara daftar mahasiswa baru';
const a3 = '* Isi formulir online\n* Unggah dokumen (ijazah, KTP)\n* Bayar biaya pendaftaran\n* Ikuti seleksi dan pengumuman';
const intent3 = detectIntentFromAnswer(a3, q3);
console.log('Detected intent:', intent3);
const concl3 = deriveConclusionSentence(a3, null, intent3);
console.log('Derived conclusion:', concl3);
