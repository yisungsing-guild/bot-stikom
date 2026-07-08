/**
 * UserProfileManager: Track long-term user traits, concerns, preferences
 * Used by Composer to make contextualized, continuity-aware recommendations
 */

/**
 * Infer emotional state from user message and conversation history
 * @param {string} userQuery - Current user message
 * @param {Array} recentMessages - Last 6-8 bot/user turns
 * @returns {Object} emotionalState inference
 */
function inferEmotionalState(userQuery = '', recentMessages = []) {
  const query = String(userQuery || '').toLowerCase();
  
  // Emotional markers
  const anxietyMarkers = /\b(takut|khawatir|nervous|cemas|stress|panik|gelisah|deg-degan|gugup)\b/;
  const concernMarkers = /\b(susah|repot|berat|sulit|khawatir|takut)\b/;
  const insecurityMarkers = /\b(gak kuat|tidak sanggup|tidak mampu|terlalu berat|mustahil|hopeless|putus asa|pesimis|nggak yakin|tidak yakin)\b/;
  const confusionMarkers = /\b(bingung|nggak ngerti|gak paham|kurang mengerti|tidak mengerti|tidak tahu|gimana caranya|gmn caranya|apa maksudnya|jelasin|explain)\b/;
  const overwhelmMarkers = /\b(terlalu banyak|ribet|rumit|kompleks|challenging|melelahkan)\b/;
  const excitementMarkers = /\b(excited|antusias|seru|menarik|bagus|keren|wow|oke|siap|semangat|excited)\b/;
  
  const states = [];
  let confidence = 0;
  
  if (anxietyMarkers.test(query)) {
    states.push({ emotion: 'anxious', reason: 'anxiety_markers' });
    confidence = Math.max(confidence, 0.8);
  }
  if (concernMarkers.test(query)) {
    states.push({ emotion: 'concerned', reason: 'concern_markers' });
    confidence = Math.max(confidence, 0.8);
  }
  if (insecurityMarkers.test(query)) {
    states.push({ emotion: 'insecure', reason: 'insecurity_markers' });
    confidence = Math.max(confidence, 0.85);
  }
  if (confusionMarkers.test(query)) {
    states.push({ emotion: 'confused', reason: 'confusion_markers' });
    confidence = Math.max(confidence, 0.8);
  }
  if (overwhelmMarkers.test(query)) {
    states.push({ emotion: 'overwhelmed', reason: 'overwhelm_markers' });
    confidence = Math.max(confidence, 0.75);
  }
  if (excitementMarkers.test(query)) {
    states.push({ emotion: 'excited', reason: 'excitement_markers' });
    confidence = Math.max(confidence, 0.7);
  }
  
  // Infer from context: if previous bot message was reassuring or had offer
  // and user responds positively, mark as receptive
  const recentBotMessages = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter(m => m && m.role === 'bot')
    .map(m => m.text || '')
    .join(' ')
    .toLowerCase();
  
  const isReceptive = recentBotMessages.length > 0 && (query.length < 50 || /\b(ya|iya|oke|okay|baik|bagus|boleh|lanjut|terus|next)\b/.test(query));
  if (isReceptive) {
    states.push({ emotion: 'receptive', reason: 'short_positive_response' });
    confidence = Math.max(confidence, 0.6);
  }
  
  // If no strong emotional markers, default to neutral
  if (states.length === 0) {
    states.push({ emotion: 'neutral', reason: 'no_markers' });
    confidence = 0.3;
  }
  
  return {
    primaryEmotion: states[0] ? states[0].emotion : 'neutral',
    allEmotions: states,
    confidence,
    markers: {
      anxiety: anxietyMarkers.test(query),
      insecurity: insecurityMarkers.test(query),
      confusion: confusionMarkers.test(query),
      overwhelm: overwhelmMarkers.test(query),
      excitement: excitementMarkers.test(query)
    },
    needsReassurance: states.some(s => ['anxious', 'insecure', 'confused', 'overwhelmed'].includes(s.emotion))
  };
}

/**
 * Infer weak subjects from user query and conversation
 * @param {string} userQuery - Current user message
 * @param {Array} retrievals - Top RAG results
 * @returns {Array} weak subjects detected
 */
function inferWeakSubjects(userQuery = '', retrievals = []) {
  const query = String(userQuery || '').toLowerCase();
  const weak = new Set();
  
  const subjectPatterns = {
    'Matematika': /\b(matematika|mtk|math|aljabar|kalkulus|trigonometri|geometri|statistika|probabilitas|fungsi|persamaan)\b/i,
    'Fisika': /\b(fisika|physics|mekanika|optik|termodinamika|gelombang)\b/i,
    'Kimia': /\b(kimia|chemistry|asam|basa|reaksi|mol)\b/i,
    'Pemrograman': /\b(programming|coding|program|java|python|c\+\+|algorithm|algoritma|sorting|searching)\b/i,
    'Bahasa Inggris': /\b(bahasa inggris|english|grammar|toefl|ielts|vocabulary)\b/i
  };
  
  for (const [subject, pattern] of Object.entries(subjectPatterns)) {
    if (pattern.test(query)) weak.add(subject);
  }
  
  // If user mentions "gak kuat" or "takut" with subject -> add to weak subjects
  const fearPatterns = /\b(gak kuat|tidak kuat|takut|khawatir|susah dengan|sulit)\s+(matematika|mtk|fisika|kimia|programming|bahasa inggris|english)\b/i;
  const fearMatch = query.match(fearPatterns);
  if (fearMatch) {
    for (const [subject, pattern] of Object.entries(subjectPatterns)) {
      if (pattern.test(fearMatch[0])) weak.add(subject);
    }
  }
  
  return Array.from(weak);
}

/**
 * Infer interests/strengths from user query
 * @param {string} userQuery - Current user message
 * @param {Array} retrievals - Top RAG results
 * @returns {Object} {interests, strengths}
 */
function inferInterestsAndStrengths(userQuery = '', retrievals = []) {
  const query = String(userQuery || '').toLowerCase();
  const interests = new Set();
  const strengths = new Set();
  
  const domainPatterns = {
    'Marketing': /\b(marketing|pemasaran|brand|digital marketing|content marketing|social media|advertising|promosi)\b/i,
    'Design': /\b(design|desain|ux|ui|graphic|visual|layout|branding)\b/i,
    'Development': /\b(development|developer|coding|programming|backend|frontend|full.?stack|web|mobile)\b/i,
    'Data Science': /\b(data|analysis|analytics|ai|machine learning|big data|data science)\b/i,
    'Business': /\b(business|bisnis|entrepreneurship|startup|management|leadership|strategy)\b/i,
    'Communication': /\b(communication|komunikasi|public speaking|presentation|writing|content|storytelling)\b/i,
    'Finance': /\b(finance|keuangan|accounting|akuntansi|investasi|investment|banking)\b/i,
    'Education': /\b(education|pendidikan|teaching|learning|tutor|education|pedagogi)\b/i
  };
  
  for (const [domain, pattern] of Object.entries(domainPatterns)) {
    if (pattern.test(query)) interests.add(domain);
  }
  
  // Strengths: if user says "suka" (like) or "bagus di" (good at)
  const strengthPatterns = /\b(suka|suka di|bagus di|mahir|expert|passion|passionate|love|interested in|tertarik)\s+(\w+)/gi;
  let match;
  while ((match = strengthPatterns.exec(query)) !== null) {
    const word = match[2].toLowerCase();
    for (const [domain, pattern] of Object.entries(domainPatterns)) {
      if (pattern.test(word)) strengths.add(domain);
    }
  }
  
  return {
    interests: Array.from(interests),
    strengths: Array.from(strengths)
  };
}

/**
 * Infer confidence level (0-1) from emotional state and conversation patterns
 * @param {Object} emotionalState - Result from inferEmotionalState
 * @param {string} userQuery - Current user message
 * @param {Array} recentMessages - Conversation history
 * @returns {number} confidence 0-1
 */
function inferConfidenceLevel(emotionalState = {}, userQuery = '', recentMessages = []) {
  let confidence = 0.5; // neutral baseline
  
  // Adjust based on emotional state
  if (emotionalState.primaryEmotion === 'anxious' || emotionalState.primaryEmotion === 'insecure') {
    confidence -= 0.25;
  } else if (emotionalState.primaryEmotion === 'excited' || emotionalState.primaryEmotion === 'receptive') {
    confidence += 0.15;
  } else if (emotionalState.primaryEmotion === 'confused') {
    confidence -= 0.15;
  }
  
  // Adjust based on query length and specificity
  const query_text = String(userQuery || '').trim();
  if (query_text.length > 100) {
    confidence += 0.1; // longer, more detailed query suggests more confidence
  } else if (query_text.length < 10) {
    confidence -= 0.1; // very short query might indicate uncertainty
  }
  
  // Check for affirmative language
  const affirmativeMarkers = /\b(pasti|pasti|definitely|absolutely|tanpa ragu|sure|confident|yakin)\b/i;
  if (affirmativeMarkers.test(query_text)) {
    confidence += 0.15;
  }
  
  // Check for hesitation markers
  const hesitationMarkers = /\b(mungkin|maybe|kayaknya|sepertinya|ragu|doubt|uncertain|tidak yakin|kurang yakin)\b/i;
  if (hesitationMarkers.test(query_text)) {
    confidence -= 0.15;
  }
  
  // Clamp between 0 and 1
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Update userProfile with inferred data from this turn
 * @param {Object} existingProfile - Current userProfile
 * @param {string} userQuery - Current message
 * @param {Array} recentMessages - Conversation history
 * @param {Array} retrievals - RAG results
 * @returns {Object} updated userProfile
 */
function updateUserProfile(existingProfile = {}, userQuery = '', recentMessages = [], retrievals = []) {
  const emotionalState = inferEmotionalState(userQuery, recentMessages);
  const { interests, strengths } = inferInterestsAndStrengths(userQuery, retrievals);
  const weakSubjects = inferWeakSubjects(userQuery, retrievals);
  const confidence = inferConfidenceLevel(emotionalState, userQuery, recentMessages);
  
  // update trajectory arrays with caps
  const cap = (arr, n) => (Array.isArray(arr) ? arr.slice(-n) : []);
  const emotionalStateHistory = cap(existingProfile.emotionalStateHistory, 40).concat([emotionalState.primaryEmotion]).slice(-40);
  const confidenceHistory = cap(existingProfile.confidenceHistory, 40).concat([confidence]).slice(-40);
  const anxietyHistory = cap(existingProfile.anxietyHistory, 40).concat([emotionalState.markers && emotionalState.markers.anxiety ? 1 : 0]).slice(-40);
  const engagementHistory = cap(existingProfile.engagementHistory, 40).concat([Math.min(1, Math.max(0, (userQuery || '').length / 200))]).slice(-40);
  const curiosityHistory = cap(existingProfile.curiosityHistory, 40).concat([/\b(kenapa|bagaimana|mengapa|mengerti|jelasin|tell me|why)\b/i.test(userQuery) ? 1 : 0]).slice(-40);

  // infer tendencies
  const tendencies = Object.assign({}, existingProfile.tendencies || {}, inferTendencies(userQuery, interests, strengths));

  const mergedInterests = Array.from(new Set([...(interests || []), ...(Array.isArray(existingProfile.interests) ? existingProfile.interests : [])])).slice(0, 8);
  const mergedWeak = Array.from(new Set([...(weakSubjects || []), ...(Array.isArray(existingProfile.weakSubjects) ? existingProfile.weakSubjects : [])])).slice(0, 6);
  const mergedStrengths = Array.from(new Set([...(strengths || []), ...(Array.isArray(existingProfile.strengths) ? existingProfile.strengths : [])])).slice(0, 8);

  const updated = Object.assign({}, existingProfile, {
    emotionalState: emotionalState.primaryEmotion,
    emotionalStateHistory,
    confidenceLevel: confidence,
    confidenceHistory,
    anxietyHistory,
    engagementHistory,
    curiosityHistory,
    needsReassurance: emotionalState.needsReassurance || Boolean(existingProfile.needsReassurance),
    interests: mergedInterests,
    weakSubjects: mergedWeak,
    strengths: mergedStrengths,
    tendencies,
    conversationSummary: String(userQuery).slice(0, 300),
    lastUpdatedAt: new Date().toISOString()
  });

  // detect escalation / de-escalation
  try {
    const esc = detectEmotionalEscalation(existingProfile, updated);
    if (esc) updated.emotionalEscalation = esc;
  } catch (e) {}

  // decay stale signals (simple trim)
  try { applyDecay(updated); } catch (e) {}

  return updated;
}

/**
 * Infer personality / tendency scores from interests & strengths
 */
function inferTendencies(userQuery = '', interests = [], strengths = []) {
  const t = {
    analytical: 0,
    social: 0,
    creative: 0,
    leadership: 0,
    communication: 0,
    technicalTolerance: 0
  };
  const src = ((userQuery || '') + ' ' + (interests || []).join(' ') + ' ' + (strengths || []).join(' ')).toLowerCase();
  if (/\b(marketing|business|management|strategy|finance|data|analytics|statistik)\b/.test(src)) t.analytical += 0.6;
  if (/\b(communication|writing|public speaking|presentation|storytelling)\b/.test(src)) t.communication += 0.8;
  if (/\b(design|ux|creative|branding|visual)\b/.test(src)) t.creative += 0.9;
  if (/\b(team|lead|manager|organize|startup|entrepreneur)\b/.test(src)) t.leadership += 0.7;
  if (/\b(sosial|community|people|hr|customer)\b/.test(src)) t.social += 0.7;
  if (/\b(programming|coding|engineer|software|kalkulus|matematika|machine learning)\b/.test(src)) t.technicalTolerance += 0.9;
  // normalize to 0-1
  for (const k of Object.keys(t)) t[k] = Math.max(0, Math.min(1, t[k]));
  return t;
}

/**
 * Simple decay/cleanup for long-lived arrays
 */
function applyDecay(profile = {}) {
  if (!profile) return profile;
  const maxLen = 120;
  ['emotionalStateHistory', 'confidenceHistory', 'anxietyHistory', 'engagementHistory', 'curiosityHistory'].forEach(k => {
    if (Array.isArray(profile[k])) profile[k] = profile[k].slice(-maxLen);
  });
  if (Array.isArray(profile.interests) && profile.interests.length > 40) profile.interests = profile.interests.slice(-40);
  if (Array.isArray(profile.weakSubjects) && profile.weakSubjects.length > 40) profile.weakSubjects = profile.weakSubjects.slice(-40);
  return profile;
}

/**
 * Detect emotional escalation by comparing last two anxiety/confidence points
 */
function detectEmotionalEscalation(prevProfile = {}, newProfile = {}) {
  try {
    const prevAnx = Array.isArray(prevProfile.anxietyHistory) ? prevProfile.anxietyHistory.slice(-3) : [];
    const newAnx = Array.isArray(newProfile.anxietyHistory) ? newProfile.anxietyHistory.slice(-3) : [];
    const prevConf = Array.isArray(prevProfile.confidenceHistory) ? prevProfile.confidenceHistory.slice(-3) : [];
    const newConf = Array.isArray(newProfile.confidenceHistory) ? newProfile.confidenceHistory.slice(-3) : [];
    const anxTrend = (newAnx.length && prevAnx.length) ? (newAnx[newAnx.length-1] - prevAnx[prevAnx.length-1]) : 0;
    const confTrend = (newConf.length && prevConf.length) ? (newConf[newConf.length-1] - prevConf[prevConf.length-1]) : 0;
    if (anxTrend > 0.4 || confTrend < -0.3) return { direction: 'escalating', anxTrend, confTrend };
    if (anxTrend < -0.3 || confTrend > 0.25) return { direction: 'deescalating', anxTrend, confTrend };
    return null;
  } catch (e) { return null; }
}

/**
 * Detect contradiction between recommendation history and rejected programs
 */
function detectContradiction(profile = {}) {
  try {
    const rec = Array.isArray(profile.recommendationHistory) ? profile.recommendationHistory : [];
    const rej = Array.isArray(profile.rejectedPrograms) ? profile.rejectedPrograms : [];
    for (const r of rec) {
      if (rej.includes(r)) return { program: r, reason: 'rejected_after_recommendation' };
    }
    return null;
  } catch (e) { return null; }
}

/**
 * Generate a contextual follow-up question based on user profile
 * @param {Object} userProfile - User's profile
 * @param {Object} emotionalState - Current emotional inference
 * @returns {string} contextual follow-up question
 */
function generateContextualFollowUp(userProfile = {}, emotionalState = {}) {
  const emotion = emotionalState.primaryEmotion || userProfile.emotionalState || 'neutral';
  const interests = Array.isArray(userProfile.interests) ? userProfile.interests : [];
  const weakSubjects = Array.isArray(userProfile.weakSubjects) ? userProfile.weakSubjects : [];
  const strengths = Array.isArray(userProfile.strengths) ? userProfile.strengths : [];
  
  const followUps = [];
  
  // Anxiety/insecurity follow-ups
  if (emotion === 'anxious' || emotion === 'insecure') {
    if (weakSubjects.length > 0) {
      followUps.push(`Kamu bilang khawatir dengan ${weakSubjects[0]}. Ada yang bisa aku bantu biar lebih yakin?`);
    } else {
      followUps.push('Dari apa yang kamu cerita, sepertinya kamu agak ragu. Ada yang bisa aku jelaskan lebih lanjut?');
    }
  }
  
  // Confused follow-ups
  if (emotion === 'confused') {
    if (interests.length > 0) {
      followUps.push(`Jadi minat kamu ke ${interests[0]}? Mau aku jelaskan lebih detail?`);
    } else {
      followUps.push('Aku coba jelasin lebih detail dulu. Ini lebih jelas tidak?');
    }
  }
  
  // Excited follow-ups
  if (emotion === 'excited') {
    if (strengths.length > 0) {
      followUps.push(`Bagus! Jadi ${strengths[0]} itu passion kamu? Mau explore lebih dalam?`);
    } else {
      followUps.push('Seru nih! Pengen aku bantu explore opsi-opsi yang cocok?');
    }
  }
  
  // General follow-ups
  if (interests.length > 0 && interests.length <= 2) {
    followUps.push(`Kamu lebih suka kerja yang banyak ${interests[0]} atau eksplorasi hal lain juga?`);
  }
  
  if (weakSubjects.length > 0 && strengths.length > 0) {
    followUps.push(`Jadi ${weakSubjects[0]} itu challenge kamu, tapi ${strengths[0]} itu kekuatan. Prodi mana yang balance kedua-duanya menurut kamu?`);
  }
  
  // Default fall-back
  if (followUps.length === 0) {
    followUps.push('Dari apa yang kamu cerita, lebih enak kalau programnya memungkinkan kerja sambil kuliah tidak?');
  }
  
  return followUps[Math.floor(Math.random() * followUps.length)];
}

module.exports = {
  inferEmotionalState,
  inferWeakSubjects,
  inferInterestsAndStrengths,
  inferConfidenceLevel,
  updateUserProfile,
  generateContextualFollowUp,
  inferTendencies,
  applyDecay,
  detectEmotionalEscalation,
  detectContradiction
};
