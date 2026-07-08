# Intent-Aware RAG System & Evidence Validation

Dokumentasi lengkap tentang sistem intent-aware retrieval dan evidence validation yang telah diimplementasikan.

---

## 📋 Daftar Isi

1. [Gambaran Umum](#gambaran-umum)
2. [Arsitektur Sistem](#arsitektur-sistem)
3. [Komponen-Komponen](#komponen-komponen)
4. [Alur Kerja](#alur-kerja)
5. [Contoh Kasus](#contoh-kasus)
6. [Konfigurasi & Debug](#konfigurasi--debug)
7. [Panduan Integrasi](#panduan-integrasi)

---

## Gambaran Umum

Sistem RAG telah diupgrade dengan kemampuan **intent-aware retrieval** dan **evidence validation**. Ini mengatasi masalah utama: retriever mengambil chunk hanya berdasarkan kecocokan kata, tanpa memvalidasi apakah konten chunk benar-benar menjawab intent user.

### Masalah Sebelumnya
```
User: "Apa itu Teknologi Informasi?"
Retriever mengambil: "Rincian Biaya Pendidikan Mahasiswa Baru Program Studi Teknologi Informasi..."
Hasil: LLM menjawab tentang BIAYA, bukan DEFINISI
```

### Solusi Sekarang
```
User: "Apa itu Teknologi Informasi?"
1. Intent Detection → DEFINISI_PRODI
2. Filter chunks → Ambil hanya kategori PRODI_PROFILE
3. Validate evidence → Pastikan chunk berisi "pengertian", "definisi", "tujuan", dll
4. Hasilnya: Jawaban tepat tentang DEFINISI, atau "tidak ada informasi"
```

---

## Arsitektur Sistem

```
User Query
    ↓
[Intent Classification]
    ↓
[Semantic Retrieval] → Top-K chunks
    ↓
[Document Category Filtering] → Filter berdasarkan allowed categories
    ↓
[Evidence Validation] → Cek apakah chunk punya evidence yang sesuai intent
    ↓
[Relevance Validation] → Cek semantic relevance terhadap question
    ↓
[Minimum Evidence Rule] → Jika tidak ada evidence cukup, return null
    ↓
[LLM Answer Generation] (jika chunk valid)
    ↓
User Answer
```

---

## Komponen-Komponen

### 1. **intentClassifier.js** - Intent Classification Module

**Fungsi Utama:**
- `classifyIntent(question)` - Klasifikasi query ke intent tertentu
- `getIntentConfig(intentKey)` - Ambil config intent
- `getAllowedDocCategories(intent)` - Ambil kategori dokumen yang diizinkan
- `getForbiddenDocCategories(intent)` - Ambil kategori dokumen yang dilarang
- `shouldIncludeChunkForIntent(chunk, intent)` - Cek apakah chunk sesuai intent

**Intent Types:**
```javascript
- DEFINISI_PRODI          // Apa itu [Program]?
- KURIKULUM_PEMBELAJARAN  // Apa saja yang dipelajari?
- PROSPEK_KERJA          // Lulusan kerja di mana?
- BIAYA_PENDIDIKAN       // Berapa biaya?
- AKREDITASI_PERINGKAT   // Akreditasi apa?
- JADWAL_PENDAFTARAN     // Kapan daftar?
- BEASISWA               // Ada beasiswa?
- LOKASI_KAMPUS          // Dimana kampus?
- PROGRAM_KHUSUS         // Ada international class?
- GENERAL                // (default)
```

**Document Categories:**
```javascript
- PRODI_PROFILE      // Profil/deskripsi program
- KURIKULUM          // Struktur kurikulum
- MATA_KULIAH        // Daftar mata kuliah
- PROSPEK_KERJA      // Peluang karir
- BIAYA              // Biaya pendidikan
- AKREDITASI         // Akreditasi program
- BEASISWA           // Program beasiswa
- LOKASI             // Lokasi kampus
- PROGRAM_KHUSUS     // Program internasional, double degree
- JADWAL             // Jadwal pendaftaran
- MOU                // Memorandum of Understanding
- ADMINISTRASI       // Dokumen administrasi internal
- SK                 // Surat Keputusan
- SURAT              // Surat-surat
- TEMPLATE           // Template/formulir
- UNKNOWN            // (default jika tidak terdeteksi)
```

**Contoh Penggunaan:**
```javascript
const { classifyIntent, getAllowedDocCategories } = require('./intentClassifier');

// Klasifikasi intent dari query user
const intent = classifyIntent('Apa itu Teknologi Informasi?');
// Result: 'DEFINISI_PRODI'

// Ambil kategori dokumen yang diizinkan untuk intent ini
const allowed = getAllowedDocCategories(intent);
// Result: Set(['PRODI_PROFILE'])
```

---

### 2. **evidenceValidator.js** - Evidence Validation Module

**Fungsi Utama:**
- `validateChunkEvidence(chunk, intent)` - Cek apakah chunk punya evidence untuk intent
- `validateChunkRelevanceToQuestion(chunk, question, intent)` - Cek semantic relevance
- `validateChunkForAnswer(chunk, question, intent)` - Full validation

**Cara Kerja:**
1. **Pattern Matching** - Cek apakah chunk mengandung pattern yang sesuai dengan intent
2. **Keyword Matching** - Cek kehadiran keywords penting untuk intent
3. **Context Check** - Pastikan chunk tidak didominasi oleh topik lain
4. **Length Check** - Chunk harus cukup panjang untuk credible evidence

**Contoh Validasi:**

```javascript
const { validateChunkEvidence } = require('./evidenceValidator');

const chunk = {
  chunk: "Teknologi Informasi adalah program studi yang mempelajari sistem komputer, jaringan, dan software..."
};

const result = validateChunkEvidence(chunk, 'DEFINISI_PRODI');
// Result: { 
//   hasEvidence: true, 
//   confidence: 'HIGH',
//   reasons: [...],
//   matchCount: 3
// }
```

**Evidence Requirements untuk Setiap Intent:**

| Intent | Required Evidence | Forbidden Patterns |
|--------|-------------------|-------------------|
| DEFINISI_PRODI | pengertian, deskripsi, profil, tujuan, visi | biaya, SK, administrasi |
| KURIKULUM_PEMBELAJARAN | mata kuliah, kurikulum, pembelajaran | biaya, jadwal, administrasi |
| PROSPEK_KERJA | karir, kerja, profesi, lulusan | biaya, jadwal, administrasi |
| BIAYA_PENDIDIKAN | biaya, rp, dpp, ukt, nominal | administrasi, mou, template |
| AKREDITASI_PERINGKAT | akreditasi, ban-pt, sk | biaya, administrasi |
| JADWAL_PENDAFTARAN | jadwal, tanggal, gelombang, deadline | biaya, administrasi |

---

### 3. **docCategoryClassifier.js** - Document Category Classifier

**Fungsi Utama:**
- `classifyDocumentCategory(text, filename, metadata)` - Klasifikasi dokumen ke kategori
- `classifyDocumentCategoryDetailed(...)` - Dengan detailed scoring info
- `enrichChunkWithCategory(chunk)` - Tambahkan docCategory ke chunk

**Cara Kerja:**
- Menggunakan pattern matching pada filename dan isi dokumen
- Menghitung score untuk setiap kategori
- Memilih kategori dengan score tertinggi yang melampaui threshold

**Contoh:**
```javascript
const { classifyDocumentCategory, enrichChunkWithCategory } = require('./docCategoryClassifier');

// Klasifikasi dokumen
const category = classifyDocumentCategory(
  "Mata kuliah semester 1: Pemrograman Dasar, Matematika Diskrit...",
  "kurikulum_ti.pdf"
);
// Result: 'KURIKULUM'

// Tambahkan docCategory ke chunk saat ingest
const chunk = { chunk: "...", filename: "..." };
const enriched = enrichChunkWithCategory(chunk);
// Result: { ..., docCategory: 'KURIKULUM' }
```

---

### 4. **ragEngine.js Modifications**

**Perubahan Utama:**

1. **Import Module Baru**
```javascript
const { classifyIntent, getAllowedDocCategories, shouldIncludeChunkForIntent } = require('./intentClassifier');
const { validateChunkForAnswer, validateChunkEvidence } = require('./evidenceValidator');
const { enrichChunkWithCategory } = require('./docCategoryClassifier');
```

2. **Ingest Time: Enrichment Otomatis**
```javascript
// Di ingestTrainingData, setiap chunk di-enrich dengan docCategory
const enrichedChunk = enrichChunkWithCategory(chunkObj);
filteredIndex.push(enrichedChunk);
```

3. **Query Time: Intent-Aware Filtering**
```javascript
// Di query function, tambahan step:
const userIntent = classifyIntent(question);
const validatedScored = applyIntentAwareFilteringAndValidation(question, scored, userIntent);
```

4. **Minimum Evidence Rule**
```javascript
// Jika tidak ada chunk dengan evidence cukup:
if (skipRagAnswer) {
  return { answer: null, source: 'rag-no-evidence', ... };
}
```

---

## Alur Kerja

### Saat Ingest (Training Data Upload)

```
User Upload Document
    ↓
[Chunking] → Potong ke 900 chars per chunk
    ↓
[Metadata Extraction] → Extract program, wave, fee type, dll
    ↓
[Category Classification] ← NEW
    | classifyDocumentCategory(chunkText, filename)
    | Result: PRODI_PROFILE, KURIKULUM, BIAYA, dll
    ↓
[Embedding] → Generate embedding vektor
    ↓
[Save to Index] dengan docCategory field
    ↓
Training Complete
```

### Saat Query (User bertanya)

```
User Question: "Apa itu Teknologi Informasi?"
    ↓
[Intent Classification] ← NEW
    | classifyIntent(question)
    | Result: DEFINISI_PRODI
    ↓
[Semantic Retrieval] → Top-K chunks dengan highest similarity
    ↓
[Document Category Filtering] ← NEW
    | Filter: hanya kategori PRODI_PROFILE
    | Reject: BIAYA, ADMINISTRASI, MOU, SK, TEMPLATE
    ↓
[Evidence Validation] ← NEW
    | Cek apakah chunk punya "pengertian", "deskripsi", "profil"
    | Cek tidak hanya menyebutkan TI tapi di context biaya/administrasi
    ↓
[Relevance Validation] ← NEW
    | Cek semantic match terhadap "Apa itu TI?"
    | Reject jika chunk lebih fokus ke aspek lain
    ↓
[Minimum Evidence Rule] ← NEW
    | Jika tidak ada chunk dengan evidence → return null
    | Jangan gunakan chunk dari kategori forbidden
    ↓
[Generate Answer] (jika valid)
    | Gunakan LLM dengan validated chunks
    ↓
User Response
```

---

## Contoh Kasus

### Case 1: Definition Question

```
Q: "Apa itu Teknologi Informasi?"

Chunks Retrieved by Semantic Similarity:
1. "Rincian Biaya Pendidikan Mahasiswa Baru Program Studi TI: DPP Rp 5,000,000..."
   - DocCategory: BIAYA (forbidden)
   - Action: REJECT ✗

2. "Teknologi Informasi adalah program studi yang mempelajari sistem komputer..."
   - DocCategory: PRODI_PROFILE (allowed)
   - Evidence: "adalah program studi", "mempelajari sistem"
   - Action: ACCEPT ✓

3. "Akreditasi TI: Unggul, SK No 123/2024"
   - DocCategory: AKREDITASI (forbidden)
   - Action: REJECT ✗

Final Answer: Generated dari chunk #2 (valid definition)
```

### Case 2: Curriculum Question

```
Q: "TI belajar apa saja?"

Chunks:
1. "Jadwal Pendaftaran TI Gelombang 1: Tanggal 1 Maret 2024"
   - DocCategory: JADWAL (forbidden)
   - Action: REJECT ✗

2. "Mata Kuliah Semester 1: Pemrograman Dasar (4 SKS), Matematika Diskrit (3 SKS)..."
   - DocCategory: MATA_KULIAH (allowed)
   - Evidence: Multiple mata kuliah dengan SKS
   - Action: ACCEPT ✓

3. "Kurikulum TI: Total 144 SKS dalam 8 semester dengan fokus pada software development..."
   - DocCategory: KURIKULUM (allowed)
   - Evidence: "kurikulum", "144 SKS", "fokus pada"
   - Action: ACCEPT ✓

Final Answer: Generated dari chunks #2 dan #3 (valid curriculum info)
```

### Case 3: No Matching Evidence

```
Q: "Prospek kerja lulusan TI?"

Chunks:
1. "TI Batch 2024 terdiri dari 120 mahasiswa"
   - DocCategory: ADMINISTRASI (forbidden)
   - Action: REJECT ✗

2. "Biaya TI per semester: Rp 10,000,000"
   - DocCategory: BIAYA (forbidden)
   - Action: REJECT ✗

3. "SK Pembina Ormawa TI Tahun 2024"
   - DocCategory: SK (forbidden)
   - Action: REJECT ✗

All chunks rejected, no valid evidence found

Final Response: null (no answer)
Message: "Maaf, saya belum menemukan informasi yang relevan mengenai prospek kerja lulusan TI pada data yang tersedia."
```

---

## Konfigurasi & Debug

### Environment Variables

```bash
# Enable intent-aware filtering debug logging
export RAG_DEBUG_INTENT_FILTERING=true

# View chunk scoring details
export RAG_DEBUG_CHUNK_SCORING=true

# Minimum confidence score
export RAG_MIN_CONFIDENCE_SCORE=0.6

# Strict mode (require higher similarity for short queries)
export RAG_STRICT_MODE=true
```

### Debug Output Contoh

```json
{
  "RAG_DEBUG_INTENT_FILTERING": {
    "userIntent": "DEFINISI_PRODI",
    "question": "Apa itu Teknologi Informasi?",
    "totalChunks": 45,
    "totalChunksAfterRelevance": 28,
    "validatedChunks": 8,
    "filtered": 20,
    "rejectionReasons": [
      "forbidden_category",
      "not_in_allowed_categories",
      "no_evidence_for_intent",
      "not_relevant_to_question"
    ]
  }
}
```

### Testing Query Patterns

```javascript
// Test dengan debug enabled
const testQueries = [
  "Apa itu Teknologi Informasi?",        // DEFINISI_PRODI
  "TI belajar apa saja?",                // KURIKULUM
  "Prospek kerja TI?",                   // PROSPEK_KERJA
  "Berapa biaya TI?",                    // BIAYA_PENDIDIKAN
  "Akreditasi TI?",                      // AKREDITASI_PERINGKAT
  "Kapan pendaftaran TI dibuka?",        // JADWAL_PENDAFTARAN
  "Ada beasiswa TI?",                    // BEASISWA
  "Dimana lokasi kampus TI?",            // LOKASI_KAMPUS
  "Ada TI kelas internasional?"          // PROGRAM_KHUSUS
];

for (const query of testQueries) {
  console.log(`\nTesting: ${query}`);
  const result = await ragEngine.query(query, 8, { strict: false });
  console.log(`Intent: ${result.debug?.intent}`);
  console.log(`Answer Valid: ${result.answer !== null}`);
  console.log(`Contexts: ${result.contexts?.length || 0}`);
}
```

---

## Panduan Integrasi

### 1. Update Existing Data (Re-categorize chunks)

Jika ada chunk lama di index yang belum punya `docCategory`:

```javascript
const fs = require('fs');
const { enrichChunkWithCategory } = require('./src/engine/docCategoryClassifier');

// Load index
const index = JSON.parse(fs.readFileSync('./src/data/rag_index.json', 'utf8'));

// Enrich semua chunks
const enrichedIndex = index.map(chunk => {
  if (!chunk.docCategory) {
    return enrichChunkWithCategory(chunk);
  }
  return chunk;
});

// Save
fs.writeFileSync('./src/data/rag_index.json', JSON.stringify(enrichedIndex));
console.log(`Enriched ${enrichedIndex.filter(c => c.docCategory).length} chunks`);
```

### 2. Verify Implementation

```bash
# Check syntax
npm run lint

# Run tests (jika ada test suite)
npm test

# Manual test
node -e "
const intent = require('./src/engine/intentClassifier');
console.log(intent.classifyIntent('Apa itu TI?'));
"
```

### 3. Monitor in Production

```javascript
// Add to provider.js atau logging system
if (process.env.RAG_DEBUG_INTENT_FILTERING) {
  logger.info({
    intent: userIntent,
    validatedChunks: validatedScored.length,
    totalChunks: scored.length
  }, '[RAG] Intent filtering results');
}
```

---

## Important Notes

### ✅ Best Practices

1. **Regular Document Upload Review**
   - Pastikan dokumen yang di-upload properly categorized
   - Monitor classification accuracy

2. **Intent Detection Tuning**
   - Jika ada query patterns yang tidak terdeteksi, tambahkan ke regex di `intentClassifier.js`
   - Test dengan beragam phrasing/slang user

3. **Evidence Patterns**
   - Perbarui `EVIDENCE_PATTERNS` saat ada dokumen baru dengan format unik
   - Validate evidence patterns dengan real data

4. **Monitoring**
   - Enable `RAG_DEBUG_INTENT_FILTERING` untuk sesi quality check
   - Track answer accuracy dan user satisfaction

### ⚠️ Known Limitations

1. **OCR Documents**
   - Chunks dari OCR mungkin tidak pass evidence validation karena noise
   - Solution: Pre-process OCR output atau manual cleanup

2. **Ambiguous Queries**
   - User query yang sangat ambiguous mungkin mis-classified
   - Solution: Add clarification question atau allow multiple intent searches

3. **New Document Types**
   - Kategori baru harus ditambahkan manual ke `DOC_CATEGORIES` dan `CATEGORY_PATTERNS`
   - Solution: Provide admin interface untuk category management

---

## Troubleshooting

### Problem: Semua chunk di-reject untuk query yang valid

**Solusi:**
1. Enable `RAG_DEBUG_INTENT_FILTERING=true`
2. Cek di log: intent apa yang terdeteksi?
3. Cek docCategory dari chunks: match dengan allowed categories?
4. Cek evidence: chunk punya pattern yang sesuai?

### Problem: Query yang harusnya return null malah generate jawaban salah

**Solusi:**
1. Cek `getForbiddenDocCategories()` untuk intent tersebut
2. Verify bahwa chunk dengan `docCategory` forbidden benar-benar di-reject
3. Check `skipRagAnswer` flag di query result

### Problem: Performance issue (slow query)

**Solusi:**
1. Evidence validation seharusnya cepat (<10ms per chunk)
2. Check apakah `EVIDENCE_PATTERNS` regex terlalu kompleks
3. Reduce `topK` jika processing too many chunks

---

## Next Steps

1. **Deploy & Monitor** - Roll out ke production dengan debug logging
2. **Collect Feedback** - Monitor user satisfaction dan answer accuracy
3. **Refine Patterns** - Update intent/evidence patterns based on real queries
4. **Expand Categories** - Tambah kategori dokumen baru sesuai kebutuhan
5. **AI Tuning** - Fine-tune LLM prompts berdasarkan validated contexts

---

**Version:** 1.0  
**Last Updated:** 2024-06-02  
**Status:** Production Ready ✅
