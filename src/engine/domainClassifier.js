// Lightweight rule-based knowledge domain classifier
// Returns one of the agreed domain strings or 'unknown'
function detectKnowledgeDomain(message) {
  const t = String(message || '').toLowerCase();
  if (!t.trim()) return 'unknown';

  // Priority ordered rules
  const rules = [
    { keys: ['beasiswa', 'scholarship', 'beasiswa?','beasiswa:'], domain: 'scholarship' },
    { keys: ['double degree', 'double-degree', 'doubledegree', 'double degree', 'double degree?','double degree'], domain: 'double_degree' },
    { keys: ['kelas internasional', 'internasional', 'international', 'exchange', 'program internasional'], domain: 'international_program' },
    { keys: ['biaya', 'biaya kuliah', 'tuition', 'ukt', 'pendaftaran', 'daftar', 'pembayaran'], domain: 'tuition' },
    { keys: ['kurikulum', 'mata kuliah', 'kurikulum?', 'curriculum', 'belajar apa', 'dipelajari', 'belajarnya', 'skill yang dipelajari'], domain: 'curriculum' },
    { keys: ['rekomendasi', 'recommend', 'recommendation', 'saran jurusan', 'cocok jurusan'], domain: 'recommendation' },
    { keys: ['takut', 'takut matematika', 'aku takut', 'khawatir', 'cemas', 'gugup', 'introvert'], domain: 'emotional_guidance' },
    { keys: ['karier', 'karir', 'career', 'kerja', 'pekerjaan', 'prospek kerja', 'lulusan', 'career path'], domain: 'career_path' },
    { keys: ['kampus', 'kehidupan kampus', 'student life', 'mahasiswa', 'kegiatan mahasiswa'], domain: 'student_life' }
  ];

  for (const r of rules) {
    for (const k of r.keys) {
      if (t.indexOf(k) !== -1) return r.domain;
    }
  }

  // Short heuristics for question forms
  if (/\b(beasiswa|scholarship)\b/.test(t)) return 'scholarship';
  if (/\b(double|double degree|double-degree)\b/.test(t)) return 'double_degree';
  if (/\b(internasional|international|exchange)\b/.test(t)) return 'international_program';
  if (/\b(biaya|tuition|ukt|pendaftaran|daftar)\b/.test(t)) return 'tuition';
  if (/\b(kurikulum|mata\s+kuliah|belajar\s+apa|apa\s+yang\s+dipelajari|dipelajari|belajarnya)\b/.test(t)) return 'curriculum';
  if (/\b(prospek\s+kerja|karier|karir|career|kerja\s+dimana|kerja\s+di\s+mana|lulusan)\b/.test(t)) return 'career_path';

  return 'unknown';
}

module.exports = { detectKnowledgeDomain };
