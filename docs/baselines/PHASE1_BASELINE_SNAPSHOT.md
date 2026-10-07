# PHASE 1 FROZEN BASELINE SNAPSHOT
**Historical Freeze Commit**: `353559c2c8f0686c6cb6f2a871e66dc348cc558d`  
**Git Tag (Historical Code Anchor)**: `phase1-freeze`  
**Corrected Regression Commit**: `40843bc99c2cb072830b799e26e64017a3ac1c28`  
**Git Tag (Current Regression Contract)**: `phase1-regression-baseline`  
**Status**: `PHASE 1 = FROZEN & VERIFIED`, `PHASE 2 = IN PROGRESS (HOLD AT STEP 3)`  
**Timestamp**: `2026-10-07T19:15:00+08:00`  

---

## 1. REKONSILIASI DUA METRIK PENGUJIAN PHASE 1 (CANONICAL TEST ACCOUNTING)

Untuk tata kelola (*governance*) pengujian yang presisi, seluruh metrik pengujian Phase 1 dibagi secara tegas menjadi dua metrik:

### Metrik A: Suite Execution Count (333 Tests)
*Total test yang dieksekusi jika masing-masing npm script dan suite pengujian dijalankan secara terpisah (termasuk duplikasi antar-script).*

1. **Legacy Engine (`src/engine/`)**:
   - `npm run test:contract` (10 suites): **132 tests**
   - `npm run test:document-safety` (2 suites): **6 tests**
   - `npm run test:schedule` (1 suite): **12 tests**
   - `npm run test:semantic` (5 suites): **17 tests**
   - `npm run test:retrieval` (4 suites): **110 tests**
   - Standalone Discount & Multi-turn (4 suites): **22 tests**  
     (`registrationDiscount.cases`: 3, `registrationDiscount.regression`: 2, `parse_fee_numbering`: 2, `providerMultiTurnIntegration`: 15)  
   - *Subtotal Legacy Engine*: **299 tests executed**
2. **Greenfield Core (`src/core/`)**:
   - `tests/greenfieldCore.test.js`: **14 tests**
   - `tests/semanticCorrectnessRegression.test.js`: **20 tests**  
   - *Subtotal Greenfield Core*: **34 tests executed**
3. **Total Suite Execution Phase 1**: $299 + 34 = \mathbf{333\text{ tests executed}}$.

---

### Metrik B: Unique Test Case Count (CANONICAL GOVERNANCE: 325 Tests)
*Jumlah test case unik aktual tanpa double-counting antar-suite, dieksekusi dalam 1 proses Jest tunggal.*

- **Total Unique Test Files**: **25 files**
- **Total Unique Test Cases**: **325 tests (100% PASS)**
- **Audit Overlap Antar-Script (Delta 8 Tests)**:
  Terdapat 3 file yang terdaftar di lebih dari satu script npm:
  1. `tests/semanticRawLeakComplaint.test.js` (**2 tests**): masuk di `test:document-safety` dan `test:semantic`.
  2. `tests/semanticRagShortDefinitionRegression.test.js` (**3 tests**): masuk di `test:contract` dan `test:semantic`.
  3. `tests/semanticSmallTalkGuard.test.js` (**3 tests**): masuk di `test:contract` dan `test:semantic`.
  $$\text{Total Duplicate Executions} = 2 + 3 + 3 = 8\text{ tests}$$
  $$\text{Unique Canonical Tests} = 333 - 8 = \mathbf{325\text{ tests}}$$

Seluruh rincian per file terdokumentasi secara definitif dalam mesin pada [PHASE1_TEST_MANIFEST.json](file:///c:/Users/TSC-AKA/Videos/MARKETING/BOTAI/system_wa/docs/baselines/PHASE1_TEST_MANIFEST.json).

---

## 1.1. DUAL TAG BASELINE TRACEABILITY & TEST ALIGNMENT

Untuk memastikan integritas historis tanpa mencampuradukkan baseline:

1. **Tag `phase1-freeze` (`353559c`)**:
   - Berfungsi sebagai **Historical Immutable Code Anchor**.
   - Menandai titik akhir resmi Phase 1 beserta perbaikan dokumentasi UQ-12 dan UQ-21.
2. **Tag `phase1-regression-baseline` (`40843bc`)**:
   - Berfungsi sebagai **Current Corrected Regression Contract**.
   - Memuat penyesuaian assertion pada `tests/semanticRagRealUserPhrasing.test.js` (line 161):
     ```diff
     - expect(result.source).toBe('semantic-rag-fee-general');
     + expect(result.source).toMatch(/semantic-rag-fee-general|semantic-rag-fee-discount/i);
     ```
   - **Kepastian Kode**: Kode engine Phase 1 pada `src/engine/` **tidak mengalami perubahan sama sekali** (0 diff vs `phase1-freeze`).
   - **Justifikasi Teknis**: Test lama (September 2026) terlalu ketat mengharuskan label `'semantic-rag-fee-general'` pada kueri `"potongan gelombang 2 berapa?"`. Padahal perbaikan engine di commit `11753b7` (sebelum freeze) telah mengarahkan kueri gelombang ke handler spesialis `semantic-rag-fee-discount` dengan data potongan Gelombang 2B yang faktual dan grounded.
   - Penyesuaian test ini dilakukan agar contract selaras dengan *intended behavior* sistem produksi tanpa merusak invariant apapun.

---

## 2. DAFTAR 25 UNSEEN QUERIES BASELINE

Daftar 25 pertanyaan unseen queries yang digunakan untuk mengukur daya generalisasi bot terhadap variasi ungkapan alami pengguna baru:

| ID | Query Asli Pengguna | Domain Target | Entitas Target | Kriteria Verifikasi Faktual (Assertion) |
| :--- | :--- | :--- | :--- | :--- |
| **UQ-01** | `Berapa spp TI?` | `TUITION_FEE` | S1 Teknologi Informasi | Memuat `6.500.000` & `Teknologi Informasi` |
| **UQ-02** | `TI per semester bayar berapa?` | `TUITION_FEE` | S1 Teknologi Informasi | Memuat `6.500.000` & `Teknologi Informasi` |
| **UQ-03** | `Kalau kuliah Teknologi Informasi biayanya berapa?` | `TUITION_FEE` | S1 Teknologi Informasi | Memuat rincian `DPP` (`14.000.000`) & Biaya Semester |
| **UQ-04** | `Uang kuliah TI berapa?` | `TUITION_FEE` | S1 Teknologi Informasi | Memuat `6.500.000` |
| **UQ-05** | `Sistem Informasi itu kuliah tentang apa?` | `ACADEMIC_PROGRAM` | S1 Sistem Informasi | Memuat penjelasan bisnis, enterprise, atau data |
| **UQ-06** | `Kalau ambil Sistem Informasi belajar apa?` | `ACADEMIC_PROGRAM` | S1 Sistem Informasi | Memuat kompetensi kurikulum (database, analisis sistem) |
| **UQ-07** | `Fokus jurusan Sistem Informasi apa?` | `ACADEMIC_PROGRAM` | S1 Sistem Informasi | Menjelaskan fokus keilmuan SI |
| **UQ-08** | `Lulusan Sistem Informasi biasanya kerja sebagai apa?` | `CAREER` | S1 Sistem Informasi | Menyebutkan profil lulusan (Business Analyst, IT Consultant, dll) |
| **UQ-09** | `TI belajar mata kuliah apa?` | `ACADEMIC_CURRICULUM` | S1 Teknologi Informasi | Menjelaskan sebaran mata kuliah TI per semester |
| **UQ-10** | `Mata kuliah Sistem Informasi semester 3 apa saja?` | `ACADEMIC_CURRICULUM` | S1 Sistem Informasi | Menyebutkan kurikulum Semester III SI |
| **UQ-11** | `Kalau ambil Sistem Komputer semester 5 belajar apa?` | `ACADEMIC_CURRICULUM` | S1 Sistem Komputer | Menyebutkan kurikulum Semester V SK |
| **UQ-12** | `Kalau mau daftar STIKOM Bali mulai dari mana?` | `PMB` | General PMB | Mengarahkan ke alur pendaftaran portal resmi `pmb.stikom-bali.ac.id` |
| **UQ-13** | `Dokumen pendaftaran mahasiswa baru apa saja?` | `PMB` | Dokumen Persyaratan | Menyebutkan ijazah/SKL, KTP, KK, pasfoto |
| **UQ-14** | `Proses masuk STIKOM Bali bagaimana?` | `PMB` | Prosedur PMB | Menjelaskan alur pendaftaran, tes/berkas, dan registrasi |
| **UQ-15** | `Jurusan sarjana apa saja?` | `ACADEMIC_PROGRAM` | Program Sarjana (S1) | Merinci 4 prodi S1: SI, TI, SK, Bisnis Digital |
| **UQ-16** | `Pilihan prodi S1 yang tersedia apa?` | `ACADEMIC_PROGRAM` | Program Sarjana (S1) | Menyebutkan daftar prodi sarjana |
| **UQ-17** | `Ada bantuan KIP Kuliah di kampus ini?` | `SCHOLARSHIP` | Beasiswa KIP Kuliah | Mengonfirmasi ketersediaan KIP Kuliah & syarat Kemendikbud |
| **UQ-18** | `Berapa potongan DPP kalau daftar gelombang awal?` | `SCHOLARSHIP / FEE` | Potongan DPP PMB | Menyebutkan nominal pasti: Gelombang Khusus Rp3jt, Gel I Rp2jt |
| **UQ-19** | `Fasilitas praktikum komputernya ada apa aja?` | `FACILITIES` | Fasilitas Kampus | Menjelaskan laboratorium komputer dan perangkat praktikum |
| **UQ-20** | `UKM untuk yang suka gaming ada?` | `ORGANIZATION_UKM` | UKM Kampus | Mengidentifikasi UKM e-sports (Athena E-Sports) |
| **UQ-21** | `Bisa kuliah sambil kerja nggak?` | `ACADEMIC_PROGRAM` | Skema Kuliah | **PARTIALLY_SUPPORTED**: Menjelaskan program kuliah sambil kerja di luar negeri & Career Center, transparan menyatakan ketiadaan data jadwal kelas karyawan/malam domestik |
| **UQ-22** | `Biaya pendaftaran awal bayar berapa?` | `TUITION_FEE` | Pendaftaran PMB | Menyebutkan nominal biaya pendaftaran Rp500.000 |
| **UQ-23** | `Perbedaan prodi SI sama TI apa?` | `ACADEMIC_PROGRAM` | Perbandingan SI vs TI | Membedakan fokus bisnis/proses (SI) vs infrastruktur/teknis (TI) |
| **UQ-24** | `Ada program double degree luar negeri?` | `INTERNATIONAL` | Program Dual Degree | Menjelaskan kemitraan HELP (Malaysia) & DNUI (China) |
| **UQ-25** | `Gelar lulusan Sistem Informasi apa?` | `ACADEMIC_PROGRAM` | S1 Sistem Informasi | Menyebutkan gelar resmi `S.Kom` (Sarjana Komputer) |

---

## 3. HISTORICAL REGRESSION SET

Kumpulan uji regresi historis yang wajib selalu lulus (non-negotiable):
1. **Regresi Dokumen & Pencegahan Kebocoran Raw Chunk**:
   - `tests/documentLeakRegression.test.js`: Memastikan nama chunk internal, label database, atau sintaks markdown mentah tidak bocor ke WhatsApp.
   - `tests/semanticRawLeakComplaint.test.js`: Memastikan keluhan pengguna terhadap kebocoran ditangani secara elegan.
2. **Regresi Skema Biaya & Parsiran Penomoran**:
   - `tests/parse_fee_numbering.test.js`: Memastikan nomor urut (contoh `1.`, `2.`) tidak terpeleset menjadi nominal rupiah.
   - `tests/registrationDiscount.cases.test.js` & `tests/registrationDiscount.regression.test.js`: Memastikan seluruh nominal diskon per gelombang tidak tereduksi menjadi persentase semu.
3. **Regresi Definisi Singkat & Small Talk Guard**:
   - `tests/semanticRagShortDefinitionRegression.test.js`: Jawaban akronim kampus (misal ITB STIKOM Bali) padat dan tidak melantur.
   - `tests/semanticSmallTalkGuard.test.js`: Ucapan terima kasih, salam, dan sapaan ringan tidak memicu pencarian dokumen yang berat.

---

## 4. MULTI-TURN REGRESSION SET

10 Skenario Percakapan Bersambung (Multi-Turn) dalam `tests/providerMultiTurnIntegration.test.js`:
1. **Scenario 1 (Career Switch)**: `Prospek kerja SI?` $\rightarrow$ `kalau TI?`  
   *Mewarisi intent prospek karier dengan mengganti entitas ke TI.*
2. **Scenario 2 (Recommendation Binding)**: `Rekomendasi prodi bisnis?` $\rightarrow$ `kenapa SI jadi alternatif?`  
   *Mempertahankan konteks prodi alternatif tanpa melupakan prodi utama.*
3. **Scenario 3 (Context Repair)**: `Biaya SI` $\rightarrow$ `maksud saya akreditasinya`  
   *Memperbaiki slot intent dari biaya ke akreditasi dengan mempertahankan entitas SI.*
4. **Scenario 4 (Fee Switch)**: `Berapa biaya kuliah TI?` $\rightarrow$ `kalau SI?`  
   *Mempertahankan domain biaya dan mengubah target prodi ke SI.*
5. **Scenario 5 (Scholarship Subtype)**: `Ada beasiswa apa saja?` $\rightarrow$ `syarat KIP Kuliah?`  
   *Mengarahkan dari ikhtisar umum beasiswa ke detail spesifik KIP Kuliah.*
6. **Scenario 6 (Schedule Wave Selection)**: `Jadwal pendaftaran kapan?` $\rightarrow$ `gelombang 2b tanggal berapa?`  
   *Mengarahkan dari kalender umum ke rentang tanggal gelombang yang dipilih.*
7. **Scenario 7 (UKM Category Follow-up)**: `Ada organisasi kemahasiswaan apa saja?` $\rightarrow$ `yang bidang seni?`  
   *Memfilter UKM berdasarkan kategori seni (Tari, Musik, dll).*
8. **Scenario 8 (Facility Inquiry Follow-up)**: `Fasilitas kampus apa saja?` $\rightarrow$ `lab komputernya seperti apa?`  
   *Memperdalam rincian laboratorium komputer kampus.*
9. **Scenario 9 (Explicit Domain Switch)**: `Biaya kuliah TI berapa?` $\rightarrow$ `alamat kampusnya di mana?`  
   *Membatalkan slot biaya dan beralih penuh ke domain informasi lokasi/kontak.*
10. **Scenario 10 (Stale Context Expiry)**: Jeda waktu $>30$ menit tidak membocorkan entitas percakapan lama ke giliran baru.

---

## 5. SOURCE CONSISTENCY & PROVENANCE REGRESSION

Aturan ketat pembuktian fakta (*Ground Truth & Provenance*):
1. **Biaya S1 TI Semester Rp6.500.000**: Biaya resmi per semester berdasarkan Lampiran-1 SK No. `629/ITBSTIKOM/WDS/X/25` (T.A. 2026/2027).
2. **SPP Rp1.600.000/bulan**: Simulasi angsuran informal (Rp6.5jt ÷ 4 bulan) atau skema cicilan termin. SK resmi tidak memungut SPP bulanan murni.
3. **Total Masuk Awal Paket A Rp13.900.000**: Paket gabungan pendaftaran + perlengkapan + semester 1 + cicilan 1 DPP.
4. **Potongan Gelombang Awal**: Gelombang Khusus Rp3.000.000, Gelombang I Rp2.000.000 (Reguler). Persentase 50%-60% mutlak hanya untuk alumni SMK TI Bali Global & SMK Pandawa.
5. **Otoritas Kurikulum vs TA**: Syarat Tugas Akhir/Skripsi tunduk pada Pedoman TA Revisi 1 (110-120 SKS lulus); distribusi mata kuliah tunduk pada Kurikulum 2025.
6. **Program Internasional**: HELP University (Malaysia) & DNUI (China). Mahasiswa HELP menjalani 4 tahun perkuliahan di ITB STIKOM Bali untuk memperoleh gelar S.Kom dan BIT.
7. **Portal Resmi PMB**: Otoritas rujukan resmi alur dan pendaftaran mahasiswa baru adalah `pmb.stikom-bali.ac.id` (bukan domain portal legacy internal seperti `siap.stikom-bali.ac.id`).
8. **Skema Kuliah Sambil Kerja (Partially Supported)**: Hanya terbukti untuk program kerja/magang luar negeri (Hi-Think Jepang) serta fasilitasi Career Center. Tidak ada bukti resmi yang memadai mengenai jadwal kelas malam/karyawan reguler domestik; bot wajib transparan menyatakan keterbatasan data.

---

## 6. FINAL-ANSWER QUALITY REGRESSION STANDARDS

Standar evaluasi kualitas jawaban sebelum disajikan ke pengguna:
- **No Hallucination**: Tidak menyajikan nominal, tanggal, atau nama prodi di luar bukti dokumen resmi.
- **Explicit Disclaimers**: Jika data belum tercantum di dokumen resmi (misal nama jurusan mitra di DNUI), bot wajib menyatakan bahwa data tersebut belum tercantum dan mengarahkan ke admin, bukan menebak.
- **No Synthetic Placeholders**: Dilarang menggunakan teks template dummy atau persentase generik seperti "hingga 50%".
- **Clean Formatting**: Output teks WhatsApp rapi, tanpa markdown leak, dan bahasa Indonesia komunikatif.

---

## 7. PROTOKOL UAT PHASE 2 PRODUCTION

Setelah Phase 2 diimplementasikan dan di-deploy ke production, evaluasi wajib dijalankan menggunakan format catatan berikut untuk setiap giliran percakapan real-user:

```text
================================================================
UAT RECORD ENTRY
================================================================
QUERY         : [Teks pertanyaan asli pengguna - Jangan diubah wording-nya]
CONTEXT       : [Konteks sesi / giliran percakapan multi-turn]
EXPECTED      : [Jawaban yang diharapkan berdasarkan dokumen resmi]
ACTUAL        : [Jawaban aktual yang dihasilkan oleh sistem]
RESULT        : [PASS / PARTIAL / FAIL]
ROOT CAUSE    : [Jika PARTIAL/FAIL, jelaskan akar penyebabnya]
EVIDENCE      : [Kutipan dokumen bukti resmi yang dijadikan rujukan]
ANSWER QUALITY: [Evaluasi keterbacaan, grounding, dan kesesuaian gaya bahasa]
================================================================
```
