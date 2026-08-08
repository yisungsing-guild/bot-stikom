const { queryScoped } = require('../src/engine/ragScoped');
const { selectEvidenceFromContexts } = require('../src/engine/evidenceSelector');

const QUERIES = [
  'apa saja syarat pendaftaran',
  'biaya kuliah d3 tahun ajaran 2026 2027',
  'rincian biaya pendaftaran sistem informasi',
  'syarat beasiswa kip kampus',
  'informasi akreditasi stikom bali',
  'biaya awal masuk kampus',
  'jadwal pendaftaran gelombang i',
  'dokumen pendaftaran mahasiswa baru',
  'program studi sistem informasi',
  'double degree help university',
  'peraturan akademik stikom bali',
  'ketentuan UKT per semester',
  'siapa yang berhak mendapatkan kip',
  'skema pembayaran biaya kuliah',
  'uang pangkal sistem informasi',
  'biaya registrasi tiap gelombang',
  'kriteria beasiswa kip',
  'jadwal pembayaran uang kuliah',
  'potongan biaya pendaftaran',
  'persyaratan visa pelajar mahasiswa asing'
];

(async () => {
  for (const query of QUERIES) {
    const res = await queryScoped({ query, category: null, topK: 10, options: { returnDebug: true } });
    const contexts = Array.isArray(res.contexts) ? res.contexts : [];
    const selected = selectEvidenceFromContexts({ question: query, contexts, intent: '', maxEvidence: 8 });
    const longSelected = selected.filter((item) => String(item.text || '').length > 400);
    if (longSelected.length > 0) {
      console.log('QUERY:', query);
      console.log(' retrievalPath:', res.debug && res.debug.retrievalPath);
      console.log(' contexts:', contexts.length, 'selected:', selected.length, 'longSelected:', longSelected.length);
      longSelected.forEach((item, idx) => {
        console.log(`  [${idx+1}] len=${String(item.text || '').length} source=${item.source || item.sourceId || item.id}`);
        console.log('    preview:', String(item.text || '').slice(0, 220).replace(/\n/g, ' '));
      });
      console.log('---');
    }
  }
})();
