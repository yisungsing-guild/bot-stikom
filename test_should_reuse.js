const PROGRAM_HINT_STALE_MINUTES = 120;
function normalizeProgramHint(raw) {
  const t = String(raw || '').trim();
  return t ? t : null;
}
function getSessionProgramHint(session) {
  if (!session || typeof session !== 'object') return null;
  return normalizeProgramHint(session.currentProgramHint) || normalizeProgramHint(session.lastProgramHint) || null;
}
function getSessionProgramHintTimestamp(session) {
  if (!session || typeof session !== 'object') return null;
  const tsRaw = session.updatedAt || session.lastProgramHintAt;
  const ts = tsRaw ? new Date(String(tsRaw)) : null;
  return ts && !Number.isNaN(ts.getTime()) ? ts : null;
}
function isProgramHintFresh(session) {
  const ts = getSessionProgramHintTimestamp(session);
  const result = ts ? ((Date.now() - ts.getTime()) / 60000) <= PROGRAM_HINT_STALE_MINUTES : false;
  return result;
}
function parseS1ProgramChoice(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  if (/\b(sistem\s+informasi|\bsi\b)\b/i.test(t)) return 'Sistem Informasi';
  if (/\b(teknologi\s+informasi|\bti\b)\b/i.test(t)) return 'Teknologi Informasi';
  if (/\b(bisnis\s+digital|\bbd\b)\b/i.test(t)) return 'Bisnis Digital';
  if (/\b(sistem\s+komputer|sistemkomputer|\bsk\b)\b/i.test(t)) return 'Sistem Komputer';
  return null;
}
function extractProgramHint(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  const explicitProgramInProdi = /(program\s+studi|prodi)\s*(?:yang\s+)?(?:adalah\s+)?\s*(sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer)\b/i.exec(t);
  if (explicitProgramInProdi && explicitProgramInProdi[2]) {
    const program = explicitProgramInProdi[2].toLowerCase();
    if (program.includes('teknologi informasi')) return 'Teknologi Informasi';
    if (program.includes('sistem informasi')) return 'Sistem Informasi';
    if (program.includes('bisnis digital')) return 'Bisnis Digital';
    if (program.includes('sistem komputer')) return 'Sistem Komputer';
  }
  if (/teknologi\s+informasi/i.test(t)) return 'Teknologi Informasi';
  if (/sistem\s+informasi/i.test(t)) return 'Sistem Informasi';
  if (/bisnis\s+digital/i.test(t)) return 'Bisnis Digital';
  if (/sistem\s+komputer/i.test(t)) return 'Sistem Komputer';
  const abbr = /(program\s+studi|prodi)\s*[:\-]?\s*(ti|si|bd|sk)\b/i.exec(t);
  if (abbr && abbr[2]) {
    const code = abbr[2].toLowerCase();
    if (code === 'ti') return 'Teknologi Informasi';
    if (code === 'si') return 'Sistem Informasi';
    if (code === 'bd') return 'Bisnis Digital';
    if (code === 'sk') return 'Sistem Komputer';
  }
  const hasProgramContext = /\b(biaya|pendaftaran|registrasi|rincian|detail|dpp|semester|gelombang|kuliah|uang\s+kuliah)\b/i.test(t) || /\b(program\s+studi|prodi|jurusan)\b/i.test(t);
  if (hasProgramContext) {
    const loose = /\b(ti|si|bd|sk)\b/i.exec(t);
    if (loose && loose[1]) {
      const code = loose[1].toLowerCase();
      if (code === 'ti') return 'Teknologi Informasi';
      if (code === 'si') return 'Sistem Informasi';
      if (code === 'bd') return 'Bisnis Digital';
      if (code === 'sk') return 'Sistem Komputer';
    }
  }
  return null;
}
function extractNonS1ProgramHint(text) {
  const t = String(text || '').toLowerCase().replace(/\s{2,}/g, ' ').trim();
  if (!t) return null;
  if (/\b(d3|diploma)\b/i.test(t) || /manajemen\s+informatika/i.test(t)) return 'D3 Manajemen Informatika';
  if (/\b(s2|pascasarjana|pasca\s*sarjana|magister|master)\b/i.test(t)) return 'S2 Sistem Informasi (SI)';
  return null;
}
function extractSpecificProgramHint(text) {
  return extractNonS1ProgramHint(text) || /*extractSpecificDualDegreeProgramHint*/ null || parseS1ProgramChoice(text) || extractProgramHint(text) || null;
}
function extractExplicitProgramHint(msg) {
  const t = String(msg || '').trim();
  if (!t) return null;
  const explicit = (typeof extractSpecificProgramHint === 'function' && extractSpecificProgramHint(t))
    || (typeof parseS1ProgramChoice === 'function' && parseS1ProgramChoice(t))
    || (typeof extractNonS1ProgramHint === 'function' && extractNonS1ProgramHint(t))
    || (typeof extractProgramHint === 'function' && extractProgramHint(t));
  if (explicit) return explicit;
  const normalized = t.toLowerCase();
  if (/(^|\s)(si|ti|bd|sk)(\s|\?|$)/i.test(normalized)) {
    return (typeof parseS1ProgramChoice === 'function' && parseS1ProgramChoice(t)) || null;
  }
  if (/(teknologi\s+informasi|sistem\s+informasi|bisnis\s+digital|sistem\s+komputer)/i.test(normalized)) {
    return (typeof extractProgramHint === 'function' && extractProgramHint(t)) || null;
  }
  return null;
}
function isExplicitProgramTopic(text) {
  const explicit = extractExplicitProgramHint(text);
  return !!(explicit && String(text || '').trim().length > 0);
}
function inferContextualFollowup(msg, session) {
  try {
    const t = String(msg || '').trim();
    if (!t) return false;
    const words = t.split(/\s+/).filter(Boolean);
    const short = t.length <= 60 || words.length <= 3;
    const explicitProg = extractExplicitProgramHint(t);
    const result = short && !explicitProg && !/^\d+$/.test(t) && !/\b(admin|cs|komplain|complain)\b/i.test(t);
    console.log('INFER_CONTEXTUAL_FOLLOWUP', {msg:t,words,short,explicitProg,result});
    return result;
  } catch (e) { return false; }
}
function shouldReuseConversationContext(msg, session) {
  try {
    if (isExplicitProgramTopic(msg)) return false;
    const isFollowup = inferContextualFollowup(msg, session);
    const hasSession = !!session;
    const menuActive = !!(session && session.numericMenuActive);
    const currentHint = getSessionProgramHint(session);
    const fresh = currentHint && isProgramHintFresh(session);
    const pendingSelection = session && session.pendingProgramSelection && session.pendingProgramSelection.ts;
    const pendingFresh = pendingSelection ? ((Date.now() - new Date(session.pendingProgramSelection.ts).getTime()) / 60000) <= 30 : false;
    console.log('SHOULD_REUSE_CONDITIONS', {msg, isFollowup, hasSession, menuActive, currentHint, fresh, pendingFresh, explicitTopic: isExplicitProgramTopic(msg), sessionData: session && { lastProgramHint: session.lastProgramHint, currentProgramHint: session.currentProgramHint, updatedAt: session.updatedAt, lastProgramHintAt: session.lastProgramHintAt}});
    if (!isFollowup) return false;
    if (!hasSession) return false;
    if (menuActive) return false;
    if (fresh) return true;
    if (pendingFresh) return true;
    return false;
  } catch (e) {
    console.error('ERR', e);
    return false;
  }
}

const session = {
  lastProgramHint: 'Teknologi Informasi',
  currentProgramHint: 'Teknologi Informasi',
  updatedAt: new Date().toISOString(),
  lastProgramHintAt: new Date().toISOString()
};
console.log('explicitTopic beasiswa ada?', isExplicitProgramTopic('beasiswa ada?'));
console.log('reuse beasiswa ada?', shouldReuseConversationContext('beasiswa ada?', session));
console.log('followup beasiswa ada?', inferContextualFollowup('beasiswa ada?', session));
console.log('explicitTopic kelas malam?', isExplicitProgramTopic('kelas malam?'));
console.log('reuse kelas malam?', shouldReuseConversationContext('kelas malam?', session));
console.log('followup kelas malam?', inferContextualFollowup('kelas malam?', session));
