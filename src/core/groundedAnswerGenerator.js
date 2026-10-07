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

function extractScoredPassages(semanticFrame, accepted = []) {
  const targetEntities = (semanticFrame.entities || []).map(e => e.canonical || e.name || String(e));
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

      let cleanP = p.replace(/\n(?!\n)/g, ' ').replace(/\s{2,}/g, ' ').trim();
      if (cleanP.length < 20) continue;

      // Conflicting entity sanitization / isolation
      for (const excluded of excludedEntities) {
        if (excluded.length >= 4 && cleanP.toLowerCase().includes(excluded.toLowerCase())) {
          const hasTarget = targetEntities.some(te => cleanP.toLowerCase().includes(te.toLowerCase()));
          if (hasTarget) {
            const sentences = cleanP.split(/(?<=[.?!])\s+/);
            const filteredSentences = sentences.filter(s => !s.toLowerCase().includes(excluded.toLowerCase()));
            cleanP = filteredSentences.join(' ').trim();
          } else {
            cleanP = '';
          }
          break;
        }
      }

      if (!cleanP || cleanP.length < 20) continue;

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

  // 2. Generic Passage-Level Evidence Scoring & Conflicting Entity Filtering
  const passages = extractScoredPassages(semanticFrame, accepted);

  if (passages.length > 0) {
    return `Berdasarkan informasi resmi kampus:\n\n${passages.join('\n\n')}\n\nUntuk konfirmasi lebih lanjut, silakan hubungi layanan resmi kampus.`;
  }

  return `Berdasarkan dokumen resmi yang tersedia:\n\n${accepted[0].text.slice(0, 300).trim()}\n\nUntuk konfirmasi lebih lanjut, silakan hubungi layanan resmi kampus.`;
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
