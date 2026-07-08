/**
 * AUDIT TASK 1.3: CHECK DATABASE FOR MI SOURCE DOCUMENTS
 * 
 * Query TrainingData table to see what source documents we have
 * and which ones mention MI
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function auditMIDocuments() {
  console.log('='.repeat(80));
  console.log('AUDIT: MI SOURCE DOCUMENTS IN DATABASE');
  console.log('='.repeat(80));
  console.log();
  
  try {
    // Get all training data
    const allDocs = await prisma.trainingData.findMany({
      select: { id: true, filename: true, source: true, active: true, createdAt: true }
    });
    
    console.log(`Total documents in TrainingData: ${allDocs.length}\n`);
    
    // Filter for MI-related documents
    const miDocs = allDocs.filter(doc => {
      const fname = (doc.filename || '').toLowerCase();
      return fname.includes('mi') || fname.includes('informatika') || fname.includes('informasi');
    });
    
    console.log(`Documents mentioning MI/Informatika/Informasi: ${miDocs.length}`);
    console.log('-'.repeat(80));
    
    miDocs.forEach((doc, idx) => {
      console.log(`\n[${idx + 1}] ${doc.filename}`);
      console.log(`    ID: ${doc.id}`);
      console.log(`    Source: ${doc.source}`);
      console.log(`    Active: ${doc.active}`);
      console.log(`    Created: ${doc.createdAt}`);
    });
    
    console.log();
    console.log('='.repeat(80));
    console.log('ALL DOCUMENTS (for reference)');
    console.log('='.repeat(80));
    console.log();
    
    const bySource = {};
    allDocs.forEach(doc => {
      if (!bySource[doc.source]) bySource[doc.source] = [];
      bySource[doc.source].push(doc);
    });
    
    Object.entries(bySource).forEach(([source, docs]) => {
      console.log(`\n${source} (${docs.length} docs):`);
      docs.forEach(doc => {
        console.log(`  - ${doc.filename} (active: ${doc.active})`);
      });
    });
    
    console.log();
    console.log('='.repeat(80));
    console.log('RECOMMENDATION');
    console.log('='.repeat(80));
    console.log();
    console.log('Next steps:');
    console.log('1. Check if "Penjelasan Prodi" documents have been ingested');
    console.log('2. If yes, verify why MI DEFINISI_PRODI chunks are missing');
    console.log('3. If no, ingest them now');
    console.log('4. Look for curriculum documents (kurikulum files) for MI');
    console.log('5. Look for career/prospek kerja documents for MI');
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

auditMIDocuments();
