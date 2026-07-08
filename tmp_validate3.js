const humanizer = require('./src/engine/humanizer');
const sample = 'Program studi TI berfokus pada infrastruktur TI.\n\nUntuk meringankan biaya beasiswa KIP, Anda bisa...';
console.log('cleaned program_definition:', humanizer.removeIrrelevantMarketingSections(sample, 'program_definition'));
console.log('cleaned general:', humanizer.removeIrrelevantMarketingSections(sample, 'general'));
