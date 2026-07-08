const fs = require('fs');
const path = require('path');

const question = 'biaya prodi si gelombang 1a?';
const q = question.toLowerCase();

console.log('=== TEST tryStructuredEnrollmentDiscountAnswer ===');
console.log('Question:', q);

// Step 1: Trigger checks
const hasPotongan = q.includes('potongan');
const hasBiayaPlusWave = q.includes('biaya') && q.includes('gelombang');
const hasDaftarPlusWave = q.includes('daftar') && q.includes('gelombang');

console.log('\n1. Trigger checks:');
console.log('   hasPotongan:', hasPotongan);
console.log('   hasBiayaPlusWave:', hasBiayaPlusWave);
console.log('   hasDaftarPlusWave:', hasDaftarPlusWave);

if (!hasPotongan && !hasBiayaPlusWave && !hasDaftarPlusWave) {
  console.log('   => FAIL: No trigger');
  process.exit(1);
}

// Step 2: Load backup
const backupPath = path.join(__dirname, 'backups', 'backup-20260424-145106', 'trainingData.json');
console.log('\n2. Load backup:');
console.log('   Path:', backupPath);
console.log('   Exists:', fs.existsSync(backupPath));

let scanText = '';
try {
  if (fs.existsSync(backupPath)) {
    const backupRaw = String(fs.readFileSync(backupPath, 'utf8') || '');
    if (backupRaw) {
      const backupJson = JSON.parse(backupRaw);
      const rows = Array.isArray(backupJson && backupJson.rows) ? backupJson.rows : [];
      const backupText = rows.map(row => String(row && row.content ? row.content : '')).filter(Boolean).join('\n');
      if (backupText) scanText = backupText;
    }
  }
} catch (err) {
  console.log('   ERROR:', err.message);
}

console.log('   Loaded scanText length:', scanText.length);
if (!scanText) {
  console.log('   => FAIL: No scanText');
  process.exit(1);
}

// Step 3: Extract sections
console.log('\n3. Extract sections:');
const registrationSection = scanText.match(/Potongan\s*Biaya\s*Pendaftaran[\s\S]{0,900}?((?=Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok)|(?=Khusus\s+Alumni|4\.)|$)/i);
const dppSection = scanText.match(/Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok[\s\S]{0,900}?((?=Khusus\s+Alumni|4\.)|$)/i);

console.log('   Registration section found:', !!registrationSection);
console.log('   DPP section found:', !!dppSection);

const regText = registrationSection ? registrationSection[0] : '';
const dppText = dppSection ? dppSection[0] : '';

console.log('   regText length:', regText.length);
console.log('   dppText length:', dppText.length);

// Step 4: Parse maps
const normalizeWave = (waveText) => {
  const upper = String(waveText || '').toUpperCase().trim();
  if (!upper) return null;
  if (upper.includes('KHUSUS')) return 'Khusus';
  const base = /^((?:IV|III|II|I)|[1-9][0-9]?)(?:\s*[A-C])?$/.exec(upper);
  if (!base) return null;
  const token = base[1];
  const arabicToRoman = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X' };
  return arabicToRoman[token] || token;
};

const regMap = new Map();
const dppMap = new Map();

if (regText) {
  for (const match of regText.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)[\s\S]{0,80}?Gelombang\s*(Khusus|IV|III|II|I)(?:\s*[A-C])?/gi)) {
    const waveLabel = normalizeWave(match[2]);
    if (waveLabel) regMap.set(waveLabel, `Rp ${match[1]}`);
  }
}

if (dppText) {
  for (const match of dppText.matchAll(/Gelombang\s*(Khusus|IV|III|II|I)(?:\s*[A-C])?[\s\S]{0,80}?Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)/gi)) {
    const waveLabel = normalizeWave(match[1]);
    if (waveLabel) dppMap.set(waveLabel, `Rp ${match[2]}`);
  }
  for (const match of dppText.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)[\s\S]{0,80}?Gelombang\s*(Khusus|IV|III|II|I)(?:\s*[A-C])?/gi)) {
    const waveLabel = normalizeWave(match[2]);
    if (waveLabel && !dppMap.has(waveLabel)) dppMap.set(waveLabel, `Rp ${match[1]}`);
  }
}

console.log('\n4. Parse maps:');
console.log('   regMap size:', regMap.size, 'keys:', Array.from(regMap.keys()));
console.log('   dppMap size:', dppMap.size, 'keys:', Array.from(dppMap.keys()));

if (regMap.size === 0 && dppMap.size === 0) {
  console.log('   => FAIL: Both maps empty');
  process.exit(1);
}

// Step 5: Parse requestedWave
console.log('\n5. Parse requestedWave:');
const waveQueryMatch = /gelombang\s*([a-z0-9ivx]+)(?:\s*([a-c]))?/i.exec(question);
console.log('   waveQueryMatch:', waveQueryMatch);

const normalizeRequestedWave = (value) => {
  const text = String(value || '').toUpperCase().trim();
  if (!text) return null;
  if (text.includes('KHUSUS')) return 'Khusus';
  const romanMap = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X' };
  const numeric = /^([0-9]{1,2})([A-C])?$/.exec(text);
  if (numeric) return romanMap[numeric[1]] || null;
  const roman = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)([A-C])?$/.exec(text);
  if (roman) return roman[1];
  return null;
};

let requestedWave = null;
if (waveQueryMatch && waveQueryMatch[1]) {
  requestedWave = normalizeRequestedWave(`${waveQueryMatch[1]}${waveQueryMatch[2] || ''}`);
}
console.log('   requestedWave:', requestedWave);

// Step 6: Generate lines
console.log('\n6. Generate lines:');
const lines = [];
const pushTarget = (label) => {
  if (regMap.has(label)) lines.push(`- ${regMap.get(label)} jika mendaftar pada ${label === 'Khusus' ? 'Gelombang Khusus' : `Gelombang ${label}`}`);
  if (dppMap.has(label)) lines.push(`- ${dppMap.get(label)} untuk DPP pada ${label === 'Khusus' ? 'Gelombang Khusus' : `Gelombang ${label}`}`);
};

if (requestedWave) {
  pushTarget(requestedWave);
  console.log('   After pushTarget:', lines.length, 'lines');
  if (lines.length === 0) {
    for (const label of Array.from(new Set([...regMap.keys(), ...dppMap.keys()]))) pushTarget(label);
    console.log('   After fallback all:', lines.length, 'lines');
  }
} else {
  for (const label of Array.from(new Set([...regMap.keys(), ...dppMap.keys()]))) pushTarget(label);
}

console.log('   Final lines:', lines.length);
lines.forEach((line, i) => console.log(`   [${i}] ${line}`));

if (lines.length === 0) {
  console.log('   => FAIL: No lines generated');
  process.exit(1);
}

console.log('\n✓ SUCCESS: Should return structured answer');
