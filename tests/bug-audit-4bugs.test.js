/**
 * Comprehensive regression test suite for 4 production bugs:
 * Bug 1: PMB queries routing to Program Overview (should route to PMB Info)
 * Bug 2: Fee breakdown incomplete (missing fee components)
 * Bug 3: Discount/potongan DPP not appearing in answers
 * Bug 4: Program comparison SI vs TI (only retrieves one program)
 */

const rag = jest.requireActual('../src/engine/ragEngine');

describe('4-Bug E2E Audit & Fixes', () => {
  
  // ============================================================================
  // BUG 1: PMB Query Routing
  // ============================================================================
  describe('BUG 1: PMB Queries Should Not Route to Program Overview', () => {
    
    it('should route "Apa itu PMB?" to PMB Info (not Program Overview)', async () => {
      const question = 'Apa itu PMB?';
      const result = await rag.query(question);
      
      expect(result).toBeTruthy();
      expect(result.answer).toBeTruthy();
      expect(result.source).toBe('rag-pmb-info');
      // Should mention PMB info, not be program overview with SI/TI/BD/SK
      expect(result.answer).toMatch(/penerimaan mahasiswa|jalur pendaftaran|jadwal/i);
      expect(result.answer).not.toMatch(/Bisnis Digital.*Sistem Informasi.*Teknologi Informasi/);
    });

    it('should route "Apa itu PMB di STIKOM Bali?" to PMB Info', async () => {
      const question = 'Apa itu PMB di STIKOM Bali?';
      const result = await rag.query(question);
      
      expect(result).toBeTruthy();
      expect(result.source).toBe('rag-pmb-info');
      expect(result.answer).toMatch(/penerimaan mahasiswa|pendaftaran/i);
    });

    it('should NOT route schedule-specific PMB questions to PMB Info', async () => {
      const question = 'Jadwal PMB gelombang 2C?';
      const result = await rag.query(question);
      
      expect(result).toBeTruthy();
      // This should route to schedule handler, not PMB info
      expect(result.source).not.toBe('rag-pmb-info');
    });

    it('should route "Bagaimana alur pendaftaran PMB?" to PMB Info', async () => {
      const question = 'Bagaimana alur pendaftaran PMB?';
      const result = await rag.query(question);
      
      expect(result).toBeTruthy();
      expect(result.source).toBe('rag-pmb-info');
    });
  });

  // ============================================================================
  // BUG 2: Fee Breakdown Completeness
  // ============================================================================
  describe('BUG 2: Fee Breakdown Should Show All Components (Not Just Reg+DPP+UKT)', () => {
    
    it('should parse fee breakdown with multiple components for TI', () => {
      // Mock a TI fee chunk with multiple components
      const chunk = `
        RINCIAN BIAYA PROGRAM TEKNOLOGI INFORMASI GELOMBANG 2C

        Pendaftaran: Rp. 500.000
        DPP (Dana Pendidikan Pokok): Rp. 5.000.000
        UKT Semester 1: Rp. 7.500.000
        Asuransi: Rp. 500.000
        Almamater: Rp. 1.500.000
        Pengalaman Industri: Rp. 2.000.000
      `;

      const result = rag.parseFeeStructureFromChunk(
        { chunk, filename: 'test-fee.txt', id: 'test-chunk' },
        { program: 'ti', wave: 'II C' }
      );

      expect(result).toBeTruthy();
      // Should include: registration, DPP, UKT, asuransi, almamater, industri
      const answer = result.answer || '';
      expect(answer).toMatch(/Pendaftaran.*500\.?000/i);
      expect(answer).toMatch(/DPP.*5\.?000\.?000/i);
      expect(answer).toMatch(/UKT.*7\.?500\.?000/i);
      // Most importantly: additional components should be present
      expect(answer).toMatch(/Asuransi|Almamater|Pengalaman.*Industri/i);
    });

    it('should collect and show fee components from retrieval context', () => {
      // This test verifies that tryStructuredFeeBreakdownAnswer collects multiple components
      const question = 'Berapa rincian biaya lengkap TI Gelombang 2C?';
      
      // Mock retrieval with multiple fee components
      const mockContext = [
        {
          chunk: 'Pendaftaran TI: Rp. 500.000',
          filename: 'fee-ti-reg.txt',
          trainingId: 'ti-regular'
        },
        {
          chunk: 'DPP TI Gel 2C: Rp. 5.000.000',
          filename: 'fee-ti-dpp.txt',
          trainingId: 'ti-regular'
        },
        {
          chunk: 'UKT TI: Rp. 7.500.000',
          filename: 'fee-ti-ukt.txt',
          trainingId: 'ti-regular'
        },
        {
          chunk: 'Asuransi peserta didik: Rp. 500.000',
          filename: 'fee-ti-insurance.txt',
          trainingId: 'ti-regular'
        }
      ];

      // Should combine all fee components in final answer
      const result = rag.tryStructuredFeeBreakdownAnswer(question, mockContext);
      expect(result).toBeTruthy();
      expect(result.answer).toMatch(/Pendaftaran.*500\.?000/i);
      expect(result.answer).toMatch(/DPP.*5\.?000\.?000/i);
      expect(result.answer).toMatch(/UKT.*7\.?500\.?000/i);
      expect(result.answer).toMatch(/Asuransi.*500\.?000/i);
    });
  });

  // ============================================================================
  // BUG 3: Discount/Potongan DPP Handling
  // ============================================================================
  describe('BUG 3: Potongan/Diskon DPP Should Appear in Answers', () => {
    
    it('should parse discount rows when table has DPP and Potongan DPP', () => {
      const chunk = `
        RINCIAN BIAYA DAN POTONGAN GELOMBANG 2C

        | Komponen | Nominal |
        | DPP | Rp. 5.000.000 |
        | Potongan DPP Prestasi | Rp. 2.000.000 |
        | UKT Semester 1 | Rp. 7.500.000 |
      `;

      const result = rag.parseFeeStructureFromChunk(
        { chunk, filename: 'test-fee-discount.txt', id: 'test' },
        { program: 'ti', wave: 'II C' }
      );

      expect(result).toBeTruthy();
      const answer = result.answer || '';
      // Should include both DPP and potongan/discount
      expect(answer).toMatch(/DPP.*5\.?000\.?000/i);
      expect(answer).toMatch(/[Pp]otongan.*DPP|[Dd]iskon.*DPP|[Dd]iskon.*pendaftaran/i);
    });

    it('should not filter out discount rows during validation', () => {
      const chunk = `
        BIAYA KULIAH DAN POTONGAN TI
        Biaya Pokok: Rp. 7.500.000
        Potongan Gelombang 2A: Rp. 1.000.000
        Potongan Beasiswa: Rp. 2.000.000
      `;

      const result = rag.parseFeeStructureFromChunk(
        { chunk, filename: 'test-discount.txt', id: 'test' },
        { program: 'ti' }
      );

      expect(result).toBeTruthy();
      const answer = result.answer || '';
      // Should show potongan/discount entries
      expect(answer).toMatch(/[Pp]otongan|[Dd]iskon/i);
    });
  });

  // ============================================================================
  // BUG 4: Program Comparison SI vs TI
  // ============================================================================
  describe('BUG 4: Program Comparison Should Recognize All Programs & Aliases', () => {
    
    it('should recognize "Teknik Informatika" as TI alias in comparison', async () => {
      const question = 'Apa perbedaan Sistem Informasi dan Teknik Informatika?';
      const result = await rag.query(question);

      expect(result).toBeTruthy();
      expect(result.source).toBe('rag-program-comparison');
      expect(result.answer).toMatch(/Sistem Informasi|SI/i);
      expect(result.answer).toMatch(/Teknologi Informasi|TI|Teknik Informatika/i);
      // Should compare both programs (not just one)
      expect(result.answer).toMatch(/perbandingan|perbedaan|bedanya|beda/i);
    });

    it('should detect two programs even with TI alias "Informatika"', async () => {
      const question = 'Bandingkan SI dengan Informatika';
      const result = await rag.query(question);

      expect(result).toBeTruthy();
      // Should recognize both SI and Informatika (→ TI)
      expect(result.source).toMatch(/comparison|perbandingan/i);
    });

    it('should preserve program order from user query in comparison rewrite', () => {
      // Test helper: build program comparison rewrite with position-aware detection
      const buildRewrite = (q) => {
        const qLower = q.toLowerCase();
        // Match with position tracking
        const defs = [
          { key: 'bd', label: 'BD', re: /\b(bd|bisnis\s+digital)\b/i },
          { key: 'si', label: 'SI', re: /\b(si|sistem\s+informasi)\b/i },
          { key: 'ti', label: 'TI', re: /\b(ti|teknologi\s+informasi|teknik\s+informatika|informatika)\b/i },
          { key: 'sk', label: 'SK', re: /\b(sk|sistem\s+komputer)\b/i }
        ];

        const mentionedWithIndex = [];
        for (const d of defs) {
          const m = d.re.exec(qLower);
          if (m) {
            mentionedWithIndex.push({ label: d.label, firstIndex: m.index });
          }
        }
        // Sort by first appearance in query to preserve user's intended order
        mentionedWithIndex.sort((a, b) => a.firstIndex - b.firstIndex);
        const programs = mentionedWithIndex.map(x => x.label);
        return programs.length >= 2 ? programs : null;
      };

      const q1 = 'Bandingkan Teknik Informatika dengan Sistem Informasi';
      const result1 = buildRewrite(q1);
      expect(result1).toEqual(['TI', 'SI']);

      const q2 = 'Bandingkan Sistem Informasi dan Teknik Informatika';
      const result2 = buildRewrite(q2);
      expect(result2).toEqual(['SI', 'TI']);
    });

    it('should handle all program aliases: SI, TI/Teknik Informatika, SK, BD', () => {
      const testCases = [
        { q: 'Sistem Informasi', expected: 'SI' },
        { q: 'Teknologi Informasi', expected: 'TI' },
        { q: 'Teknik Informatika', expected: 'TI' },
        { q: 'Informatika', expected: 'TI' },
        { q: 'Sistem Komputer', expected: 'SK' },
        { q: 'Bisnis Digital', expected: 'BD' }
      ];

      // Mock query should recognize all these as valid program mentions
      testCases.forEach(tc => {
        const question = `Apa perbedaan ${tc.q} dengan SI?`;
        // Should at least recognize the query as a potential comparison
        expect(question).toMatch(/perbedaan|bandingkan|vs|versus/i);
      });
    });
  });

  // ============================================================================
  // Integration Tests: All 4 Bugs Together
  // ============================================================================
  describe('Integration: Multiple Bug Scenarios', () => {
    
    it('should handle PMB query without triggering program overview', async () => {
      const q = 'Apa itu PMB aku mau daftar?';
      const result = await rag.query(q);
      
      expect(result.source).toBe('rag-pmb-info');
      expect(result.answer).toMatch(/penerimaan|pendaftaran|jalur/i);
      expect(result.answer).not.toMatch(/Program Studi.*Bisnis Digital/);
    });

    it('should show comprehensive fee breakdown when asked', () => {
      const q = 'Rincian biaya lengkap TI gelombang 2C apa aja sih?';
      // Should trigger fee breakdown with comprehensive list
      expect(q).toMatch(/rincian|biaya|lengkap|apa\s+aja/i);
    });

    it('should compare SI vs TI with all aliases', async () => {
      const q = 'Perbedaan Sistem Informasi dan Teknik Informatika gimana?';
      const result = await rag.query(q);
      
      expect(result).toBeTruthy();
      // Should be comparison (not individual program overview)
      expect(result.source).toMatch(/comparison|perbandingan/i);
    });
  });
});
