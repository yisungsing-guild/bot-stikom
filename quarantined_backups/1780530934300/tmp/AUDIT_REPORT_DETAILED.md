# DETAILED RAG AUDIT REPORT
## Top 10 Chunks per Query dengan Scoring Breakdown

---

## 1. "Apa itu Sistem Informasi"
**Source:** gpt-4o-mini | **Contexts:** 1

### TOP RANKING:
| Rank | File | Category | Final Score | Semantic | Attribute | Metadata | Evidence | 
|------|------|----------|-------------|----------|-----------|----------|----------|
| 1 | Penjelasan Semua Program Studi.pdf | KURIKULUM | **2.20** | 0.5881 | 1.00 | 0 | - |

**✓ HASIL:** Query ini berhasil - chunk yang relevan dengan atribut program SI berada di rank #1 dengan semantic score tinggi (0.5881) dan attribute match score maksimal (1.00).

---

## 2. "Apa itu Teknologi Informasi"
**Source:** rag-answer-rejected | **Contexts:** 40

### TOP 10 RANKING:
| Rank | File | Category | Final Score | Semantic | Attribute | Metadata | Evidence |
|------|------|----------|-------------|----------|-----------|----------|----------|
| 1 | Penjelasan Semua Program Studi.pdf | - | 0.5348 | 0 | 0 | 0 | N/A |
| 2 | (Campus Info) | - | 0.5110 | 0 | 0 | 0 | N/A |
| 3 | hobi-sesuai-program-studi.docx | - | 0.4997 | 0 | 0 | 0 | N/A |
| 4 | (Campus Address) | - | 0.4918 | 0 | 0 | 0 | N/A |
| 5 | SK AKREDITASI TI.pdf | - | 0.4661 | 0 | 0 | 0 | N/A |
| 6 | (Contacts) | - | 0.4639 | 0 | 0 | 0 | N/A |
| 7 | Accreditation PDF | - | 0.4556 | 0 | 0 | 0 | N/A |
| 8 | (Campus Contact) | - | 0.4491 | 0 | 0 | 0 | N/A |
| 9 | (Regulations) | - | 0.4383 | 0 | 0 | 0 | N/A |
| 10 | (Regulations) | - | 0.4259 | 0 | 0 | 0 | N/A |

**⚠ ISSUE DETECTED:**
- Rank #1 chunk adalah dari `Penjelasan Semua Program Studi.pdf` yang relevant, TAPI:
  - **Semantic score = 0** (should be > 0.5)
  - **Attribute score = 0** (should be > 0 untuk TI match)
  - **Metadata boost = 0** (tidak ada pertimbangan metadata)
  - Chunks ranking dicampur dengan info kampus, akreditasi, dan dokumen tidak relevan

---

## 3. "Prospek kerja Sistem Informasi"
**Source:** rag-answer-rejected | **Contexts:** 40

### TOP 10 RANKING:
| Rank | File | Category | Final Score | Semantic | Attribute | Metadata |
|------|------|----------|-------------|----------|-----------|----------|
| 1 | Penjelasan Prodi dan Karier Masa Depan.xlsx | - | **0.6570** | 0 | 0 | 0 |
| 2 | Penjelasan Semua Program Studi.pdf | - | **0.6183** | 0 | 0 | 0 |
| 3 | Penjelasan Semua Program Studi.pdf | - | 0.6020 | 0 | 0 | 0 |
| 4 | Penjelasan Prodi dan Karier.xlsx | - | 0.5640 | 0 | 0 | 0 |
| 5 | Prodi dan Karier.xlsx | - | 0.5473 | 0 | 0 | 0 |
| 6 | Penjelasan Semua Program Studi.pdf | - | 0.5462 | 0 | 0 | 0 |
| 7 | Penjelasan Semua Program Studi.pdf | - | 0.5442 | 0 | 0 | 0 |
| 8 | Prodi dan Karier.xlsx | - | 0.5281 | 0 | 0 | 0 |
| 9 | Penjelasan Semua Program Studi.pdf | - | 0.4975 | 0 | 0 | 0 |
| 10 | hobi-sesuai-program-studi.docx | - | 0.4759 | 0 | 0 | 0 |

**✓ HASIL BAIK:** Top chunks berasal dari dokumen yang tepat (Penjelasan Prodi, Karier, Program Studi). Tapi **Semantic score masih 0** untuk semua - ada issue di scoring breakdown.

---

## 4. "Prospek kerja Teknologi Informasi"
**Source:** rag-answer-rejected | **Contexts:** 40

### TOP 10 RANKING:
| Rank | File | Category | Final Score | Semantic | Attribute | Metadata |
|------|------|----------|-------------|----------|-----------|----------|
| 1 | Penjelasan Semua Program Studi.pdf | - | 0.5443 | 0 | 0 | 0 |
| 2 | hobi-sesuai-program-studi.docx | - | 0.4910 | 0 | 0 | 0 |
| 3 | (Campus Info) | - | 0.4831 | 0 | 0 | 0 |
| 4 | (Campus Info) | - | 0.4808 | 0 | 0 | 0 |
| 5 | (Campus Info) | - | 0.4594 | 0 | 0 | 0 |
| 6 | Kalender Pendaftaran.xls | - | 0.4550 | 0 | 0 | 0 |
| 7 | SK AKREDITASI TI.pdf | - | 0.4444 | 0 | 0 | 0 |
| 8 | (Campus Info) | - | 0.4431 | 0 | 0 | 0 |
| 9 | Accreditation PDF | - | 0.4429 | 0 | 0 | 0 |
| 10 | (Scholarship Info) | - | 0.4391 | 0 | 0 | 0 |

**⚠ ISSUE:** Rank #1 adalah dokumen relevant, tapi diikuti oleh chunk hobi (rank 2) dan banyak info kampus yang tidak relevan untuk query "prospek kerja".

---

## 5. "Apakah ada program double degree internasional"
**Source:** rag-dual-degree-list | **Contexts:** 0

**✓ HASIL:** Pertanyaan ini di-handle oleh rule-based system khusus (bukan retrieval-based), jadi tidak ada debug data.

---

## 6. "Berapa biaya pendaftaran"
**Source:** rag-answer-rejected | **Contexts:** 10

### TOP 10 RANKING:
| Rank | File | Category | Final Score | Semantic | Attribute | Metadata |
|------|------|----------|-------------|----------|-----------|----------|
| 1 | (Biaya Info) | - | 0.5476 | 0 | 0 | 0 |
| 2 | Kalender Pendaftaran TA 2026-2027.xls | - | 0.4890 | 0 | 0 | 0 |
| 3 | (Calendar) | - | 0.4766 | 0 | 0 | 0 |
| 4 | Kalender Pendaftaran.xlsx | - | 0.4735 | 0 | 0 | 0 |
| 5 | Kalender Pendaftaran TA 2026-2027.xls | - | 0.4467 | 0 | 0 | 0 |
| 6 | (Calendar) | - | 0.4366 | 0 | 0 | 0 |
| 7 | (Calendar) | - | 0.3966 | 0 | 0 | 0 |
| 8 | CHATBOT - Double Degree (1).docx | - | 0.0460 | 0 | 0 | 0 |
| 9 | CHATBOT - Double Degree (1).docx | - | 0.0380 | 0 | 0 | 0 |
| 10 | CHATBOT - Double Degree (1).docx | - | 0.0366 | 0 | 0 | 0 |

**⚠ CRITICAL ISSUE:** Chunks ranking adalah kalender pendaftaran (tidak relevan untuk "biaya pendaftaran"). Double Degree chunks di rank 8-10 padahal mereka lebih relevant.

---

## KESIMPULAN

### ✓ KELEBIHAN:
1. Chunk relevant secara umum berada di top ranking (semantic relevance OK)
2. Query #1 (SI definition) sempurna - attribute matching bekerja
3. Tidak ada chunk completely random di ranking atas

### ⚠ MASALAH UTAMA:

**1. Semantic Score = 0 di mayoritas chunks**
   - Untuk queries 2-6, semua semantic scores adalah 0 → ada bug di scoring breakdown
   - Padahal chunk ini kemudian ditampilkan dengan finalScore yang masuk akal
   - Perlu debug bagaimana finalScore dihitung vs semanticScore yang ditampilkan

**2. Attribute Score = 0 untuk semua**
   - Tidak ada pertimbangan untuk program-specific queries
   - Query "Prospek kerja Sistem Informasi" seharusnya boost chunks yang mention SI, tapi attribute=0

**3. Metadata Boost tidak aktif**
   - Untuk query "biaya pendaftaran", chunks tentang biaya seharusnya dapat boost metadata
   - Tapi tampilnya metadata = 0 untuk semua

**4. Context mixing:**
   - "Prospek kerja TI" hadir dengan campus contact info, akreditasi docs (tidak relevant)
   - "Biaya pendaftaran" hadir dengan calendar chunks (tidak langsung relevant)

### REKOMENDASI NEXT STEPS:
1. Audit bagaimana `semanticScore`, `attributeScore`, `metadataBoost` disimpan dalam validatedScored
2. Verifikasi pembobotan di `computeChunkCompositeScore` vs apa yang disimpan ke `debugCollector`
3. Tingkatkan relevance filtering untuk kategori tertentu (tidak semua chunks harus included)
4. Test attribute matching untuk program-specific queries (SI vs TI vs SK vs BD)
