const provider = require('./src/routes/provider');
const original = 'Berapa biaya kuliah Sistem Informasi?';
const augmented = original + '\n\nFokus pada beasiswa KIP.';
const actual = provider.detectIntent ? provider.detectIntent(original) : null;
const actualAug = provider.detectIntent ? provider.detectIntent(augmented) : null;
console.log('original', original, '->', actual);
console.log('augmented', augmented, '->', actualAug);
