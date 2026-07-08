/**
 * Runtime Verification Script
 * Shows BEFORE → AFTER → FINAL for each query
 */

const {
  buildHumanizedIntentConfirmation,
  generateFollowUpQuestions,
  formatHumanizedResponse,
  applyVirtualAssistantPersona,
  cleanMainAnswer
} = require('./src/engine/humanizer');

const { detectIntentFromAnswer } = require('./src/utils/whatsappFormatter');

// Mock RAG responses
const mockResponses = {
  tiQuery: {
    question: 'Apa itu Teknologi Informasi?',
    ragAnswer: `Teknologi Informasi (TI) adalah program studi yang mempelajari pengembangan dan pengelolaan sistem teknologi informasi. Program ini fokus pada infrastruktur IT, networking, cybersecurity, dan enterprise solutions.

Kurikulum TI meliputi:
- Sistem Operasi dan Networking
- Database Management
- Cybersecurity dan IT Infrastructure
- Cloud Computing
- IT Project Management

Lulusan TI siap bekerja sebagai IT System Administrator, Network Engineer, atau Infrastructure Specialist di perusahaan-perusahaan teknologi, perbankan, dan industri.`,
    intent: 'program_studi',
    program: 'Teknologi Informasi'
  },
  
  allProdiQuery: {
    question: 'Prodi apa saja yang ada di STIKOM Bali?',
    ragAnswer: `ITB STIKOM Bali menyediakan beberapa program studi:

S1 Program:
- Sistem Informasi (SI)
- Teknologi Informasi (TI)
- Bisnis Digital (BD)
- Sistem Komputer (SK)

S2 Program:
- S2 Sistem Informasi

D3 Program:
- D3 Manajemen Informatika

Setiap program dirancang untuk memenuhi kebutuhan industri teknologi dan digital yang terus berkembang.`,
    intent: 'program_studi',
    program: null
  },

  scholarshipQuery: {
    question: 'Apakah ada beasiswa?',
    ragAnswer: `ITB STIKOM Bali menyediakan berbagai jenis beasiswa untuk mendukung pendidikan mahasiswa:

Beasiswa Prestasi:
- Untuk mahasiswa dengan prestasi akademik dan non-akademik
- Potongan 20-50% dari biaya kuliah
- Persyaratan: IPK minimal 3.0 dan bukti prestasi

Beasiswa Kurang Mampu (Ekonomi):
- Program bantuan untuk mahasiswa dari keluarga kurang mampu
- Potongan hingga 100% dari biaya kuliah
- Persyaratan: Surat keterangan dari pemerintah setempat

Beasiswa Kemitraan:
- Kerjasama dengan perusahaan dan organisasi tertentu
- Persyaratan: Sesuai dengan mitra yang bersangkutan

Untuk mendaftar beasiswa, hubungi bagian akademik atau kunjungi website resmi.`,
    intent: 'beasiswa',
    program: null
  },

  doubleQuery: {
    question: 'Apakah ada program double degree internasional?',
    ragAnswer: `ITB STIKOM Bali memiliki program internasional yang memberikan kesempatan belajar di luar negeri.

Program International Class:
- Kerjasama dengan universitas di Asia Tenggara dan Eropa
- Kesempatan exchange semester 5 di universitas mitra
- Tuition fee untuk semester di luar negeri ditanggung oleh universitas mitra

Double Degree Program:
- Tersedia untuk program S1 Sistem Informasi dan S1 Teknologi Informasi
- Kerjasama dengan universitas di Malaysia, Thailand, dan Vietnam
- Mahasiswa mendapatkan 2 gelar: sarjana dari ITB STIKOM Bali dan universitas mitra
- Durasi: 3 tahun di ITB STIKOM Bali + 2 tahun di universitas mitra
- Biaya: Sesuai dengan biaya di universitas mitra

Persyaratan:
- IPK minimal 3.5
- TOEFL/IELTS score tertentu
- Rekomendasi dari dosen`,
    intent: 'program_studi',
    program: 'Teknologi Informasi'
  }
};

// Main verification function
function runVerification() {
  console.log('\n' + '='.repeat(100));
  console.log('RUNTIME VERIFICATION - HUMANIZER MODULE');
  console.log('='.repeat(100));

  Object.entries(mockResponses).forEach(([key, testCase], idx) => {
    console.log(`\n\n${'#'.repeat(100)}`);
    console.log(`TEST ${idx + 1}: ${testCase.question}`);
    console.log(`${'#'.repeat(100)}`);

    // Stage 1: RAG Output (BEFORE_DECORATE)
    const ragAnswer = testCase.ragAnswer;
    console.log('\n--- STAGE 1: FULL_BEFORE_DECORATE ---');
    console.log(ragAnswer);

    // Detect intent
    const detectedIntent = detectIntentFromAnswer(ragAnswer, testCase.question);
    console.log(`\n[DETECTED INTENT: ${detectedIntent}]`);

    // Stage 2: Clean main answer (remove any existing labels)
    const cleanedAnswer = cleanMainAnswer(ragAnswer);
    console.log('\n--- STAGE 2: CLEANED_ANSWER ---');
    console.log(cleanedAnswer);

    // Stage 3: Build humanized response
    const context = {
      intent: detectedIntent,
      program: testCase.program
    };

    const intentConfirmation = buildHumanizedIntentConfirmation(
      detectedIntent,
      testCase.question,
      context
    );

    const followUps = generateFollowUpQuestions(detectedIntent, context);

    console.log('\n--- STAGE 3: COMPONENTS ---');
    console.log('Intent Confirmation:', intentConfirmation);
    console.log('Follow-up Questions:', followUps);

    // Stage 4: Format full response
    const humanizedResponse = formatHumanizedResponse(
      cleanedAnswer,
      testCase.question,
      context
    );

    console.log('\n--- STAGE 4: FULL_AFTER_DECORATE ---');
    console.log(humanizedResponse);

    // Stage 5: Apply persona
    const withPersona = applyVirtualAssistantPersona(humanizedResponse);

    console.log('\n--- STAGE 5: FULL_FINAL_WA_MESSAGE (FINAL OUTPUT) ---');
    console.log(withPersona);

    // Verification
    console.log('\n--- VERIFICATION ---');
    const checks = {
      'No "Topik:" label': !withPersona.includes('Topik:'),
      'No "Informasi Terkait:" label': !withPersona.includes('Informasi Terkait:'),
      'No "Kesimpulan:" label': !withPersona.includes('Kesimpulan:'),
      'Has natural intent confirmation': withPersona.includes('Kakak') || withPersona.includes('kak'),
      'Has follow-up questions': withPersona.includes('•'),
      'Main answer preserved': withPersona.includes(cleanedAnswer.split('\n')[0])
    };

    Object.entries(checks).forEach(([check, passed]) => {
      console.log(`${passed ? '✅' : '❌'} ${check}`);
    });

    console.log('\n--- WHAT USER RECEIVES ON WHATSAPP ---');
    console.log(withPersona);
  });

  console.log('\n\n' + '='.repeat(100));
  console.log('VERIFICATION COMPLETE');
  console.log('='.repeat(100));
}

// Run it
runVerification();
