const { detectKnowledgeDomain } = require('../../src/engine/domainClassifier');
const ragScoped = require('../../src/engine/ragScoped');
const fs = require('fs');

const MIN_DOMAIN_SCORE = parseFloat(process.env.MIN_DOMAIN_SCORE || '0.25');

function isGreeting(text){
  if (!text) return false;
  const t = String(text).trim().toLowerCase();
  return /^(halo|hi|hai|hei|helo|hallo|selamat pagi|selamat siang|selamat sore)\b/i.test(t) || ['halo','hi','hai','hei','hallo'].includes(t);
}

function isShortFollowup(text){
  if (!text) return false;
  const t = String(text).trim();
  if (t.length === 0) return false;
  const words = t.split(/\s+/).filter(Boolean);
  return t.length <= 80 || words.length <= 6;
}

async function handleMessage(sessionData, chatId, text){
  const detectedDomain = detectKnowledgeDomain(text);
  let activeDomain = sessionData.activeDomain || null;
  let retrievedCategories = [];
  let topScore = null;
  let fallbackReason = null;
  let finalResponseSource = null;
  let finalAnswer = null;

  console.log('\n> USER:', text);
  console.log('  session.activeDomain before:', sessionData.activeDomain || null);

  if (isGreeting(text)){
    finalResponseSource = 'greeting';
    finalAnswer = 'Halo! Ada yang bisa saya bantu terkait program atau beasiswa?';
    // do not call RAG
    retrievedCategories = [];
    topScore = null;
    fallbackReason = null;
  } else {
    // PRIORITAS: explicit classifier domain ALWAYS wins; else reuse session for ambiguous short followups
    let useDomain = null;
    if (detectedDomain && detectedDomain !== 'unknown') {
      useDomain = detectedDomain;
    } else if (isShortFollowup(text) && activeDomain) {
      useDomain = activeDomain;
    }

    // If useDomain set, call ragScoped with category
    let ragResult = null;
    if (useDomain) {
      ragResult = await ragScoped.queryScoped({ query: text, category: useDomain, topK: 3, options: { answerQuestion: text } });
      // extract debug info
      topScore = ragResult && (ragResult.confidenceScore || (ragResult.debug && ragResult.debug.topScore) || ragResult.score) || 0;
      retrievedCategories = ragResult && ragResult.debug && ragResult.debug.retrievedCategories ? ragResult.debug.retrievedCategories : (ragResult && Array.isArray(ragResult.contexts) ? ragResult.contexts.map(c => c && c.metadata && c.metadata.category).filter(Boolean) : []);

      if (topScore >= MIN_DOMAIN_SCORE) {
        finalResponseSource = 'domain-scoped';
        finalAnswer = `Menjawab dalam konteks domain=${useDomain}. Found ${retrievedCategories.join(', ')} (score=${topScore.toFixed(3)})`;
        // persist activeDomain ONLY when it was an explicit classifier detection
        if (detectedDomain && detectedDomain !== 'unknown' && detectedDomain === useDomain) {
          sessionData.activeDomain = useDomain;
          sessionData.activeDomainAt = new Date().toISOString();
        }
      } else {
        // fallback to broad rag
        fallbackReason = 'low_domain_score';
        finalResponseSource = 'fallback-rag';
        // call ragScoped without category to allow broad
        const fallback = await ragScoped.queryScoped({ query: text, category: null, topK: 3, options: { answerQuestion: text } });
        const fTop = fallback && (fallback.confidenceScore || (fallback.debug && fallback.debug.topScore) || fallback.score) || 0;
        const fCats = fallback && fallback.debug && fallback.debug.retrievedCategories ? fallback.debug.retrievedCategories : (fallback && Array.isArray(fallback.contexts) ? fallback.contexts.map(c => c && c.metadata && c.metadata.category).filter(Boolean) : []);
        topScore = fTop;
        retrievedCategories = fCats;
        finalAnswer = `Fallback to broad RAG. topScore=${topScore.toFixed(3)}, categories=${retrievedCategories.join(', ')}`;
      }
    } else {
      // No domain to enforce; call ragScoped broad
      ragResult = await ragScoped.queryScoped({ query: text, category: null, topK: 3, options: { answerQuestion: text } });
      topScore = ragResult && (ragResult.confidenceScore || (ragResult.debug && ragResult.debug.topScore) || ragResult.score) || 0;
      retrievedCategories = ragResult && ragResult.debug && ragResult.debug.retrievedCategories ? ragResult.debug.retrievedCategories : (ragResult && Array.isArray(ragResult.contexts) ? ragResult.contexts.map(c => c && c.metadata && c.metadata.category).filter(Boolean) : []);
      finalResponseSource = 'broad-rag';
      finalAnswer = `Broad RAG result (score=${topScore.toFixed(3)}) categories=${retrievedCategories.join(', ')}`;
      // If the broad RAG result suggests a strong domain, set activeDomain
      if (detectedDomain && detectedDomain !== 'unknown' && topScore >= MIN_DOMAIN_SCORE) {
        sessionData.activeDomain = detectedDomain;
        sessionData.activeDomainAt = new Date().toISOString();
      }
    }
  }

  // Required debug output
  console.log('  debug:', {
    detectedDomain,
    activeDomain: sessionData.activeDomain || null,
    retrievedCategories,
    topScore: topScore !== null ? Number(topScore.toFixed ? topScore.toFixed(4) : topScore) : null,
    fallbackReason,
    finalResponseSource
  });

  console.log('  BOT:', finalAnswer);
  return { sessionData, finalAnswer };
}

async function runFlows(){
  const sessionData = {}; // in-memory session
  const chatId = 'SIM-001';

  console.log('\n=== FLOW 1 — GREETING ===');
  await handleMessage(sessionData, chatId, 'halo');
  await handleMessage(sessionData, chatId, 'masih bingung pilih jurusan');

  console.log('\n=== FLOW 2 — DOUBLE DEGREE ===');
  await handleMessage(sessionData, chatId, 'jelaskan double degree');
  await handleMessage(sessionData, chatId, 'yang internasional gimana?');

  console.log('\n=== FLOW 3 — SCHOLARSHIP ===');
  await handleMessage(sessionData, chatId, 'ada beasiswa?');
  await handleMessage(sessionData, chatId, 'full atau partial?');

  console.log('\n=== FLOW 4 — INTERNATIONAL PROGRAM ===');
  await handleMessage(sessionData, chatId, 'kelas internasional ada?');
  await handleMessage(sessionData, chatId, 'exchange juga ada?');

  console.log('\nSimulation complete');
}

runFlows().catch(e => { console.error('Simulation failed', e && e.message ? e.message : e); process.exit(1); });
