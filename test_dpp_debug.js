const section = `RINCIAN BIAYA PENDIDIKAN KELAS REGULER PROGRAM STUDI SISTEM INFORMASI

1. Pendaftaran: 500.000
2. Dana Pendidikan Pokok (DPP): 2.500.000
3. Jas almamater dan topi: 350.000
4. Kaos, tas, GMTI: 450.000
5. Biaya Pendidikan Per Semester: 1.750.000`;

const regexes = [
  /\b2\s*\.\s*(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i,
  /(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i,
];

console.log('Testing regex patterns on actual section:\n');
for (let i = 0; i < regexes.length; i++) {
  const m = regexes[i].exec(section);
  console.log(`Regex ${i}:`, regexes[i].source);
  console.log(`Match:`, m ? m[1] : 'NO MATCH');
  console.log('');
}

// Try simpler regex
const simpleRe = /Dana\s+Pendidikan\s+Pokok\s*\(\s*DPP\s*\)\s*:\s*([0-9.]+)/;
const m = simpleRe.exec(section);
console.log('Simpler regex:', simpleRe.source);
console.log('Match:', m ? m[1] : 'NO MATCH');
