// Test regex patterns for the three failing questions

const questions = [
  'nilai ku salah harus lapor siapa?',
  'ada sertifikasi buat mahasiswa?',
  'pendaftaran wisuda gimana?'
];

console.log('Testing regex patterns:\n');

questions.forEach(q => {
  console.log(`Question: "${q}"`);
  console.log(`Lowercase: "${q.toLowerCase()}"`);
  
  // tryAcademicGradeAnswer pattern
  const gradePattern = /\b(nilai\s+salah|salah\s+nilai|revisi\s+nilai|koreksi\s+nilai|nilai\s+ku|ku\s+salah|salah\s+harus|lapor\s+siapa)\b/i;
  console.log(`Grade pattern match: ${gradePattern.test(q)}`);
  
  // tryCertificationAnswer pattern 1
  const certPattern1 = /\b(sertifikasi|sertifikat|pelatihan|training)\b/i;
  console.log(`Certification pattern 1 match: ${certPattern1.test(q)}`);
  
  // tryCertificationAnswer pattern 2
  const certPattern2 = /\b(mahasiswa|untuk\s+mahasiswa|buat\s+mahasiswa|ada\s+buat)\b/i;
  console.log(`Certification pattern 2 match: ${certPattern2.test(q)}`);
  
  // tryGraduationRegistrationAnswer pattern
  const gradPattern = /\b(wisuda|pendaftaran\s+wisuda|daftar\s+wisuda|yudisium|wisuda\s+gimana|wisuda\s+caranya)\b/i;
  console.log(`Graduation pattern match: ${gradPattern.test(q)}`);
  
  // tryRegistrationHowAnswer exclusion pattern
  const specificObjectPattern = /\b(wisuda|yudisium|akun|account|event|ujian|examination|krs|transkrip|nilai|sertifikasi|pelatihan|training|ukm|ormawa|bem|lomba|beasiswa)\b/i;
  console.log(`Specific object exclusion match: ${specificObjectPattern.test(q)}`);
  
  console.log('---\n');
});
