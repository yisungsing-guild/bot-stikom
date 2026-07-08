// Test just the number pattern
const numberPattern = /[0-9][0-9.]{0,20}/;

const tests = ['2.500.000', '500.000', '1750.000', '2500000'];

console.log('Testing number pattern:');
for (const test of tests) {
  const m = numberPattern.exec(test);
  console.log(`"${test}" -> ${m ? 'match: ' + m[0] : 'no match'}`);
}

// Test full pattern step by step
console.log('\n\nTesting full section with different patterns:');

const section = `
2. Dana Pendidikan Pokok (DPP): 2.500.000
`;

const patterns = [
  /Dana\s*Pendidikan\s*Pokok\s*\(\s*DPP\s*\)\s*:\s*([0-9][0-9.]{0,20})/,
  /Dana\s+Pendidikan\s+Pokok\s*\(\s*DPP\s*\)\s*:\s*([0-9][0-9.,]{0,20})/,
  /DPP\s*\)\s*:\s*([0-9][0-9.]{0,20})/,
  /\bDPP\b[\s\S]{0,20}([0-9][0-9.]{0,20})/,
];

for (let i = 0; i < patterns.length; i++) {
  const m = patterns[i].exec(section);
  console.log(`Pattern ${i}: ${m ? 'MATCH -> ' + m[1] : 'no match'}`);
}
