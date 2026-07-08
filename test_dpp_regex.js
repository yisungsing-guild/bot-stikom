const section = `
2. Dana Pendidikan Pokok (DPP): 2.500.000
`;

console.log('Section:', JSON.stringify(section));

const re = /\b2\s*\.\s*(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*([0-9][0-9.]{0,20})/i;
const m = re.exec(section);
console.log('\nFirst regex (with \\b2):');
console.log('Match:', m);

// Try without word boundary
const re3 = /2\s*\.\s*(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*([0-9][0-9.]{0,20})/i;
const m3 = re3.exec(section);
console.log('\nThird regex (without word boundary):');
console.log('Match:', m3);
if (m3 && m3[1]) {
  console.log('Captured:', m3[1]);
}

// Try second regex
const re2 = /(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*([0-9][0-9.]{0,20})/i;
const m2 = re2.exec(section);
console.log('\nSecond regex (without number):');
console.log('Match:', m2);

