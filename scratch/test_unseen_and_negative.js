process.env.NODE_ENV = 'production';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'true';
process.env.ENABLE_AI = 'true';
process.env.RAG_MIN_SCORE = '0.0';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';

const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { decomposeSemanticRequests } = require('../src/engine/requestDecomposer');

const NEGATIVE_CONTROLS = [
  'fasilitas lab dan perpustakaan ada apa saja?',
  'Sistem Informasi dan Teknologi Informasi bedanya apa?',
  'biaya DPP dan UKT berapa?',
  'Saya ingin kuliah di kampus STIKOM yang aman dan nyaman',
  'Unit Kegiatan Mahasiswa Seni dan Budaya ada tidak?',
  'apakah ada beasiswa untuk anak berprestasi dan kurang mampu?'
];

const UNSEEN_CASES = [
  // 1. punctuation
  { id: 'UC01', query: 'Ada beasiswa KIP Kuliah? Terus syarat pendaftarannya apa?' },
  // 2. "dan" (cross-domain)
  { id: 'UC02', query: 'Berapa biaya pendaftaran dan akreditasi Sistem Informasi apa?' },
  // 3. "terus"
  { id: 'UC03', query: 'Akreditasi Bisnis Digital apa terus biaya kuliahnya berapa?' },
  // 4. "sekalian"
  { id: 'UC04', query: 'Saya mau tanya biaya pendaftaran sekalian jadwal gelombang 1 kapan?' },
  // 5. "sama"
  { id: 'UC05', query: 'Fasilitas lab komputer ada apa aja sama UKM musik namanya apa?' },
  // 6. two question marks
  { id: 'UC06', query: 'Apakah ada perpustakaan kampus? Berapa biaya pendaftarannya?' },
  // 7. slang
  { id: 'UC07', query: 'info akreditasi TI dong min, trs biayanya brp ya?' },
  // 8. typo
  { id: 'UC08', query: 'akreditasi sistm informasi apa dan biya pndaftaran brp?' },
  // 9. same domain (fee + fee)
  { id: 'UC09', query: 'Berapa biaya pendaftaran dan pembayarannya bisa dicicil tidak?' },
  // 10. cross domain (accreditation + student org)
  { id: 'UC10', query: 'Akreditasi Sistem Komputer apa dan ada UKM paduan suara tidak?' },
  // 11. same entity (career + accreditation)
  { id: 'UC11', query: 'Prospek kerja Teknologi Informasi apa dan akreditasinya apa?' },
  // 12. different entities (TI vs SI)
  { id: 'UC12', query: 'Akreditasi TI apa dan prospek kerja Sistem Informasi apa?' },
  // 13. prior context
  {
    id: 'UC13',
    query: 'Akreditasinya apa dan prospek kerjanya gimana?',
    options: {
      sessionState: {
        activeEntity: { canonical: 'Bisnis Digital', entityType: 'program' },
        activeDomain: 'program',
        verified: true,
        status: 'active',
        updatedAt: Date.now()
      }
    }
  },
  // 14. supported + unsupported (registration fee + non-existent department)
  { id: 'UC14', query: 'Biaya pendaftaran berapa dan apakah ada jurusan teknik kedokteran nuklir?' },
  // 15. two supported numeric facts
  { id: 'UC15', query: 'Biaya pendaftaran berapa dan berapa SKS untuk lulus S1?' },
  // 16. one ambiguous subrequest
  { id: 'UC16', query: 'Akreditasi TI apa dan yang itu gimana ya?' }
];

async function main() {
  console.log('=== 1. TESTING NEGATIVE DECOMPOSITION CONTROLS ===\n');
  let negPass = 0;
  for (const query of NEGATIVE_CONTROLS) {
    const decomp = decomposeSemanticRequests(query);
    const isSingle = !decomp.isCompound || decomp.requests.length === 1;
    console.log(`Query: "${query}" -> isCompound: ${decomp.isCompound}, requests: ${decomp.requests.length} [${isSingle ? 'PASS' : 'FAIL'}]`);
    if (isSingle) negPass++;
  }
  console.log(`Negative Controls Result: ${negPass}/${NEGATIVE_CONTROLS.length} PASS\n`);

  console.log('=== 2. TESTING 16 UNSEEN COMPOUND CASES ===\n');
  let unseenPass = 0;
  for (const uc of UNSEEN_CASES) {
    console.log(`--------------------------------------------------`);
    console.log(`[${uc.id}] Query: "${uc.query}"`);
    try {
      const res = await querySemanticRag(uc.query, uc.options || {});
      const reqCount = res.debug?.multiQuery?.requestCount || 1;
      console.log(`Source: ${res.source}, Success: ${res.success}, Requests: ${reqCount}`);
      if (res.debug?.multiQuery) {
        res.debug.multiQuery.requests.forEach((r, idx) => {
          console.log(`  Sub #${idx + 1}: "${r.text}" -> source: ${r.source}`);
        });
      }
      console.log(`Answer:\n${res.answer?.slice(0, 300)}...\n`);
      if (res.success && reqCount >= 2) unseenPass++;
    } catch (err) {
      console.error(`ERROR on ${uc.id}:`, err);
    }
  }
  console.log(`Unseen Cases Result: ${unseenPass}/${UNSEEN_CASES.length} PASS`);
}

main().catch(console.error);
