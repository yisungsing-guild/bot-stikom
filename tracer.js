const Module = require('module');
const fs = require('fs');
const path = require('path');
const orig = Module._extensions['.js'];

Module._extensions['.js'] = function(module, filename) {
  try {
    const norm = filename.replace(/\\\\/g,'/').replace(/\\/g,'/');
    // Debug: report provider-like module loads so we can see actual path
    try { if (norm.toLowerCase().indexOf('provider') !== -1) console.error('[tracer] module load', norm); } catch(e) {}

    // Match provider module path in a platform-tolerant way
    if (norm.indexOf('/src/') !== -1 && norm.indexOf('/routes/') !== -1 && norm.indexOf('/provider.js') !== -1) {
      let src = fs.readFileSync(filename, 'utf8');

      // 1) Log existing session state right after sessionData assignment
      const sessionMarker = "let sessionData = (session && session.data) ? session.data : {};";
      if (src.indexOf(sessionMarker) !== -1) {
        src = src.replace(sessionMarker, sessionMarker + "\ntry { console.log('[TRACE] existing_session_state', { chatId: chatId, lastProgramHint: sessionData && sessionData.lastProgramHint, activeProgramContext: sessionData && sessionData.activeProgramContext, pendingRagCandidate: sessionData && sessionData.pendingRagCandidate }); } catch (e) {}\n");
      }

      // 2) Log followup detection right after isFollowup assignment
      const isFollowupMarker = 'const isFollowup = isLikelyFollowupQuestion(text) && askedFollowup;';
      if (src.indexOf(isFollowupMarker) !== -1) {
        src = src.replace(isFollowupMarker, isFollowupMarker + "\ntry { console.log('[TRACE] followup_detection', { chatId: chatId, text: String(text || '').slice(0,200), askedFollowup, isFollowup }); } catch(e) {}\n");
      }

      // 3) Log rag decision after ragResult computed (insert before cross-division fallback)
      const crossDivMarker = '// Cross-division fallback:';
      if (src.indexOf(crossDivMarker) !== -1) {
        src = src.replace(crossDivMarker, "console.log('[TRACE] rag_decision', { chatId: chatId, ragSource: ragResult && ragResult.source, ragAnswerSnippet: ragResult && String(ragResult.answer).slice(0,200) });\n" + crossDivMarker);
      }

      // 4) Log semantic persist evaluation after the const block
      const spsMarker = 'const shouldPersistSemanticSuggestion = (';
      const spsIdx = src.indexOf(spsMarker);
      if (spsIdx !== -1) {
        const endIdx = src.indexOf(');', spsIdx);
        if (endIdx !== -1) {
          const insertionPoint = endIdx + 2;
          const snippet = "\ntry { console.log('[TRACE] semantic_persist_evaluation', { chatId: chatId, shouldPersistSemanticSuggestion: typeof shouldPersistSemanticSuggestion !== 'undefined' ? !!shouldPersistSemanticSuggestion : null, lastProgramHint: sessionData && sessionData.lastProgramHint, activeProgramContext: sessionData && sessionData.activeProgramContext, pendingRagCandidate: sessionData && sessionData.pendingRagCandidate, isLikelyFollowup_trimmed: (typeof isLikelyFollowupQuestion === 'function' ? isLikelyFollowupQuestion(trimmed) : null) }); } catch(e) {}\n";
          src = src.slice(0, insertionPoint) + snippet + src.slice(insertionPoint);
        }
      }

      // 5) Report final source for known early returns
      src = src.replace(/return res.send\(\{ ok: true, ragUsed: true, source: 'pending_rag_candidate' \}\);/g, "console.log('[TRACE] final_source', { chatId: chatId, source: 'pending_rag_candidate' });\nreturn res.send({ ok: true, ragUsed: true, source: 'pending_rag_candidate' });");
      src = src.replace(/return res.send\(\{ ok: true, source: 'pending_semantic_suggestion' \}\);/g, "console.log('[TRACE] final_source', { chatId: chatId, source: 'pending_semantic_suggestion' });\nreturn res.send({ ok: true, source: 'pending_semantic_suggestion' });");

      return module._compile(src, filename);
    }
  } catch (e) {
    // Fall back to original loader on error
    try { console.error('[tracer] injection error', e && e.message ? e.message : e); } catch (e) {}
  }
  return orig(module, filename);
};

// Also add a small prefix to console.log so traces are easy to grep
try {
  const origLog = console.log;
  console.log = function() {
    origLog.apply(console, ['[TRACER]', new Date().toISOString()].concat(Array.from(arguments)));
  };
} catch (e) {}
