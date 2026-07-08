async function temp() {
        }

        if (selection && sessionData && sessionData.numericMenuActive && menuFresh && lastWasWelcomeMenu) {
          // If the user is already inside a DB-driven submenu state (e.g. root.5)
          // then let FSM handle the numbered reply first before the built-in welcome menu logic.
          if (session && session.state && String(session.state).trim().toLowerCase() !== 'root') {
            try {
              const fsmReply = await handleFSM(chatId, String(selection));
              if (fsmReply) {
                await sendBotMessage(chatId, fsmReply);
                return res.send({ ok: true, source: 'fsm_submenu_override', selection, state: session.state });
              }
            } catch (e) {
              logger.warn({ err: e.message, state: session.state, selection }, '[Provider] FSM submenu override failed');
            }
          }

        // Backward-compatible numeric 7 still triggers handover even if labels weren't parsed.
        if (selection === 7) {
          // Offer handover (do not switch immediately), consistent with existing behavior.
          const currentState = session ? session.state : 'root';
          const prevData = sessionData || {};
          const newData = { ...prevData, handoverOffered: true, handoverOfferedAt: now.toISOString() };
          await prisma.session.upsert({
            where: { chatId },
            create: { chatId, state: currentState, data: newData },
            update: { state: currentState, data: newData }
          });

          await sendBotMessage(
            chatId,
            buildHandoverOfferMessage()
          );
          return res.send({ ok: true, source: 'numeric_menu', selection });
        }

        // If DB-driven menu items exist (admin panel / Menu page), prefer them over the legacy
        // hardcoded numeric menu mapping. This fixes cases where the user set `root.2` etc.
        // but the reply still comes from the built-in numeric menu handler.
        try {
          if (prisma && prisma.menuItem && typeof prisma.menuItem.findFirst === 'function') {
            const dbKey = `root.${selection}`;
            const dbMenu = await prisma.menuItem.findFirst({ where: { key: dbKey } }).catch(() => null);
            const dbText = dbMenu && Object.prototype.hasOwnProperty.call(dbMenu, 'text') ? String(dbMenu.text || '') : '';

            if (dbText.trim()) {
              // Update session state without wiping Session.data.
              try {
                await prisma.session.upsert({
                  where: { chatId },
                  create: { chatId, state: dbKey },
                  update: { state: dbKey }
                });
              } catch (e) {
                logger.warn({ err: e.message }, '[Provider] Failed to persist DB menu state');
              }

              await sendBotMessage(chatId, dbText);
              return res.send({ ok: true, source: 'menu_db', selection, key: dbKey });
            }
          }
        } catch (e) {
          logger.warn({ err: e.message }, '[Provider] DB menu override failed');
        }

        // Dynamic routing based on the actual welcome menu option text.
        // This prevents mismatches when welcome_message numbering is customized.
        let welcomeLabel = resolveWelcomeMenuLabel(sessionData, welcomeSetting && welcomeSetting.value ? welcomeSetting.value : '', selection);
        if (!welcomeLabel) {
          const fallbackSource =
            getLastBotMessageFromSessionData(sessionData) ||
            (welcomeSetting && welcomeSetting.value ? String(welcomeSetting.value || '') : '');
          if (fallbackSource) {
            const fallbackOptions = parseNumberedOptionsFromBotMessage(fallbackSource);
            const fallbackLabel = fallbackOptions && fallbackOptions[selection] ? String(fallbackOptions[selection]).trim() : '';
            if (fallbackLabel) welcomeLabel = fallbackLabel;
          }
        }

        // If the label indicates a PMB-specific subtopic (e.g. "Cara Daftar"), rewrite the
        // message into a concrete query and continue normal processing (RAG/keyword/etc).
        const directQuery = welcomeLabel ? inferWelcomeMenuDirectQueryFromLabel(welcomeLabel) : null;
        if (directQuery) {
          text = directQuery;
          contextualNumericHandled = true;
          const logPII = String(process.env.LOG_PII || '').trim().toLowerCase();
          const allowPII = logPII === 'true' || logPII === '1' || logPII === 'yes' || logPII === 'y' || logPII === 'on';
          const maskedChatId = allowPII ? chatId : String(chatId || '').replace(/\d(?=\d{4})/g, '*');
          logger.info(
            { chatId: maskedChatId, selection, welcomeLabel, directQuery: allowPII ? directQuery : '<redacted>' },
            '[ProviderRoute] Welcome menu direct routing applied'
          );

          // Persist label for diagnostics/follow-ups.
          try {
            const currentState = session ? session.state : 'root';
            const newData = {
              ...(sessionData || {}),
              lastNumericMenuSelection: selection,
              lastNumericMenuLabel: welcomeLabel
            };
            await prisma.session.upsert({
              where: { chatId },
              create: { chatId, state: currentState, data: newData },
              update: { state: currentState, data: newData }
            });
          } catch (e) {
            logger.warn({ err: e.message }, '[Provider] Failed to persist welcome-menu direct routing state');
          }
        } else {
          const effective = welcomeLabel ? inferWelcomeMenuEffectiveSelectionFromLabel(welcomeLabel) : null;

          // If we can parse the welcome-menu label but can't map it to our built-in numeric menu,
          // DO NOT fall back to the hardcoded selection number (it may mismatch the shown menu).
          // Instead, treat the label as the user's intended topic.
          if (welcomeLabel && !effective) {
            text = `Tolong jelaskan tentang: ${welcomeLabel}`;
            contextualNumericHandled = true;
            console.log('[ProviderRoute] Welcome menu unknown label routed as topic', { chatId, selection, welcomeLabel });

            try {
              const currentState = session ? session.state : 'root';
              const newData = {
                ...(sessionData || {}),
                lastNumericMenuSelection: selection,
                lastNumericMenuLabel: welcomeLabel
              };
              await prisma.session.upsert({
                where: { chatId },
                create: { chatId, state: currentState, data: newData },
                update: { state: currentState, data: newData }
              });
            } catch (e) {
              logger.warn({ err: e.message }, '[Provider] Failed to persist welcome-menu label routing state');
            }
          } else if (welcomeLabel && (effective === 'handover' || labelLooksLikeAdminHandover(welcomeLabel))) {
            // Offer handover (do not switch immediately), consistent with existing behavior.
            const currentState = session ? session.state : 'root';
            const prevData = sessionData || {};
            const newData = { ...prevData, handoverOffered: true, handoverOfferedAt: now.toISOString() };
            await prisma.session.upsert({
              where: { chatId },
              create: { chatId, state: currentState, data: newData },
              update: { chatId, state: currentState, data: newData }
            });

            await sendBotMessage(
              chatId,
              buildHandoverOfferMessage()
            );
            return res.send({ ok: true, source: 'numeric_menu', selection });
          } else if (welcomeLabel && (effective === 'location' || labelLooksLikeCampusLocation(welcomeLabel))) {
            const question = 'Berikan lokasi/alamat kampus ITB STIKOM Bali (Denpasar/Renon, Jimbaran, Abiansemal) dan kontak singkat jika ada.';

            let answer = null;
            if (isRagEnabled()) {
              if (hasActiveTrainingData || allowIndexFallbackNoDb) {
                const topK = parseInt(process.env.RAG_TOP_K || '6', 10);
                const ragResult = await ragQueryWithEval(chatId, question, topK, { answerQuestion: question, minScore: 0 });
                if (ragResult && ragResult.success && ragResult.answer) answer = ragResult.answer;
              }
            }

            if (!answer) {
              try {
                const enableWeb = String(process.env.ENABLE_WEB_SEARCH_FALLBACK || 'false').toLowerCase() === 'true';
                if (enableWeb) {
                  const web = await webSearchFallbackAnswer('Lokasi dan alamat kampus ITB STIKOM Bali (Denpasar/Renon, Jimbaran, Abiansemal) beserta kontak', {
                    seedUrl: process.env.WEB_SEARCH_SEED_URL || 'https://www.stikom-bali.ac.id/id/'
                  });
                  if (web && web.ok && web.answer) answer = web.answer;
                }
              } catch (e) {
                logger.warn({ err: e.message }, '[Provider] Location web fallback failed');
              }
            }

            if (!answer) {
              answer = 'Untuk lokasi kampus, kakak ingin yang mana: Denpasar/Renon, Jimbaran, atau Abiansemal? Nanti saya kirim alamat & kontak yang tersedia.';
            }

            await sendBotMessage(chatId, answer);
            return res.send({ ok: true, source: 'numeric_menu', selection, label: welcomeLabel, ragUsed: !!(answer && isRagEnabled()) });
          } else {
            const effectiveSelection = (typeof effective === 'number' && Number.isFinite(effective)) ? effective : selection;

            const menu = NUMERIC_MENU_MAP[effectiveSelection];
            if (menu) {
          // Persist last selection so future follow-ups can be interpreted.
          try {
            const currentState = session ? session.state : 'root';
            const newData = {
              ...sessionData,
              lastNumericMenuSelection: selection,
              lastNumericMenuLabel: welcomeLabel || menu.label,
              lastNumericMenuEffectiveSelection: effectiveSelection
            };
            await prisma.session.upsert({
              where: { chatId },
              create: { chatId, state: currentState, data: newData },
              update: { state: currentState, data: newData }
            });
          } catch (e) {
            logger.warn({ err: e.message }, '[Provider] Failed to persist numeric menu selection');
          }

          // Menu 2 (Program Studi): answer deterministically (avoid slow RAG call).
          // This menu is frequently used and the core content is stable.
          if (effectiveSelection === 2) {
            let answer = null;
              try {
              if (allowBundledIndex) {
                const programs = extractProgramListFromBundledIndex();
                if (programs && programs.length) {
                  const dualDegreeLines = extractDualDegreeListFromBundledIndex();
                  const footer =
                    'Kalau kakak mau, sebutkan prodi + gelombang (jika relevan), nanti saya bantu jelaskan rincian biaya/jadwal yang tertulis.';
                  const msg = buildProgramListMessage(programs, footer, dualDegreeLines);
                  try { console.log('[FAST_AUDIT]', { chatId, allowBundledIndex: !!allowBundledIndex, allowFast: null, hasPrograms: !!(programs && programs.length), hasDualDegreeLines: !!dualDegreeLines }); } catch(e) {}
                  // Some indices may not include the core S1 list; avoid sending an incomplete menu answer.
                  const hasCoreS1 = msg && /(Sistem\s+Informasi|Teknologi\s+Informasi|Bisnis\s+Digital|Sistem\s+Komputer)/i.test(msg);
                  if (msg && hasCoreS1 && !/\(tidak\s+terdeteksi\)/i.test(msg)) answer = msg;
                }
              }
            } catch (e) {
              logger.warn({ err: e.message }, '[Provider] Deterministic program list failed');
            }

            if (!answer) {
              const footer =
                'Kalau kakak mau, sebutkan prodi + gelombang (jika relevan), nanti saya bantu jelaskan rincian biaya/jadwal yang tertulis.';
              answer = buildProgramListMessage(
                [
                  'Sistem Informasi (SI)',
                  'Teknologi Informasi (TI)',
                  'Bisnis Digital (BD)',
                  'Sistem Komputer (SK)'
                ],
                footer
              );
            }

            await sendBotMessage(chatId, answer);
            return res.send({ ok: true, source: 'numeric_menu', selection, label: welcomeLabel || menu.label, fast: true });
          }

          // Menu 3 (Biaya Pendidikan & Skema Pembayaran): always ask for prodi first.
          // This avoids generic replies and yields more accurate RAG queries.
          if (effectiveSelection === 3) {
            try {
              const currentState = session ? session.state : 'root';
              const newData = {
                ...(sessionData || {}),
                lastNumericMenuSelection: selection,
                lastNumericMenuLabel: welcomeLabel || menu.label,
                lastNumericMenuEffectiveSelection: effectiveSelection,
                pendingMenuCost: { ts: new Date().toISOString() }
              };
              await prisma.session.upsert({
                where: { chatId },
                create: { chatId, state: currentState, data: newData },
                update: { state: currentState, data: newData }
              });
            } catch (e) {
              logger.warn({ err: e.message }, '[Provider] Failed to persist pendingMenuCost');
            }

            await sendBotMessage(
              chatId,
              `Baik, Anda memilih: ${menu.label}.\n` +
                'Untuk biaya pendidikan per semester (UKT), kakak mau untuk program apa?\n' +
                'Balas: SI / TI / BD / SK (S1), atau D3, atau S2.\n' +
                'Kalau program Dual Degree, balas: UTB / DNUI / HELP.'
            );
            return res.send({ ok: true, source: 'numeric_menu', selection });
          }

          // Prefer RAG if enabled/training exists.
          let answer = null;
          let answerSource = null;
          if (isRagEnabled()) {
            if (hasActiveTrainingData || allowIndexFallbackNoDb) {
              const topK = parseInt(process.env.RAG_TOP_K || '6', 10);
              const ragResult = await ragQueryWithEval(chatId, menu.ragQuestion, topK, { answerQuestion: menu.ragQuestion, minScore: 0 });
              if (ragResult && ragResult.success && ragResult.answer && contextsLookRelevantForMenu(effectiveSelection, ragResult.contexts)) {
                answer = ragResult.answer;
                answerSource = ragResult.source || null;
              }
            }
          }

          // If RAG doesn't have relevant context (common for Facilities/Career), try web excerpt fallback.
          if (!answer && (effectiveSelection === 5 || effectiveSelection === 6)) {
            try {
              const enableWeb = String(process.env.ENABLE_WEB_SEARCH_FALLBACK || 'false').toLowerCase() === 'true';
              if (enableWeb) {
                const q = effectiveSelection === 5
                  ? 'Fasilitas kampus ITB STIKOM Bali'
                  : effectiveSelection === 6
                    ? 'Prospek karier lulusan ITB STIKOM Bali'
                    : menu.ragQuestion;

                const web = await webSearchFallbackAnswer(q, { seedUrl: process.env.WEB_SEARCH_SEED_URL || 'https://www.stikom-bali.ac.id/id/' });
                if (web && web.ok && web.answer) answer = web.answer;
              }
            } catch (e) {
              logger.warn({ err: e.message }, '[Provider] Numeric menu web fallback failed');
            }
          }

          if (!answer) {
            if (effectiveSelection === 1) {
              // Important: avoid wording that looks like the main welcome menu.
              // We want contextual numeric selection to pick up the next reply (1-4)
              // without being hijacked by the welcome menu handler.
              answer =
                `Baik, Anda memilih: ${menu.label}.\n\n` +
                'Menu PMB:\n' +
                '1) Alur / cara daftar\n' +
                '2) Syarat & dokumen\n' +
                '3) Jadwal PMB\n' +
                '4) Kontak PMB\n\n' +
                'Balas angka 1-4.';

              // Persist a short-lived flag so a fast user reply (race) can still be interpreted.
              try {
                const currentState = session ? session.state : 'root';
                const newData = { ...(sessionData || {}), pendingPmbMenu: { ts: new Date().toISOString() } };
                await prisma.session.upsert({
                  where: { chatId },
                  create: { chatId, state: currentState, data: newData },
                  update: { state: currentState, data: newData }
                });
              } catch (e) {
                logger.warn({ err: e.message }, '[Provider] Failed to persist pendingPmbMenu');
              }
            } else if (effectiveSelection === 5) {
              // Facilities often needs a campus context.
              answer =
                `Baik, Anda memilih: ${menu.label}.\n` +
                'Kakak ingin info fasilitas untuk kampus yang mana? (Denpasar/Renon, Jimbaran, atau Abiansemal)\n' +
                'Atau kakak cari fasilitas tertentu (mis. lab, perpustakaan, wifi, parkir)?';
            } else {
              answer =
                `Baik, Anda memilih: ${menu.label}.\n` +
                `Agar saya jawab tepat, boleh tulis pertanyaan spesifiknya?\n` +
                `Contoh: "jadwal pendaftaran", "syarat pendaftaran", "biaya gelombang 1", atau "program studi yang tersedia".`;
            }
          }

          if (effectiveSelection === 2) {
            const base = String(answer || '');
            const saysSkNotListed = /sistem\s*komputer[\s\S]{0,40}tidak\s*tercantum|\bsk\b[\s\S]{0,20}tidak\s*tercantum/i.test(base);
            const mentionsSk = /(sistem\s*komputer|\bsk\b)/i.test(base);

            // If the model says SK is not listed (or simply omits it), double-check directly from training chunks.
            if (isRagEnabled() && (hasActiveTrainingData || allowIndexFallbackNoDb)) {
              // Prefer deterministic list from bundled index when available (stable, complete).
              if (allowBundledIndex) {
                const programs = extractProgramListFromBundledIndex();
                if (programs && programs.length) {
                  const dualDegreeLines = extractDualDegreeListFromBundledIndex();
                  const footer =
                    'Kalau kakak mau, sebutkan prodi + gelombang (jika relevan), nanti saya bantu jelaskan rincian biaya/jadwal yang tertulis.';
                  const msg = buildProgramListMessage(programs, footer, dualDegreeLines);
                  if (msg) answer = msg;
                }
              }

              const detectedS1 = await detectProgramsFromTrainingViaProbes(ragQuery);
              const detectedNonS1 = await detectNonS1ProgramsFromTrainingViaProbes(ragQuery);

              // If the model is omitting SK or claiming it's not listed, prefer deterministic lists.
              if ((!mentionsSk || saysSkNotListed) && detectedS1 && detectedS1.found && detectedS1.found.length > 0) {
                const footer =
                  'Kalau kakak mau, sebutkan prodi + gelombang (jika relevan), nanti saya bantu jelaskan rincian biaya/jadwal yang tertulis.';
                const programsRaw = [
                  ...(detectedNonS1 && detectedNonS1.found ? detectedNonS1.found.map((p) => p.label) : []),
                  ...(detectedS1 && detectedS1.found ? detectedS1.found.map((p) => p.label) : [])
                ];

                const dd = allowBundledIndex ? extractDualDegreeListFromBundledIndex() : null;
                const built = buildProgramListMessage(programsRaw, footer, dd);
                if (built) answer = built;
              } else if (answer) {
                // Keep existing answer, but ensure the operational list is visible and avoid misleading omissions.
                answer = augmentProgramStudyAnswer(answer);
              }
            } else if (answer) {
              answer = augmentProgramStudyAnswer(answer);
            }
          }

          await sendBotMessage(chatId, answer);

          // If option 4 returns the scholarship overview, persist pendingScholarshipChoice
          // so short follow-ups like "ranking" are interpreted correctly.
          const looksLikeScholarshipOverview = /ada\s+beberapa\s+jenis\s+beasiswa/i.test(String(answer || ''));
          if (effectiveSelection === 4 && (answerSource === 'rag-scholarship-overview' || looksLikeScholarshipOverview)) {
            try {
              const currentState = session ? session.state : 'root';
              const prevData = sessionData || {};
              const newData = {
                ...prevData,
                lastNumericMenuSelection: selection,
                lastNumericMenuLabel: welcomeLabel || (menu && menu.label ? menu.label : 'Beasiswa yang Tersedia'),
                lastNumericMenuEffectiveSelection: effectiveSelection,
                pendingScholarshipChoice: { ts: new Date().toISOString() }
              };
              await prisma.session.upsert({
                where: { chatId },
                create: { chatId, state: currentState, data: newData },
                update: { state: currentState, data: newData }
              });
            } catch (e) {
              logger.warn({ err: e.message }, '[Provider] Failed to persist pendingScholarshipChoice (numeric menu)');
            }
          }

          return res.send({ ok: true, source: 'numeric_menu', selection });
        }
        }
        }
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[Provider] Numeric menu handler failed');
    }
}