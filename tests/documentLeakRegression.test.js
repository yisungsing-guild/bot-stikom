describe('document leak regression test', () => {
  const criticalQuestion = "kalau mahasiswa ingin meningkatkan kemampuan bahasanya, apakah stikom mempunyai fasilitas untuk itu ya?";
  
  const legalMarkers = [
    /\bPasal\b/i,
    /\bPIHAK\s+(?:KESATU|KEDUA)\b/i,
    /\bPARA\s+PIHAK\b/i,
    /\bFORCE\s+MAJEURE\b/i,
    /\bADDENDUM\b/i,
    /\bPERJANJIAN\s+KERJA\s*SAMA\b/i
  ];
  
  const documentMarkers = [
    /\(F\)\s*/i,
    /\(Q\)\s*/i,
    /\(A\)\s*/i,
    /\bF:\s*/i,
    /\bQ:\s*/i,
    /\bA:\s*/i,
    /\bFAQ:\s*/i,
    /\bQuestion:\s*/i,
    /\bAnswer:\s*/i,
    /\bPertanyaan:\s*/i,
    /\bJawaban:\s*/i
  ];

  beforeEach(() => {
    jest.resetModules();
    delete process.env.OPENAI_API_KEY;
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-22';
    process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK = 'false';
  });

  afterEach(() => {
    delete process.env.SEMANTIC_RAG_TODAY_YMD;
    delete process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK;
    delete process.env.SEMANTIC_RAG_RESULT_CACHE_MS;
    delete process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;
  });

  test('critical language-facility question does not leak legal documents', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag(criticalQuestion, { topK: 8 });
    
    expect(result.success).toBe(true);
    expect(result.answer).toBeTruthy();
    
    const answer = result.answer;
    
    // Check for legal markers
    for (const pattern of legalMarkers) {
      expect(answer).not.toMatch(pattern);
    }
    
    // Check for document/FAQ markers
    for (const pattern of documentMarkers) {
      expect(answer).not.toMatch(pattern);
    }
    
    // Check answer length is reasonable (not dumping full document)
    expect(answer.length).toBeLessThan(2000);
    
    // Check answer addresses the intent (language facilities)
    expect(answer.toLowerCase()).toMatch(/bahasa|language|fasilitas|program/i);
    
    // Verify source is not from raw legal document
    if (result.source) {
      expect(result.source).not.toMatch(/mou|perjanjian|agreement|kerjasama/i);
    }
  });

  test('critical language-facility question uses relevant evidence when available', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag(criticalQuestion, { topK: 8 });
    
    expect(result.success).toBe(true);
    expect(result.answer).toBeTruthy();
    
    const answer = result.answer.toLowerCase();
    
    // Should mention language-related facilities or programs
    const hasLanguageContent = 
      answer.includes('language') || 
      answer.includes('bahasa') ||
      answer.includes('inggris') ||
      answer.includes('asing');
    
    // If no language content, should be a clarification or insufficient data response
    if (!hasLanguageContent) {
      const isClarification = 
        answer.includes('tidak cukup data') ||
        answer.includes('data tidak tersedia') ||
        answer.includes('informasi tidak tersedia') ||
        answer.includes('bisa tanya lebih spesifik');
      
      expect(isClarification).toBe(true);
    }
  });

  test('critical language-facility question rejects cooperation-agreement evidence', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag(criticalQuestion, { topK: 8 });
    
    expect(result.success).toBe(true);
    
    // Check contexts if available
    if (result.contexts && result.contexts.length > 0) {
      for (const ctx of result.contexts) {
        const content = ctx.text || ctx.chunk;
        
        // Reject contexts with legal markers
        for (const pattern of legalMarkers) {
          expect(content).not.toMatch(pattern);
        }
        
        // Reject contexts from agreement documents
        if (ctx.filename || ctx.source) {
          const filename = (ctx.filename || ctx.source).toLowerCase();
          expect(filename).not.toMatch(/mou|perjanjian|agreement|kerjasama|template/i);
        }
      }
    }
  });

  test('language facility variants do not leak legal documents', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    
    const variants = [
      "apakah ada layanan untuk mahasiswa yang mau belajar bahasa asing?",
      "saya ingin meningkatkan kemampuan bahasa inggris, kampus menyediakan program apa?",
      "ada tempat atau komunitas untuk latihan bahasa di kampus?",
      "fasilitas bahasa untuk mahasiswa ada tidak?"
    ];
    
    for (const question of variants) {
      const result = await querySemanticRag(question, { topK: 8 });
      
      expect(result.success).toBe(true);
      expect(result.answer).toBeTruthy();
      
      const answer = result.answer;
      
      // Check for legal markers
      for (const pattern of legalMarkers) {
        expect(answer).not.toMatch(pattern);
      }
      
      // Check for document markers
      for (const pattern of documentMarkers) {
        expect(answer).not.toMatch(pattern);
      }
    }
  });
});
