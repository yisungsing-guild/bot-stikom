#!/usr/bin/env node
/*
Simple test runner for RAG queries. Reads env via dotenv and runs a set
of sample questions, printing answers and top contexts.

Usage:
  node scripts/testRagQuestions.js

Optional ENV:
  TEST_RAG_MIN_SCORE  default 0.2
  TEST_RAG_TOPK       default 3
  DOTENV_CONFIG_PATH  path to .env (optional)
  OPENAI_API_KEY      if present, embeddings will use OpenAI
*/
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

(function loadDotenv() {
  const explicit = process.env.DOTENV_CONFIG_PATH;
  if (explicit) {
    dotenv.config({ path: explicit, override: true });
    return;
  }
  const cwd = process.cwd();
  const prodLocal = path.join(cwd, '.env.production.local');
  const prod = path.join(cwd, '.env.production');
  const dev = path.join(cwd, '.env');
  if (fs.existsSync(prodLocal)) {
    dotenv.config({ path: prodLocal, override: true });
  } else if (fs.existsSync(prod)) {
    dotenv.config({ path: prod, override: true });
  } else if (fs.existsSync(dev)) {
    dotenv.config({ path: dev, override: true });
  } else if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    dotenv.config({ path: '.env.production', override: true });
  }
})();

const { query, getIndexPath } = require('../src/engine/ragEngine');

async function run() {
  const indexPath = getIndexPath();
  console.log('Index path:', indexPath);
  if (!fs.existsSync(indexPath)) {
    console.warn('Index not found at', indexPath);
  } else {
    try {
      const j = JSON.parse(fs.readFileSync(indexPath, 'utf8') || '[]');
      console.log('Index length:', Array.isArray(j) ? j.length : 0);
    } catch (e) {
      console.warn('Failed to read index file:', e && e.message ? e.message : e);
    }
  }

  const questions = [
    'hobi anak saya suka analisis pasar tren pasar online tu cocok masuk prodi mana?',
    'Berikan detail tentang masing-masing prodi',
    'Aku pengen tau informasi tentang kuliah tapi jalur RPL',
    'Apakah ITB STIKOM Bali sudah terakreditasi oleh BAN-PT? Apa peringkat akreditasinya?',
    'Menanyakan tentang seperti apa itu program Dual Degree',
    'Apa perbedaan mendasar dari program studi Sistem Informasi dengan Sistem Komputer?',
    'Apakah akreditasi dari kampus ITB STIKOM Bali',
    'kalau biaya untuk double degree apakah ada potongan biaya'
  ];

  for (const q of questions) {
    console.log('\n=== Question ===\n', q);
    try {
      const ragOptions = { answerQuestion: q, minScore: parseFloat(process.env.TEST_RAG_MIN_SCORE || '0.2'), strict: false, includeGlobal: true };
      const r = await query(q, parseInt(process.env.TEST_RAG_TOPK || '3', 10), ragOptions);
      console.log('Result source:', r && r.source);
      if (r && r.answer) {
        console.log('\nAnswer:\n', r.answer);
      } else {
        console.log('\nNo answer returned. Debug info:', r && r.debug ? r.debug : r);
      }
      if (r && r.contexts && r.contexts.length > 0) {
        console.log('\nTop contexts count:', r.contexts.length);
        const topChunks = r.contexts.slice(0, 3).map(c => (c && c.chunk ? String(c.chunk).slice(0, 300).replace(/\n/g, ' ') : ''));
        console.log('Top contexts preview:', topChunks);
      }
    } catch (e) {
      console.error('Query failed:', e && e.message ? e.message : e);
    }
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
