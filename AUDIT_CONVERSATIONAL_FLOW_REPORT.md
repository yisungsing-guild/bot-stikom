═══════════════════════════════════════════════════════════════════════════════
                    AUDIT FINAL CONVERSATIONAL FLOW
                          ITB STIKOM Bali Bot
═══════════════════════════════════════════════════════════════════════════════

📊 AUDIT RESULT: ⚠️  NEED FIXES (40% Pass Rate)
─────────────────────────────────────────────────────────────────────────────

SUMMARY:
  Total Tests      : 10
  Passed           : 4 (40%)
  Failed           : 6 (60%)
  

═══════════════════════════════════════════════════════════════════════════════
                        ISSUE #1: TEMPLATE BERULANG
═══════════════════════════════════════════════════════════════════════════════

SEVERITY: HIGH
AFFECTED INPUTS: halo, hai, pagi, siang, malam (5 dari 10 tests)

PROBLEM:
  Semua greeting menggunakan prompt yang SAMA persis untuk follow-up:
  "Kalau kakak mau, silakan tanya apa yang ingin diketahui atau pilih menu."
  
  Ini membuat bot terasa:
  ✗ Robotik (repetitif, template-driven)
  ✗ Tidak natural (prompt yang sama untuk semua waktu)
  ✗ Kurang personal (tidak ada variasi)

CURRENT RESPONSES:
  INPUT   : "halo"
  RESPONSE: "Halo, kak.\n\nKalau kakak mau, silakan tanya apa yang ingin 
            diketahui atau pilih menu."
  
  INPUT   : "pagi"
  RESPONSE: "Selamat pagi, kak.\n\nKalau kakak mau, silakan tanya apa yang 
            ingin diketahui atau pilih menu."
  
  INPUT   : "siang"
  RESPONSE: "Selamat siang, kak.\n\nKalau kakak mau, silakan tanya apa yang 
            ingin diketahui atau pilih menu."
            
  (PROMPT YANG SAMA BERULANG UNTUK SEMUA INPUT)


═══════════════════════════════════════════════════════════════════════════════
                    ISSUE #2: MISSING HANDLER "APA KABAR"
═══════════════════════════════════════════════════════════════════════════════

SEVERITY: MEDIUM
AFFECTED INPUTS: apa kabar (1 dari 10 tests)

PROBLEM:
  Input "apa kabar" tidak ada greeting handler spesifik
  → Masuk ke RAG/Fallback (tidak natural untuk greeting sederhana)
  → Bot seharusnya respond natural ke pertanyaan kesehatan personal
  
CURRENT BEHAVIOR:
  INPUT   : "apa kabar"
  RESPONSE: [RAG/Fallback response - tidak ada greeting handler spesifik]
            (tidak ada response yang diprediksi)


═══════════════════════════════════════════════════════════════════════════════
                           ANALYSIS & FINDINGS
═══════════════════════════════════════════════════════════════════════════════

✅ PASSING (4/10):
  • "makasih"     - Response natural dan acknowledge terima kasih
  • "terima kasih"- Response natural dan acknowledge terima kasih
  • "ok"          - Preserve topic (lightweight greeting)
  • "iya"         - Preserve topic (lightweight greeting)

❌ FAILING (6/10):
  • "halo"        - Template prompt berulang
  • "hai"         - Template prompt berulang
  • "pagi"        - Template prompt berulang
  • "siang"       - Template prompt berulang
  • "malam"       - Template prompt berulang
  • "apa kabar"   - Tidak ada handler, masuk RAG/fallback


═══════════════════════════════════════════════════════════════════════════════
                           SOURCE CODE ANALYSIS
═══════════════════════════════════════════════════════════════════════════════

LOCATION 1: buildGreetingReply() function
FILE: src/routes/provider.js
LINES: 4503-4535

CURRENT CODE (PROBLEMATIC):
  function buildGreetingReply(text) {
    // ... greeting detection ...
    
    let opening;
    if (isIslamic) opening = "Wa'alaikumsalam, kak.";
    else if (time && hasHaloWord) opening = `Halo, kak. Selamat ${time}.`;
    else if (time) opening = `Selamat ${time}, kak.`;
    else opening = 'Halo, kak.';

    // ⚠️  PROBLEM: PROMPT YANG SAMA UNTUK SEMUA
    const prompt = 'Kalau kakak mau, silakan tanya apa yang ingin diketahui 
                    atau pilih menu.';
    return `${opening}\n\n${prompt}`;  // <-- TEMPLATE REPETITIF
  }

ROOT CAUSE:
  Hardcoded prompt yang sama untuk semua greeting, tidak ada variasi berdasarkan
  tipe greeting atau konteks waktu.


═══════════════════════════════════════════════════════════════════════════════
                             RECOMMENDED FIXES
═══════════════════════════════════════════════════════════════════════════════

FIX #1: VARY GREETING PROMPTS BASED ON CONTEXT
────────────────────────────────────────────────
Replace hardcoded prompt dengan variasi yang natural:

  // Natural follow-up prompts (berbeda berdasarkan greeting)
  const promptVariations = {
    'pagi': 'Ada yang perlu ditanyakan pagi ini? Atau mau langsung ke menu.',
    'siang': 'Ada yang bisa aku bantu hari ini? Atau pilih menu yang diinginkan.',
    'sore': 'Gimana kabarnya? Ada yang ingin diketahui seputar STIKOM Bali?',
    'malam': 'Malam! Ada yang perlu dibantu sebelum tidur? 😊 Atau langsung ke menu.',
    'default': 'Ada yang bisa saya bantu? Bisa tanya atau pilih menu.'
  };
  
  const prompt = promptVariations[time] || promptVariations['default'];


FIX #2: ADD HANDLER FOR "APA KABAR"
────────────────────────────────────
Tambahkan greeting handler spesifik untuk "apa kabar":

  const greetings = [
    'halo', 'hai', 'hi', 'hello',
    'selamat pagi', 'pagi',
    'selamat siang', 'siang',
    'selamat sore', 'sore',
    'selamat malam', 'malam',
    'apa kabar',        // <-- ADD THIS
    'kabar apa',        // <-- ADD THIS
    'gimana kabar',     // <-- ADD THIS
    'assalamualaikum', 'salam'
  ];
  
  Dan respons khusus:
  function buildApaKabarReply() {
    const replies = [
      'Alhamdulillah baik-baik saja, thanks for asking! 😊 Ada yang bisa aku bantu?',
      'Baik, terima kasih sudah tanya! Aku siap membantu kakak dengan apa nih?',
      'Baik, Alhamdulillah. Gimana dengan kakak? Ada yang perlu bantu?'
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }


═══════════════════════════════════════════════════════════════════════════════
                            EXPECTED IMPROVEMENTS
═══════════════════════════════════════════════════════════════════════════════

After Fixes Applied:

✅ Input "pagi"  
   BEFORE: "Selamat pagi, kak.\n\nKalau kakak mau, silakan tanya apa yang 
            ingin diketahui atau pilih menu."
   AFTER:  "Selamat pagi, kak.\n\nAda yang perlu ditanyakan pagi ini? Atau 
            mau langsung ke menu."
   
✅ Input "siang"
   BEFORE: "Selamat siang, kak.\n\nKalau kakak mau, silakan tanya apa yang 
            ingin diketahui atau pilih menu."
   AFTER:  "Selamat siang, kak.\n\nAda yang bisa aku bantu hari ini? Atau 
            pilih menu yang diinginkan."

✅ Input "apa kabar"
   BEFORE: "[RAG/Fallback response - tidak ada greeting handler spesifik]"
   AFTER:  "Alhamdulillah baik-baik saja, thanks for asking! 😊 Ada yang 
            bisa aku bantu?"

Pass Rate: 40% → 100%  ✅
Status: NEED FIXES → READY FOR PRODUCTION


═══════════════════════════════════════════════════════════════════════════════
                          IMPLEMENTATION PRIORITY
═══════════════════════════════════════════════════════════════════════════════

1. [HIGH]   Fix template berulang di buildGreetingReply() 
            (Impact: 5 inputs, immediate improvement)

2. [MEDIUM] Add handler untuk "apa kabar" dan variasi
            (Impact: 1 input, better greeting coverage)

3. [LOW]    Monitor production feedback untuk edge cases


═══════════════════════════════════════════════════════════════════════════════
Date: 2026-06-04
Auditor: Conversational Flow Analyzer
Status: RECOMMENDATIONS READY FOR IMPLEMENTATION
═══════════════════════════════════════════════════════════════════════════════
