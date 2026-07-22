/**
 * Test suite for humanizer module
 * Tests the presentation/humanization layer improvements
 */

const {
  buildHumanizedIntentConfirmation,
  generateFollowUpQuestions,
  formatHumanizedResponse,
  applyVirtualAssistantPersona,
  extractProgramName,
  cleanMainAnswer
} = require('../src/engine/humanizer');

describe('Humanizer Module', () => {
  describe('buildHumanizedIntentConfirmation', () => {
    it('should build natural program studi confirmation', () => {
      const result = buildHumanizedIntentConfirmation('program_studi', 'Apa itu SI?', {
        program: 'Sistem Informasi'
      });
      
      expect(result).toBeTruthy();
      expect(result).toContain('Sistem Informasi');
      expect(result).not.toContain('Topik:');
    });

    it('should build fee confirmation with context', () => {
      const result = buildHumanizedIntentConfirmation('biaya', 'Berapa biaya SI?', {
        program: 'Sistem Informasi',
        feeChoice: 'semester'
      });
      
      expect(result).toBeTruthy();
      expect(result).toContain('biaya per semester');
      expect(result).not.toContain('Kesimpulan:');
    });

    it('should build scholarship confirmation', () => {
      const result = buildHumanizedIntentConfirmation('beasiswa', 'Ada beasiswa prestasi?');
      
      expect(result).toBeTruthy();
      expect(result).toContain('beasiswa');
    });

    it('should build KIP-specific scholarship confirmation', () => {
      const result = buildHumanizedIntentConfirmation('beasiswa', 'Ada beasiswa KIP?');
      expect(result).toContain('beasiswa KIP');
    });

    it('should build 1K1S-specific scholarship confirmation', () => {
      const result = buildHumanizedIntentConfirmation('beasiswa', 'Apa syarat beasiswa 1K1S?');
      expect(result).toContain('beasiswa KIP');
    });

    it('should provide general confirmation fallback', () => {
      const result = buildHumanizedIntentConfirmation('general', 'Random question');
      
      expect(result).toBeTruthy();
      expect(result.length > 0).toBe(true);
    });
  });

  describe('generateFollowUpQuestions', () => {
    it('should generate 3 follow-up questions for program_studi intent', () => {
      const questions = generateFollowUpQuestions('program_studi', {
        program: 'Sistem Informasi'
      });
      
      expect(Array.isArray(questions)).toBe(true);
      expect(questions.length).toBeLessThanOrEqual(3);
      expect(questions.length).toBeGreaterThan(0);
      questions.forEach(q => {
        expect(typeof q).toBe('string');
        expect(q.length > 0).toBe(true);
      });
    });

    it('should generate questions for biaya intent', () => {
      const questions = generateFollowUpQuestions('biaya');
      
      expect(questions.length).toBeLessThanOrEqual(3);
      expect(questions.some(q => /biaya|beasiswa|cicilan/i.test(q))).toBe(true);
    });

    it('should generate questions for beasiswa intent', () => {
      const questions = generateFollowUpQuestions('beasiswa');
      
      expect(questions.length).toBeLessThanOrEqual(3);
      expect(questions.some(q => /beasiswa|syarat/i.test(q))).toBe(true);
    });

    it('should not have duplicate questions', () => {
      const questions = generateFollowUpQuestions('prospek_kerja', {});
      const unique = new Set(questions);
      
      expect(unique.size).toBe(questions.length);
    });
  });

  describe('formatHumanizedResponse', () => {
    it('should format response without system labels', () => {
      const mainAnswer = `Topik: Program Studi
      Sistem Informasi adalah program yang mempelajari...
      Informasi Terkait: Prospek kerja
      Kesimpulan: Siswa akan menjadi developer`;
      
      const result = formatHumanizedResponse(mainAnswer, 'Apa itu SI?', {
        intent: 'program_studi'
      });
      
      expect(result).toBeTruthy();
      expect(result).not.toContain('Topik:');
      expect(result).not.toContain('Kesimpulan:');
      expect(result).not.toContain('Informasi Terkait:');
    });

    it('should include intent confirmation and follow-ups', () => {
      const mainAnswer = 'Sistem Informasi adalah jurusan yang mempelajari IT dan programming.';
      
      const result = formatHumanizedResponse(mainAnswer, 'Apa itu SI?', {
        intent: 'program_studi',
        program: 'Sistem Informasi'
      });
      
      expect(result).toContain(mainAnswer);
      expect(result).toContain(mainAnswer);
      expect(result).not.toContain('•');
    });
  });

    it('should separate verification, answer, and summary paragraphs', () => {
      const mainAnswer = [
        'Saya pahami kakak ingin tahu apa itu Sistem Informasi. Berikut gambaran sederhananya.',
        'Sistem Informasi adalah program studi yang berfokus pada cara merancang solusi digital yang menghubungkan kebutuhan bisnis, proses organisasi, dan teknologi informasi.',
        'Singkatnya, prodi ini cocok untuk kakak yang tertarik pada analisis kebutuhan, proses bisnis, data, dan solusi sistem informasi.'
      ].join('\n');

      const result = formatHumanizedResponse(mainAnswer, 'apa itu si?', {
        intent: 'program_definition',
        program: 'Sistem Informasi'
      });

      expect(result).toMatch(/Berikut gambaran sederhananya\.\n\nSistem Informasi adalah/i);
      expect(result).toMatch(/teknologi informasi\.\n\nSingkatnya,/i);
    });
    it('should preserve official BD and MI definition paragraphs and SK program label', () => {
      const bd = formatHumanizedResponse([
        'Saya pahami kakak ingin tahu apa itu Bisnis Digital. Berikut gambaran sederhananya.',
        'Bisnis Digital adalah program studi yang memadukan strategi bisnis, pemasaran digital, analitik data, dan pemanfaatan teknologi untuk pertumbuhan usaha.',
        'Singkatnya, prodi ini cocok untuk kakak yang tertarik pada bisnis digital.'
      ].join('\n'), 'apa itu bd?', { intent: 'program_definition', program: 'Bisnis Digital' });

      expect(bd).toMatch(/Bisnis Digital adalah program studi yang memadukan strategi bisnis/i);

      const mi = formatHumanizedResponse([
        'Baik, Kak. Saya jelaskan Manajemen Informatika dari fokus belajar dan kecocokan minatnya.',
        'Manajemen Informatika adalah program D3 yang berfokus pada penerapan teknologi informasi untuk kebutuhan operasional.',
        'Singkatnya, prodi ini cocok untuk kakak yang tertarik pada pemrograman terapan.'
      ].join('\n'), 'apa itu mi?', { intent: 'program_definition', program: 'Manajemen Informatika' });

      expect(mi).toMatch(/Manajemen Informatika adalah program D3/i);

      const sk = formatHumanizedResponse([
        'Sistem Komputer adalah program studi yang berfokus pada integrasi perangkat keras dan perangkat lunak.',
        'Singkatnya, prodi ini cocok untuk kakak yang tertarik pada hardware.'
      ].join('\n'), 'apa itu sk?', { intent: 'program_definition', program: 'Sistem Komputer' });

      expect(sk).toMatch(/Program Studi Sistem Komputer/i);
      expect(sk.split('\n')[0]).not.toMatch(/Program Studi yang berfokus/i);
      expect(sk).not.toMatch(/mata kuliah inti di yang berfokus/i);
    });
    it('should clean duplicated presentation boilerplate for campus support answers', () => {
      process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'true';
      const mainAnswer = [
        'Saya jawab bagian yang relevan dengan pertanyaan kakak ya.',
        'Saya jawab dari bagian informasi yang paling langsung membahas program tersebut.',
        'GCCP adalah salah satu program/fasilitas pendukung di ITB STIKOM Bali.',
        '',
        '- GCCP: Global Cross Cultural Program (GCCP) adalah program lintas budaya.',
        '',
        'Untuk detail teknis seperti jadwal, syarat peserta, atau alur pendaftaran program, kakak bisa konfirmasi ke admin kampus Kalau belum tercantum.',
        'Jadi, penjelasan detailnya mengikuti informasi yang tersedia. Kalau ada hal teknis seperti jadwal, syarat, atau alur pendaftaran yang belum tercantum, sebaiknya dikonfirmasi ke admin kampus.'
      ].join('\n');

      const result = formatHumanizedResponse(mainAnswer, 'kalau program GCCP itu apa ya?', { intent: 'campus_support' });
      expect(result).toContain('Saya bantu jawab tentang program GCCP');
      expect(result).toContain('GCCP adalah salah satu program/fasilitas pendukung');
      expect(result).not.toMatch(/Saya jawab bagian yang relevan|Saya jawab dari bagian informasi/i);
      expect(result).not.toMatch(/Jadi, penjelasan detailnya mengikuti informasi/i);
      expect(result).toMatch(/admin kampus jika belum tercantum/i);
    });

    it('should not add awkward mini summary or follow-ups to long career answers', () => {
      process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'true';
      const mainAnswer = [
        'Untuk karier lulusan, ini gambaran yang paling relevan, Kak. Saya fokuskan ke gambaran bidang kerja setelah lulus.',
        '',
        'Prospek kerja lulusan Sistem Komputer:',
        'Prospek kerja mencakup embedded system engineer, IoT engineer, network administrator, system integrator, hardware support engineer, automation technician, dan infrastruktur engineer. Posisi ini dibutuhkan pada manufaktur, telekomunikasi, smart city, energi, serta perusahaan yang mengadopsi otomasi.',
        'Secara umum, Sistem Komputer cocok untuk kakak yang ingin membangun karier di bidang integrasi hardware-software, IoT, otomasi, jaringan, dan infrastruktur.',
        'Jadi, prospek kerja paling tepat dilihat dari fokus skill dan bidang industri prodi tersebut.'
      ].join('\n');

      const result = formatHumanizedResponse(mainAnswer, 'Bagaimana prospek kerja lulusan Sistem Komputer?', { intent: 'prospek_kerja', program: 'Sistem Komputer' });
      expect(result).toContain('Prospek kerja lulusan Sistem Komputer');
      expect(result).not.toMatch(/Singkatnya, Saya fokuskan/i);
      expect(result).not.toMatch(/Jadi, prospek kerja paling tepat/i);
      expect(result).not.toMatch(/Kalau Kakak ingin tahu lebih lanjut/i);
    });

    it('should not append generic follow-ups to accreditation answers', () => {
      process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'true';
      const mainAnswer = [
        'Akreditasi Prodi Sistem Informasi (S1):',
        '- Peringkat: Baik Sekali',
        '- Masa berlaku: 14 Desember 2023 sampai 14 Desember 2028',
        '- Lembaga akreditasi: LAM INFOKOM'
      ].join('\n');

      const result = formatHumanizedResponse(mainAnswer, 'akreditasi si apa?', { intent: 'akreditasi' });
      expect(result).toContain('Akreditasi Prodi Sistem Informasi');
      expect(result).not.toMatch(/Kalau Kakak ingin tahu lebih lanjut/i);
      expect(result).not.toMatch(/Apakah ada informasi lain|Mau saya jelaskan tentang aspek lain|Adakah pertanyaan lain/i);
    });
    it('should not append follow-ups to long comparison answers', () => {
      process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'true';
      const mainAnswer = [
        'Kalau dibandingkan, perbedaan Sistem Komputer paling terlihat dari fokus belajarnya. Saya bandingkan dari fokus belajar, skill yang dibangun, dan arah kariernya.',
        'Program S1 Sistem Informasi, Sistem Komputer, Teknologi Informasi, Bisnis Digital memiliki fokus yang berbeda.',
        '',
        '1) Sistem Informasi (SI)',
        'SI fokus pada perancangan dan pengelolaan sistem informasi, analisis kebutuhan bisnis, basis data, proses organisasi, dashboard, dan solusi digital.',
        '',
        '2) Sistem Komputer (SK)',
        'SK fokus pada hardware, embedded system, Internet of Things (IoT), jaringan, mikrokontroler, robotika, dan integrasi perangkat.',
        '',
        '3) Teknologi Informasi (TI)',
        'TI fokus pada software, pemrograman, pengembangan aplikasi, infrastruktur IT, cloud, keamanan siber, jaringan, dan pengolahan data.'
      ].join('\n');

      const result = formatHumanizedResponse(mainAnswer, 'Apa perbedaan Sistem Komputer dengan prodi serupa?', { intent: 'perbandingan_prodi', program: 'Sistem Komputer' });
      expect(result).toContain('1) Sistem Informasi');
      expect(result).not.toMatch(/Singkatnya, Saya bandingkan/i);
      expect(result).not.toMatch(/Kalau Kakak ingin tahu lebih lanjut/i);
    });
  describe('applyVirtualAssistantPersona', () => {
    it('should improve persona with natural phrases', () => {
      const input = 'Baik kak, ini informasi tentang program studi.';
      const result = applyVirtualAssistantPersona(input);
      
      expect(result).toBeTruthy();
      expect(result).toContain('Baik Kak');
    });

    it('should remove standalone kak greetings and normalize address', () => {
      const input = `Baik kak,
      Informasi untuk Anda mengenai...`;
      
      const result = applyVirtualAssistantPersona(input);
      
      expect(result).not.toContain('Anda');
      expect(result).toContain('Kakak');
    });

    it('should soften language', () => {
      const input = 'Mohon perhatian Anda. Jika ada pertanyaan...';
      const result = applyVirtualAssistantPersona(input);
      
      expect(result).not.toContain('Mohon');
      expect(result).not.toContain('Jika');
    });
  });

  describe('cleanMainAnswer', () => {
    it('should remove system labels', () => {
      const input = `Topik: Program Studi
      Berikut penjelasannya...
      Informasi Terkait: Prospek
      Kesimpulan: Ringkasnya...`;
      
      const result = cleanMainAnswer(input);
      
      expect(result).not.toContain('Topik:');
      expect(result).not.toContain('Informasi Terkait:');
      expect(result).not.toContain('Kesimpulan:');
    });
  });

  describe('extractProgramName', () => {
    it('should extract program names from queries', () => {
      expect(extractProgramName('Apa itu SI?')).toBe('Sistem Informasi');
      expect(extractProgramName('Biaya TI berapa?')).toBe('Teknologi Informasi');
      expect(extractProgramName('Program BD bagus ga?')).toBe('Bisnis Digital');
      expect(extractProgramName('Info SK?')).toBe('Sistem Komputer');
    });

    it('should return null for unknown programs', () => {
      expect(extractProgramName('Random text')).toBeNull();
    });
  });

  describe('Integration: Full humanization flow', () => {
    it('should transform old-style response to humanized format', () => {
      const oldStyleResponse = `Baik kak,

Topik: Biaya Sistem Informasi

Biaya Sistem Informasi dibagi menjadi beberapa komponen:

1. DPP (Dana Pendidikan Pokok): Rp 25.000.000
2. Biaya per Semester: Rp 3.000.000 - Rp 5.000.000

Informasi Terkait:
- Cek beasiswa yang tersedia
- Simulasi cicilan bulanan
- Syarat dan proses pendaftaran

Kesimpulan: Jadi estimasi biaya awal masuknya sekitar Rp 25 juta.`;

      const result = formatHumanizedResponse(
        oldStyleResponse,
        'Berapa biaya SI?',
        { 
          intent: 'biaya',
          program: 'Sistem Informasi'
        }
      );

      expect(result).toBeTruthy();
      expect(result).not.toContain('Topik:');
      expect(result).not.toContain('Kesimpulan:');
      expect(result).not.toContain('Informasi Terkait:');
      expect(result).toContain('Rp');
      expect(result).not.toContain('•');
    });

    it('should fall back honestly when no relevant data is available', () => {
      const result = formatHumanizedResponse('', 'Ada info beasiswa KIP?', { intent: 'beasiswa' });
      expect(result).toContain('Maaf Kak, saat ini saya belum menemukan detail beasiswa tersebut pada basis pengetahuan saya');
      expect(result).toContain('Admin PMB');
    });

    it('should filter non-STIKOM program recommendations from program-related answers', () => {
      const rawAnswer = `Teknik Informatika juga sering direkomendasikan untuk data analyst.
Sistem Informasi di STIKOM Bali lebih cocok untuk kebutuhan data dan bisnis.`;
      const result = formatHumanizedResponse(rawAnswer, 'Mau jadi Data Analyst cocok jurusan apa?', { intent: 'program_studi' });
      expect(result).not.toContain('Teknik Informatika');
      expect(result).toContain('Sistem Informasi');
    });
  });
});
