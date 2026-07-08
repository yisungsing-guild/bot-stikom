          try {
            // Attempt to extract structured components from the RAG answer.
            let extracted = extractFeeBasicsFromSection(String(ragResult.answer || ''));
            const programHint = extractProgramHint(qForCheck) || extractProgramHint(opts && opts.answerQuestion ? opts.answerQuestion : question) || null;

            // If extraction from RAG answer is incomplete or missing important parts (e.g. pendaftaran/DPP),
            // try to merge values from trainingData rows in the DB that mention the program.
            try {
              // Only merge DB training rows when the RAG answer is low/medium confidence
              // or explicitly rejected. Avoid merging when RAG produced a HIGH-confidence
              // structured fee answer to prevent cross-document mixing.
              const lowConfidenceTier = ragResult && ragResult.confidenceTier && ['LOW', 'MEDIUM'].includes(String(ragResult.confidenceTier).toUpperCase());
              // NOTE: Suffix queries are now normalized by parseGelombang().
              // They are treated as regular queries and can be merged with DB training data.
              const needsDbMerge = ((!extracted || (!extracted.pendaftaran && !extracted.dpp)) && programHint && prisma && prisma.trainingData && typeof prisma.trainingData.findMany === 'function')
                && (ragResult && (ragResult.source === 'rag-answer-rejected' || lowConfidenceTier));
              if (needsDbMerge) {
                const qProg = String(programHint || '').trim();
                // Keep search short to avoid huge scans.
                const searchStr = qProg.split(/[\n|\-|,]/)[0].slice(0, 120);
                let rows = [];
                try {
                  rows = await prisma.trainingData.findMany({
                    where: {
                      active: true,
                      OR: [
                        { filename: { contains: 'rincian', mode: 'insensitive' } },
                        { filename: { contains: 'biaya', mode: 'insensitive' } },
                        { content: { contains: searchStr, mode: 'insensitive' } }
                      ]
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 12,
                    select: { filename: true, content: true }
                  });
                } catch (e) {
                  rows = [];
                }

                if (Array.isArray(rows) && rows.length > 0) {
                  // helper: parse per-wave pendaftaran discounts from raw training content
                  const parsePendaftaranDiscountsFromText = (txt) => {
                    try {
                      if (!txt || !String(txt).trim()) return null;
                      const lower = String(txt);
                      // accept either "Potongan Biaya Pendaftaran" or "Potongan Pendaftaran"
                      const potIdx = lower.search(/potongan\s*(?:biaya\s*)?pendaftaran/i);
                      if (potIdx < 0) return null;
                      const potSection = lower.slice(potIdx, Math.min(lower.length, potIdx + 8000));
                      const byWave = {};
                      // allow amounts with or without explicit 'Rp' prefix
                      const regex1 = /(?:Rp\s*[.,]*\s*)?([0-9][0-9.,\s]{0,30})/gi;
                      let match1;
                      while ((match1 = regex1.exec(potSection)) !== null) {
                        const amountRaw = match1[1] ? String(match1[1]).trim() : '';
                        if (!amountRaw) continue;
                        // search for nearby wave label (allow before or after the amount)
                        const start = Math.max(0, match1.index - 140);
                        const ctx = potSection.slice(start, Math.min(potSection.length, match1.index + 140));
                        const waveM = /(?:gelombang|gel\.?|gbg)\s*(khusus|[0-9ivx]+)/i.exec(ctx) || /(khusus|i|ii|iii|iv|v|vi)/i.exec(ctx);
                        if (!waveM || !waveM[1]) continue;
                        let wave = String(waveM[1]).trim();
                        if (/khusus/i.test(wave)) wave = 'Khusus';
                        else {
                          wave = wave.toUpperCase();
                          if (wave === '1') wave = 'I';
                          else if (wave === '2') wave = 'II';
                          else if (wave === '3') wave = 'III';
                          else if (wave === '4') wave = 'IV';
                        }
                        if (!wave) continue;
                        if (Object.prototype.hasOwnProperty.call(byWave, wave)) continue;
                        const n = parseCompactRupiahNumber(amountRaw, { min: 1000, max: 50_000_000 });
                        if (!n) continue;
                        byWave[wave] = n;
                      }
                      return Object.keys(byWave).length ? { byWave } : null;
                    } catch (e) {
                      return null;
                    }
                  };

                  // helper: parse DPP scholarship/discounts from text
                  const parseDppScholarFromText = (txt) => {
                    try {
                      if (!txt || !String(txt).trim()) return null;
                      const lower = String(txt);
                      const beaIdx = lower.search(/beasiswa[\s\S]{0,60}(?:dana\s*pendidikan\s*pokok|dpp)/i);
                      if (beaIdx < 0) return null;
                      const beaSection = lower.slice(beaIdx, Math.min(lower.length, beaIdx + 8000));
                      const byWave = {};
                      const regex2 = /Rp\s*[.,]*\s*([0-9][0-9.,\s]{0,30})/gi;
                      let m2;
                      while ((m2 = regex2.exec(beaSection)) !== null) {
                        const amountRaw = m2[1] ? String(m2[1]).trim() : '';
                        if (!amountRaw) continue;
                        const start = Math.max(0, m2.index - 120);
                        const ctx = beaSection.slice(start, Math.min(beaSection.length, m2.index + 120));
                        const waveM = /gelombang\s*(khusus|[0-9ivx]+)/i.exec(ctx) || /(khusus|i|ii|iii|iv|v|vi)/i.exec(ctx);
                        if (!waveM || !waveM[1]) continue;
                        let wave = String(waveM[1]).trim();
                        if (/khusus/i.test(wave)) wave = 'Khusus';
                        else {
                          wave = wave.toUpperCase();
                          if (wave === '1') wave = 'I';
                          else if (wave === '2') wave = 'II';
                          else if (wave === '3') wave = 'III';
                          else if (wave === '4') wave = 'IV';
                        }
                        if (!wave) continue;
                        if (Object.prototype.hasOwnProperty.call(byWave, wave)) continue;
                        const n = parseCompactRupiahNumber(amountRaw, { min: 1000, max: 250_000_000 });
                        if (!n) continue;
                        byWave[wave] = n;
                      }
                      return Object.keys(byWave).length ? { byWave } : null;
                    } catch (e) {
                      return null;
                    }
                  };

                  let mergedDiscounts = null;
                  let mergedDppScholar = null;

                  for (const r of rows) {
                    if (!r || !r.content) continue;
                    // try to extract discounts/scholarships from the raw training text
                    if (!mergedDiscounts) mergedDiscounts = parsePendaftaranDiscountsFromText(r.content) || null;
                    if (!mergedDppScholar) mergedDppScholar = parseDppScholarFromText(r.content) || null;

                    const extractedFromTraining = extractFeeBasicsFromSection(r.content);
                    if (!extractedFromTraining) continue;
                    if (!extracted) extracted = {};
                    if (!extracted.pendaftaran && extractedFromTraining.pendaftaran) extracted.pendaftaran = extractedFromTraining.pendaftaran;
                    if (!extracted.dpp && extractedFromTraining.dpp) extracted.dpp = extractedFromTraining.dpp;
                    if (!extracted.atribut1 && extractedFromTraining.atribut1) extracted.atribut1 = extractedFromTraining.atribut1;
                    if (!extracted.atribut2 && extractedFromTraining.atribut2) extracted.atribut2 = extractedFromTraining.atribut2;
                    if (!extracted.semester && extractedFromTraining.semester) extracted.semester = extractedFromTraining.semester;
                    // recompute totalAwalMasuk EXCLUDING atribut3
                    const sum = [extracted.pendaftaran, extracted.dpp, extracted.atribut1, extracted.atribut2]
                      .filter(v => typeof v === 'number' && Number.isFinite(v)).reduce((a, b) => a + (b || 0), 0);
                    if (sum > 0) extracted.totalAwalMasuk = sum;
                    // if we now have both pendaftaran and dpp, we can stop
                    if (extracted.pendaftaran && extracted.dpp) break;
                  }

                  // Attach parsed discount tables to extracted for caller to use
                  if (mergedDiscounts) {
                    if (!extracted) extracted = {};
                    extracted._parsedPendaftaranDiscounts = mergedDiscounts;
                  }
                  if (mergedDppScholar) {
                    if (!extracted) extracted = {};
                    extracted._parsedDppScholar = mergedDppScholar;
                  }
                }
              }
            } catch (e) {
              logger.warn({ err: e && e.message ? e.message : String(e) }, '[Provider] fee extraction DB-merge failed');
            }

            if (extracted && (extracted.pendaftaran || extracted.dpp || extracted.semester || extracted.atribut1 || extracted.atribut2 || extracted.totalAwalMasuk)) {
              // Map program hint to feeBasics key expected by buildFastFeeAnswer
              const prog = programHint || (opts && opts.program ? String(opts.program) : '') || '';
              const p = String(prog || '').toLowerCase();
              let programKey = 's1';
              if (/sistem\s*komputer/i.test(p)) programKey = 'sk';
              else if (/\bd3\b|diploma|manajemen\s*informatika/i.test(p)) programKey = 'd3';
              else if (/\bs2\b|pascasarjana|magister|master/i.test(p)) programKey = 's2';
              else if (/\butb\b/i.test(p)) programKey = 'utb';
              else if (/\bdnui\b/i.test(p)) programKey = 'dnui';
              else if (/\bhelp\b/i.test(p)) programKey = 'help';

              const feeBasics = {};
              feeBasics[programKey] = extracted;

              // Prefer parsed tables from extracted content
              let discountTableToUse = (extracted && extracted._parsedPendaftaranDiscounts) ? extracted._parsedPendaftaranDiscounts : null;
              let dppScholarTableToUse = (extracted && extracted._parsedDppScholar) ? extracted._parsedDppScholar : null;

              // If the caller requested a specific wave and we don't have parsed
              // discount tables yet, try a best-effort fallback by scanning the
              // local backup trainingData.json (same source used by the RAG helper).
              const waveForFallback = (typeof gelDet !== 'undefined' && gelDet) ? String(gelDet).trim() : null;
              if (waveForFallback && (!discountTableToUse || !dppScholarTableToUse)) {
                try {
                  const backupPath = path.join(__dirname, '..', '..', 'backups', 'backup-20260424-145106', 'trainingData.json');
                  if (fs.existsSync(backupPath)) {
                    const backupRaw = String(fs.readFileSync(backupPath, 'utf8') || '');
                    if (backupRaw) {
                      const backupJson = JSON.parse(backupRaw);
                      const rows = Array.isArray(backupJson && backupJson.rows) ? backupJson.rows : [];
                      const scanText = rows.map(r => String(r && r.content ? r.content : '')).filter(Boolean).join('\n');
                      if (scanText) {
                        const regSection = scanText.match(/Potongan\s*Biaya\s*Pendaftaran[\s\S]{0,900}?((?=Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok)|(?=Khusus\s+Alumni|4\.)|$)/i);
                        const dppSection = scanText.match(/Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok[\s\S]{0,900}?((?=Khusus\s+Alumni|4\.)|$)/i);
                        const regText = regSection ? regSection[0] : '';
                        const dppText = dppSection ? dppSection[0] : '';

                        const normalizeWaveLocal = (waveText) => {
                          const w = String(waveText || '').toUpperCase().trim();
                          if (!w) return null;
                          if (w.includes('KHUSUS')) return 'Khusus';
                          const m = /^((?:IV|III|II|I)|[1-9][0-9]?)(?:\s*([A-C]))?$/.exec(w);
                          if (!m) return null;
                          const token = m[1];
                          const suffix = m[2] ? m[2].toUpperCase() : '';
                          const map = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X' };
                          const base = map[token] || token;
                          return `${base}${suffix}`;
                        };

                        const byWaveReg = {};
                        const byWaveDpp = {};

                        if (regText) {
                          for (const match of regText.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)[\s\S]{0,80}?Gelombang\s*(Khusus|IV|III|II|I|[1-9][0-9]?)(?:\s*([A-C]))?/gi)) {
                            const waveLabel = normalizeWaveLocal(match[2] || match[1]);
                            if (!waveLabel) continue;
                            const n = parseCompactRupiahNumber(match[1], { min: 1000, max: 50_000_000 });
                            if (!n) continue;
                            if (!Object.prototype.hasOwnProperty.call(byWaveReg, waveLabel)) byWaveReg[waveLabel] = n;
                          }
                        }

                        if (dppText) {
                          for (const match of dppText.matchAll(/Gelombang\s*(Khusus|IV|III|II|I|[1-9][0-9]?)(?:\s*([A-C]))?[\s\S]{0,80}?Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)/gi)) {
                            const waveLabel = normalizeWaveLocal(`${match[1] || ''}${match[2] || ''}`);
                            if (!waveLabel) continue;
                            const n = parseCompactRupiahNumber(match[3], { min: 1000, max: 250_000_000 });
                            if (!n) continue;
                            if (!Object.prototype.hasOwnProperty.call(byWaveDpp, waveLabel)) byWaveDpp[waveLabel] = n;
                          }

                          for (const match of dppText.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)[\s\S]{0,80}?Gelombang\s*(Khusus|IV|III|II|I|[1-9][0-9]?)(?:\s*([A-C]))?/gi)) {
                            const waveLabel = normalizeWaveLocal(`${match[2] || ''}${match[3] || ''}`);
                            if (!waveLabel) continue;
                            const n = parseCompactRupiahNumber(match[1], { min: 1000, max: 250_000_000 });
                            if (!n) continue;
                            if (!Object.prototype.hasOwnProperty.call(byWaveDpp, waveLabel)) byWaveDpp[waveLabel] = n;
                          }
                        }

                        if (Object.keys(byWaveReg).length > 0 && !discountTableToUse) discountTableToUse = { byWave: byWaveReg };
                        if (Object.keys(byWaveDpp).length > 0 && !dppScholarTableToUse) dppScholarTableToUse = { byWave: byWaveDpp };
                      }
                    }
                  }
                } catch (e) {
                  // ignore fallback failures
                }
              }

              // Debug: log what tables/values we will pass to buildFastFeeAnswer
              try {
                logger.info({ waveForFallback, hasParsedDiscounts: !!(extracted && extracted._parsedPendaftaranDiscounts),
                  hasParsedDpp: !!(extracted && extracted._parsedDppScholar),
                  discountTableKeys: discountTableToUse && discountTableToUse.byWave ? Object.keys(discountTableToUse.byWave) : null,
                  dppTableKeys: dppScholarTableToUse && dppScholarTableToUse.byWave ? Object.keys(dppScholarTableToUse.byWave) : null
                }, '[Provider] fee post-process debug');
              } catch (e) {
                // swallow logging errors
              }

              const routeTextPost = String(qForCheck || question || '').trim();
              const allowFastPost = allowFastFeeFor(routeTextPost, { feeChoice: !!(typeof looksLikeFee !== 'undefined' ? looksLikeFee : false), pendingFeeBreakdownOffer: !!opts.pendingFeeBreakdownOffer });
              logRouteDecision(routeTextPost, programHint || prog || '', (typeof detectIntent === 'function' ? detectIntent(routeTextPost) : null), isExplicitFeeQuestion(routeTextPost), allowFastPost ? 'fee_fast' : 'skip_fee_fast');
              let structured = null;
              if (allowFastPost) {
                structured = buildFastFeeAnswer(
                  programHint || prog || '',
                  'breakdown',
                  feeBasics,
                  {
                    wave: waveForFallback,
                    discountTable: discountTableToUse,
                    dppScholarTable: dppScholarTableToUse
                  }
                );
              }
              if (structured) {
                ragResult.answer = structured;
              } else {
                // If we couldn't build a structured reply, append scholarships + final prompt.
                const needsPostamble = !/Untuk meringankan biaya|Beasiswa KIP|Apakah Kakak ingin dijelaskan tentang\?/i.test(ragResult.answer);
                if (needsPostamble) {
                  const postamble = [
                    'Untuk meringankan biaya, tersedia berbagai macam beasiswa yang bisa dimanfaatkan sesuai syarat dan ketentuan yang berlaku termasuk:',
                    '* Beasiswa KIP',
                    '* Beasiswa 1K1S (Satu Keluarga Satu Sarjana)',
                    '* Beasiswa Prestasi',
                    '* Beasiswa Yayasan',
                    '* Beasiswa Khusus Siswa SMKTI Bali Global dan SMK Pandawa Bali Global',
                    '* Kuliah Sambil Kerja di Luar Negeri',
                    '',
                    'Apakah Kakak ingin dijelaskan tentang?',
                    '* Biaya perkuliahan program studi yang lainnya',
                    '* Salah satu jenis beasiswa',
                    '* Fasilitas yang ada di ITB STIKOM Bali seperti Career Center, Inkubator Bisnis, Hi-Think (Program Persiapan Kerja di Bidang TI di Jepang) dll',
                    'Silahkan diketikkan.'
                  ].join('\n');
                  ragResult.answer = String(ragResult.answer || '').trim() + '\n\n' + postamble;
                }
              }
            } catch (e) {
              // Don't let post-processing failures break RAG â€” log and continue.
              logger.warn({ err: e && e.message ? e.message : String(e) }, '[Provider] RAG fee post-processing failed');
            }
          }
        }
