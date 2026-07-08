              try {
                logger.info({ waveForFallback, hasParsedDiscounts: !!(extracted && extracted._parsedPendaftaranDiscounts),
                  hasParsedDpp: !!(extracted && extracted._parsedDppScholar),
                  discountTableKeys: discountTableToUse && discountTableToUse.byWave ? Object.keys(discountTableToUse.byWave) : null,
                  dppTableKeys: dppScholarTableToUse && dppScholarTableToUse.byWave ? Object.keys(dppScholarTableToUse.byWave) : null
                }, '[Provider] fee post-process debug');
              } catch (e) {
                // swallow logging errors
              }

              try {
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
              // Don't let post-processing failures break RAG — log and continue.
              logger.warn({ err: e && e.message ? e.message : String(e) }, '[Provider] RAG fee post-processing failed');
            }
          }
        }
      }
    } catch (e) {
      logger.warn({ err: e && e.message ? e.message : String(e) }, '[Provider] RAG post-processing failed');
    }
