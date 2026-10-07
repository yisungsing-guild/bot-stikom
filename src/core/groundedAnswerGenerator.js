'use strict';

/**
 * src/core/groundedAnswerGenerator.js
 * 
 * Greenfield Grounded Answer Generator (LLM Synthesis).
 * Contract:
 * - EVIDENCE -> NATURAL LANGUAGE
 * - Synthesizes answers ONLY from verified evidence.
 * - Does not use parametric knowledge to invent facts.
 * - Does not leak raw chunks verbatim.
 */

const { AIReplyEngine } = require('../engine/aiEngine');
const logger = require('../logger');

let aiEngineInstance = null;
function getAiEngine() {
  if (!aiEngineInstance) {
    aiEngineInstance = new AIReplyEngine(process.env.OPENAI_API_KEY);
  }
  return aiEngineInstance;
}

let openaiCircuitOpen = false;

function buildSynthesisPrompt(semanticFrame, evidenceList = []) {
  const contextSnippet = evidenceList
    .map((e, idx) => `[Bukti ${idx + 1}] (Sumber: ${e.source || 'dokumen resmi'}):\n${e.text.trim()}`)
    .join('\n\n');

  return {
    systemPrompt: `Kamu adalah asisten resmi kampus ITB STIKOM Bali.
Tugasmu adalah menyusun jawaban ramah dan faktual HANYA berdasarkan BUKTI yang diberikan.

ATURAN KETAT:
1. Gunakan HANYA informasi yang ada di [Bukti]. DILARANG mengarang fakta atau menambahkan informasi di luar teks.
2. Jika ada nama kampus/prodi/entitas, gunakan persis seperti pada teks bukti.
3. Jawab dalam Bahasa Indonesia yang sopan, terstruktur, dan mudah dibaca melalui WhatsApp.
4. Jangan menyalin dokumen secara mentah dalam bentuk tag teknis atau kode database.
5. Jawab seluruh poin pertanyaan pengguna secara lengkap.`,
    userPrompt: `Pertanyaan Pengguna: "${semanticFrame.rawQuery}"

BUKTI YANG TERSEDIA:
${contextSnippet}

Jawabanmu:`
  };
}

function isolateTargetPassages(text, targetEntities = [], excludedEntities = []) {
  if (!text || targetEntities.length === 0 || excludedEntities.length === 0) {
    return [text];
  }

  const markers = [];

  // Find target matches as headings/titles
  for (const te of targetEntities) {
    const base = te.replace(/^(S1|D3|S2)\s+/i, '');
    const patterns = [
      te.replace(/\s+/g, '\\s+'),
      base.replace(/\s+/g, '\\s+')
    ];
    for (const pat of patterns) {
      const r = new RegExp('(?:^|\\n|•|\\d+\\.|(?:Program\\s+Studi|Prodi)\\s+)\\s*(' + pat + ')(?:\\s*\\((?:S1|D3|S2)\\)|\\s*:|\\s*\\|)?', 'gi');
      let m;
      while ((m = r.exec(text)) !== null) {
        markers.push({ isTarget: true, entity: te, index: m.index, match: m[0] });
      }
    }
  }

  const targetBases = targetEntities.map(te => te.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase());

  // Find excluded matches as headings/titles
  for (const ex of excludedEntities) {
    const base = ex.replace(/^(S1|D3|S2)\s+/i, '');
    const isTargetBase = targetBases.some(tb => tb === base.toLowerCase() || tb === ex.toLowerCase());

    // If this excluded entity shares base name with target (e.g. S2 vs S1 Sistem Informasi),
    // only exclude the full qualified name (e.g. S2 Sistem Informasi), NEVER the shared base!
    const patterns = isTargetBase 
      ? [ex.replace(/\s+/g, '\\s+')]
      : [ex.replace(/\s+/g, '\\s+'), base.replace(/\s+/g, '\\s+')];

    for (const pat of patterns) {
      const r = new RegExp('(?:^|\\n|•|\\d+\\.|(?:Program\\s+Studi|Prodi)\\s+)\\s*(' + pat + ')(?:\\s*\\((?:S1|D3|S2)\\)|\\s*:|\\s*\\|)?', 'gi');
      let m;
      while ((m = r.exec(text)) !== null) {
        markers.push({ isTarget: false, entity: ex, index: m.index, match: m[0] });
      }
    }
  }

  if (markers.length === 0 || !markers.some(m => !m.isTarget)) {
    return [text];
  }

  // Sort and prioritize isTarget over excluded when overlapping
  markers.sort((a, b) => {
    if (Math.abs(a.index - b.index) <= 5) {
      return a.isTarget ? -1 : 1;
    }
    return a.index - b.index;
  });

  // Deduplicate overlapping markers within 10 chars
  const deduped = [];
  for (const m of markers) {
    if (deduped.length === 0 || m.index > deduped[deduped.length - 1].index + 10) {
      deduped.push(m);
    }
  }

  const targetPassages = [];
  for (let i = 0; i < deduped.length; i++) {
    const current = deduped[i];
    if (current.isTarget) {
      const start = current.index;
      const end = (i + 1 < deduped.length) ? deduped[i + 1].index : text.length;
      const passage = text.slice(start, end).replace(/\s+/g, ' ').trim();
      if (passage.length > 20) {
        targetPassages.push(passage);
      }
    }
  }

  // INVARIANT: If this chunk contains conflicting sibling programs and target passage
  // could not be cleanly isolated, REJECT the ambiguous passage (do NOT fallback to whole chunk!)
  if (targetPassages.length === 0 && markers.some(m => !m.isTarget)) {
    return [];
  }

  return targetPassages.length > 0 ? targetPassages : [text];
}

function extractScoredPassages(semanticFrame, accepted = []) {
  const targetEntities = (semanticFrame.entities || []).map(e => e.canonical || e.name || String(e));
  const targetBases = targetEntities.map(te => te.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase());
  const excludedEntities = (semanticFrame.retrievalPlan && semanticFrame.retrievalPlan.excludedConflictingEntities) || [];
  const queryTokens = (semanticFrame.normalizedQuery || '')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !['apa', 'ada', 'itu', 'di', 'ke', 'dari', 'untuk', 'yang'].includes(t));

  const candidateBlocks = [];

  for (const chunk of accepted) {
    const raw = (chunk.text || '').replace(/&amp;/g, '&');
    const paragraphs = raw.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

    for (let p of paragraphs) {
      if (/^ringkasan dokumen|^no\./i.test(p)) continue;

      const isolatedPassages = isolateTargetPassages(p, targetEntities, excludedEntities);
      for (const cleanP of isolatedPassages) {
        if (!cleanP || cleanP.length < 20) continue;

        // Double check no conflicting sibling entity in the isolated passage
        let hasConflict = false;
        for (const excluded of excludedEntities) {
          if (!excluded || excluded.length < 3) continue;

          // Check full excluded entity match (e.g. D3 Manajemen Informatika, S1 Bisnis Digital)
          const escaped = excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`\\b${escaped}\\b`, 'i').test(cleanP)) {
            hasConflict = true;
            break;
          }

          const base = excluded.replace(/^(S1|D3|S2)\s+/i, '');
          const isTargetBase = targetBases.some(tb => tb === base.toLowerCase() || tb === excluded.toLowerCase());
          if (isTargetBase) {
            const isS2Sibling = new RegExp(`\\b(?:S2|Magister)\\s+${base}\\b`, 'i').test(cleanP);
            if (isS2Sibling) {
              hasConflict = true;
              break;
            }
          } else {
            const isSiblingTitle = new RegExp(`(?:^|\\n|•|\\d+\\.|(?:Program\\s+Studi|Prodi)\\s+)\\s*${base}\\b`, 'i').test(cleanP) ||
              new RegExp(`\\b${base}\\s*\\((?:S1|D3|S2)\\)`, 'i').test(cleanP);
            if (isSiblingTitle) {
              hasConflict = true;
              break;
            }
          }
        }
        if (hasConflict) continue;

        let score = 0;
        const lowerP = cleanP.toLowerCase();

        for (const te of targetEntities) {
          if (lowerP.includes(te.toLowerCase())) score += 10;
          const teTokens = te.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
          for (const t of teTokens) {
            if (lowerP.includes(t)) score += 2;
          }
        }

        for (const qt of queryTokens) {
          if (lowerP.includes(qt)) score += 1;
        }

        candidateBlocks.push({ text: cleanP, score });
      }
    }
  }

  candidateBlocks.sort((a, b) => b.score - a.score);
  const selectedPassages = [];
  for (const block of candidateBlocks) {
    if (!selectedPassages.includes(block.text) && selectedPassages.length < 4) {
      selectedPassages.push(block.text);
    }
  }
  return selectedPassages;
}

function buildGroundedDeterministicSummary(semanticFrame, accepted = []) {
  if (!accepted || accepted.length === 0) return null;

  const rawQuery = (semanticFrame.rawQuery || '').toLowerCase();
  const cleanAll = accepted.map(a => a.text).join('\n\n').replace(/&amp;/g, '&');
  const targetEntities = (semanticFrame.entities || []).map(e => e.canonical || e.name || String(e));
  const entityLabel = targetEntities[0] || 'program terkait';

  // 1. Generic progression / stages / scheme inquiry
  const isSchemeOrLocationInquiry = /full di|skema|tahap|lokasi|tempat kuliah|di mana|onsite|online/i.test(rawQuery);
  const stages = [];
  const stageMatches = cleanAll.matchAll(/(Tahun\s*[\d&,\s]+|Tahap\s*[\d&,\s]+|Semester\s*[\dIVX]+)\s*:\s*([^]+?)(?=(?:Tahun\s*[\d&,\s]+|Tahap\s*[\d&,\s]+|Semester\s*[\dIVX]+)\s*:|Selama|Setelah|\n\n|$)/gi);
  for (const m of stageMatches) {
    const stageTitle = m[1].trim();
    const stageDesc = m[2].replace(/\s+/g, ' ').trim();
    const line = `${stageTitle}: ${stageDesc}`;
    if (!stages.includes(line) && stageDesc.length > 10 && stages.length < 5) {
      stages.push(line);
    }
  }

  if (isSchemeOrLocationInquiry && stages.length > 0) {
    let answer = `Berdasarkan informasi resmi ${entityLabel}:\n\n`;
    if (/full di/i.test(rawQuery) && (cleanAll.toLowerCase().includes('tidak full') || /onsite|luar negeri|kampus mitra/i.test(cleanAll))) {
      answer += `Perkuliahan **tidak full di STIKOM Bali**.\n\n`;
    }
    answer += `Skema perkuliahan dirancang secara bertahap:\n`;
    for (const st of stages) {
      answer += `- **${st}**\n`;
    }
    const facilityMatch = cleanAll.match(/(?:Selama menjalani|fasilitas dormitory|fasilitas asrama)[^\.\n]+/i);
    if (facilityMatch) {
      answer += `\n${facilityMatch[0].trim()}.`;
    }
    return answer;
  }

  // 2. Generic Tuition Fee Summary
  const isFeeInquiry = semanticFrame.domain === 'TUITION_FEE' || 
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)));

  if (isFeeInquiry) {
    const feeItems = [
      { label: 'Biaya Pendaftaran', re: /Pendaftaran\s+([0-9\.,]+)/i },
      { label: 'Dana Pendidikan Pokok (DPP)', re: /(?:Dana Pendidikan Pokok|\(DPP\))\s+([0-9\.,]+)(?:\s+(Dicicil[^\n\.\,]+))?/i },
      { label: 'Biaya Pendidikan Per Semester', re: /Biaya Pendidikan Per Semester\s+([0-9\.,]+)(?:\s+([^\n\.]+))?/i },
      { label: 'Jas, Topi Almamater & GMTI', re: /(?:Jas[^\n\d]+|Kaos[^\n\d]+)\s+([0-9\.,]+)/i },
      { label: 'Biaya Pengalaman Industri', re: /Biaya Pengalaman Industri\s+([^\n]+(?:\n\s*-\s*[^\n]+)*)/i }
    ];

    function extractFeeForEntity(text) {
      const lines = [];
      for (const item of feeItems) {
        const match = text.match(item.re);
        if (match) {
          let val = match[1].trim();
          let extra = match[2] ? ` (${match[2].trim()})` : '';
          if (/^\d+/.test(val)) val = `Rp ${val}`;
          const line = `- **${item.label}**: ${val}${extra}`;
          if (!lines.some(l => l.includes(item.label))) {
            lines.push(line);
          }
        }
      }
      return lines;
    }

    if (targetEntities.length > 1) {
      const entityFeeBlocks = [];
      for (const ent of targetEntities) {
        const entBase = ent.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase();
        const entChunks = accepted.filter(c => {
          const t = (c.text || '').toLowerCase();
          const sf = (c.source_file || '').toLowerCase();
          const ce = (c.contextEntities || []).map(x => x.toLowerCase());
          return t.includes(ent.toLowerCase()) || 
                 sf.includes(entBase) || 
                 ce.includes(ent.toLowerCase());
        });
        const entText = entChunks.map(c => c.text).join('\n\n');
        const lines = extractFeeForEntity(entText);
        if (lines.length > 0) {
          entityFeeBlocks.push(`**${ent}**:\n` + lines.join('\n'));
        }
      }
      if (entityFeeBlocks.length > 0) {
        let compAnswer = `Berdasarkan perbandingan rincian biaya pendidikan resmi:\n\n`;
        compAnswer += entityFeeBlocks.join('\n\n');
        compAnswer += `\n\nUntuk informasi beasiswa potongan DPP dan tata cara pembayaran lebih lanjut, silakan hubungi layanan admisi/PMB ITB STIKOM Bali.`;
        return compAnswer;
      }
    }

    const feeLines = extractFeeForEntity(cleanAll);
    if (feeLines.length > 0) {
      let feeAnswer = `Berdasarkan rincian biaya pendidikan resmi untuk **${entityLabel}**:\n\n`;
      feeAnswer += feeLines.join('\n');
      feeAnswer += `\n\nUntuk informasi beasiswa potongan DPP dan tata cara pembayaran lebih lanjut, silakan hubungi layanan admisi/PMB ITB STIKOM Bali.`;
      return feeAnswer;
    }
  }

  // 3. Generic Academic Program Overview / Comparison
  if (semanticFrame.domain === 'ACADEMIC_PROGRAM' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['overview', 'definition', 'curriculum_difference', 'career_prospects'].includes(a)))) {
    const passages = extractScoredPassages(semanticFrame, accepted);
    if (passages.length > 0) {
      const prefix = semanticFrame.intent === 'PROGRAM_COMPARISON' || targetEntities.length > 1
        ? `Berdasarkan profil program studi resmi:\n\n`
        : `Berdasarkan profil program studi resmi **${entityLabel}**:\n\n`;
      let overviewAnswer = prefix;
      overviewAnswer += passages.slice(0, 3).join('\n\n');
      overviewAnswer += `\n\nUntuk informasi kurikulum dan pendaftaran lebih lanjut, silakan hubungi bagian admisi kampus.`;
      return overviewAnswer;
    }
  }

  // 4. Generic Passage-Level Evidence Scoring & Conflicting Entity Filtering
  const passages = extractScoredPassages(semanticFrame, accepted);

  if (passages.length > 0) {
    return `Berdasarkan informasi resmi kampus:\n\n${passages.join('\n\n')}\n\nUntuk konfirmasi lebih lanjut, silakan hubungi layanan resmi kampus.`;
  }

  // INVARIANT: Never fallback to raw unisolated chunk if passages could not be cleanly extracted
  return null;
}

async function synthesizeAnswer(semanticFrame, arbitratedEvidence = {}) {
  const accepted = arbitratedEvidence.accepted || [];
  if (accepted.length === 0) {
    return {
      success: false,
      answer: null,
      reason: 'no_accepted_evidence'
    };
  }

  const { systemPrompt, userPrompt } = buildSynthesisPrompt(semanticFrame, accepted);

  try {
    const engine = getAiEngine();
    if (!engine || !engine.apiKey || openaiCircuitOpen) {
      const synthesizedText = buildGroundedDeterministicSummary(semanticFrame, accepted);
      return {
        success: true,
        answer: synthesizedText,
        source: 'grounded_deterministic_summary'
      };
    }

    const completion = await engine.client.chat.completions.create({
      model: engine.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 600,
      temperature: 0.1
    });

    const reply = completion.choices?.[0]?.message?.content || '';
    return {
      success: true,
      answer: reply.trim(),
      source: 'llm_grounded_synthesis'
    };
  } catch (err) {
    if (err.status === 429 || /credits|quota|rate limit/i.test(err.message)) {
      openaiCircuitOpen = true;
    }
    logger.warn({ err: err.message }, '[GroundedAnswerGenerator] LLM synthesis fallback to grounded summary');
    const synthesizedText = buildGroundedDeterministicSummary(semanticFrame, accepted);
    return {
      success: true,
      answer: synthesizedText,
      source: 'grounded_deterministic_summary',
      llmError: err.message
    };
  }
}

module.exports = {
  buildSynthesisPrompt,
  synthesizeAnswer
};
