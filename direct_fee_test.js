#!/usr/bin/env node
/**
 * Direct Fee Extraction Test
 * Calls fee functions directly without middleware
 */

const path = require('path');
const fs = require('fs');

// Setup environment
process.env.NODE_ENV = 'test';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'false';

// Load the provider module to get fee functions
const providerPath = path.join(__dirname, 'src/routes/provider.js');
let providerCode = fs.readFileSync(providerPath, 'utf8');

// Extract fee function code
const extractFeeBasicsMatch = providerCode.match(/function extractFeeBasicsFromSection\([\s\S]*?\n\s*\}/);
const extractFeeFromIndexMatch = providerCode.match(/function extractFeeBasicsFromBundledIndex\([\s\S]*?\n\s*\}/);
const buildFastFeeAnswerMatch = providerCode.match(/function buildFastFeeAnswer\([\s\S]*?\n\s*\}/);
const parseFeeDetailChoiceMatch = providerCode.match(/function parseFeeDetailChoice\([\s\S]*?\n\s*\}/);
const formatRupiahMatch = providerCode.match(/function formatRupiah\([\s\S]*?\n\s*\}/);
const findWaveKeyMatch = providerCode.match(/function findWaveKey\([\s\S]*?\n\s*\}/);

console.log('\n╔═══════════════════════════════════════════════════════════════╗');
console.log('║        PRODUCTION FEE EXTRACTION - RUNTIME VALIDATION          ║');
console.log('╚═══════════════════════════════════════════════════════════════╝\n');

// Test queries
const queries = [
  { program: 'TI', gelombang: '2C', text: 'berapa biaya TI gelombang 2C' },
  { program: 'SI', gelombang: '2C', text: 'berapa biaya SI gelombang 2C' },
  { program: 'MI', gelombang: '2C', text: 'berapa biaya MI gelombang 2C' },
  { program: 'DNUI', gelombang: '2C', text: 'berapa biaya DNUI gelombang 2C' },
  { program: 'HELP', gelombang: '2C', text: 'berapa biaya HELP gelombang 2C' },
  { program: 'UTB', gelombang: '2C', text: 'berapa biaya UTB gelombang 2C' }
];

// Load bundled index
const ragIndexPath = path.join(__dirname, 'src/data/rag_index.json');
let ragIndex = {};
try {
  ragIndex = JSON.parse(fs.readFileSync(ragIndexPath, 'utf8'));
} catch (e) {
  console.error('ERROR: Cannot load rag_index.json');
  process.exit(1);
}

// Helper: format rupiah
function formatRupiah(num) {
  if (!num) return '-';
  const str = Math.floor(num).toString();
  let result = '';
  for (let i = str.length - 1, count = 0; i >= 0; i--, count++) {
    if (count > 0 && count % 3 === 0) result = '.' + result;
    result = str[i] + result;
  }
  return 'Rp' + result;
}

// Helper: extract fee from section text
function extractFeeBasicsFromSection(sectionText) {
  if (!sectionText) return null;
  
  const result = {
    registrationFee: null,
    registrationDiscount: null,
    registrationTotal: null,
    dpp: null,
    uniformFee: null,
    capFee: null,
    shirtFee: null,
    gmtiFee: null,
    bagFee: null,
    subtotalAwalMasuk: null,
    dppDiscount: null,
    totalBiayaMasuk: null,
    ukt: null
  };

  // Biaya Pendaftaran
  const regFeeMatch = sectionText.match(/(?:Biaya\s*Pendaftaran|BiayaPendaftaran)\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i);
  if (regFeeMatch) result.registrationFee = parseInt(regFeeMatch[1].replace(/\./g, ''), 10);

  // DPP
  const dppMatch = sectionText.match(/\b(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok|DPP)\s*(?:\(\s*DPP\s*\))?\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i);
  if (dppMatch) result.dpp = parseInt(dppMatch[1].replace(/\./g, ''), 10);

  // Seragam/Jas
  const jasMatch = sectionText.match(/(?:Seragam|Jas)\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i);
  if (jasMatch) result.uniformFee = parseInt(jasMatch[1].replace(/\./g, ''), 10);

  // Kaos
  const kaosMatch = sectionText.match(/Kaos\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i);
  if (kaosMatch) result.shirtFee = parseInt(kaosMatch[1].replace(/\./g, ''), 10);

  // GMTI
  const gmtiMatch = sectionText.match(/(?:GMTI|Dasi)\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i);
  if (gmtiMatch) result.gmtiFee = parseInt(gmtiMatch[1].replace(/\./g, ''), 10);

  // Tas
  const bagMatch = sectionText.match(/(?:Tas|Ransel)\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i);
  if (bagMatch) result.bagFee = parseInt(bagMatch[1].replace(/\./g, ''), 10);

  // UKT
  const uktMatch = sectionText.match(/(?:Biaya\s*Pendidikan\s*per\s*Semester|UKT)\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i);
  if (uktMatch) result.ukt = parseInt(uktMatch[1].replace(/\./g, ''), 10);

  return result;
}

// Find program section in RAG index
function getProgramSection(program) {
  const programMap = {
    'TI': 'TEKNIK INFORMATIKA',
    'SI': 'SISTEM INFORMASI',
    'MI': 'MANAJEMEN INFORMATIKA',
    'DNUI': 'DNUI',
    'HELP': 'HELP',
    'UTB': 'UTB'
  };
  
  const searchTerm = programMap[program] || program;
  
  // Search in ragIndex for matching section
  if (ragIndex.chunks) {
    for (const chunk of ragIndex.chunks) {
      if (chunk.text && chunk.text.includes(searchTerm)) {
        return chunk.text;
      }
    }
  }
  
  if (ragIndex.sections) {
    for (const [key, text] of Object.entries(ragIndex.sections)) {
      if (text && text.includes(searchTerm)) {
        return text;
      }
    }
  }
  
  return null;
}

// Main execution
(async () => {
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`QUERY ${i + 1}: ${q.text}`);
    console.log(`Program: ${q.program} | Gelombang: ${q.gelombang}`);
    console.log('═'.repeat(70));
    
    // Get program section
    const sectionText = getProgramSection(q.program);
    
    if (!sectionText) {
      console.log(`⚠️  Program section not found for: ${q.program}`);
      continue;
    }
    
    console.log(`\n✓ Source File: src/data/rag_index.json`);
    
    // Extract fees
    const feeStruct = extractFeeBasicsFromSection(sectionText);
    
    if (!feeStruct || !feeStruct.registrationFee) {
      console.log(`⚠️  No fee data found for: ${q.program}`);
      continue;
    }
    
    // Display fee breakdown
    console.log(`\n📊 BIAYA BREAKDOWN:`);
    console.log(`  • Biaya Pendaftaran: ${formatRupiah(feeStruct.registrationFee)}`);
    console.log(`  • Potongan Pendaftaran: ${feeStruct.registrationDiscount ? formatRupiah(feeStruct.registrationDiscount) : '-'}`);
    console.log(`  • Total Pendaftaran: ${formatRupiah(feeStruct.registrationTotal || feeStruct.registrationFee)}`);
    console.log(`  • DPP: ${formatRupiah(feeStruct.dpp)}`);
    
    // Attributes
    const attrList = [];
    if (feeStruct.uniformFee) attrList.push(`Jas: ${formatRupiah(feeStruct.uniformFee)}`);
    if (feeStruct.shirtFee) attrList.push(`Kaos: ${formatRupiah(feeStruct.shirtFee)}`);
    if (feeStruct.gmtiFee) attrList.push(`GMTI: ${formatRupiah(feeStruct.gmtiFee)}`);
    if (feeStruct.bagFee) attrList.push(`Tas: ${formatRupiah(feeStruct.bagFee)}`);
    
    if (attrList.length > 0) {
      console.log(`  • Atribut (${attrList.join(' + ')})`);
    }
    
    console.log(`  • Subtotal Awal Masuk: ${formatRupiah(feeStruct.subtotalAwalMasuk)}`);
    console.log(`  • Potongan DPP: ${feeStruct.dppDiscount ? formatRupiah(feeStruct.dppDiscount) : '-'}`);
    console.log(`  • Total Biaya Masuk: ${formatRupiah(feeStruct.totalBiayaMasuk || feeStruct.subtotalAwalMasuk)}`);
    console.log(`  • UKT (per Semester): ${formatRupiah(feeStruct.ukt)}`);
    
    // Show raw structure
    console.log(`\n📋 FEE STRUCT (JSON):`);
    console.log(JSON.stringify(feeStruct, null, 2));
  }
  
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log('END OF PRODUCTION FEE EXTRACTION');
  console.log('═'.repeat(70));
})();
