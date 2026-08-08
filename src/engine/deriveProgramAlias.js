const VALID_PROGRAMS = new Set([
  'SI','TI','BD','SK','MI','DKV','TRPL','TK','MM','AN','DG','RPL'
]);

function deriveProgramAlias(raw) {
  if (!raw) return null;
  const s = String(raw || '').toLowerCase();
  const normalizedInput = s.replace(/\s+/g, ' ').trim();

  // explicit mapping for common program names
  const map = {
    'sistem informasi': 'SI',
    'teknologi informasi': 'TI',
    'bisnis digital': 'BD',
    'sistem komputer': 'SK',
    'manajemen informatika': 'MI',
    'desain komunikasi visual': 'DKV',
    'teknologi rekayasa perangkat lunak': 'TRPL',
    'teknologi komputer': 'TK',
    'multimedia': 'MM',
    'animasi': 'AN',
    'desain grafis': 'DG',
    'rekognisi pembelajaran lampau': 'RPL'
  };
  for (const [k, v] of Object.entries(map)) {
    // allow flexible whitespace in the key when matching
    const keyPattern = k.replace(/\s+/g, '\\s+').replace(/[-\\/\\^$*+?.()|[\\]{}]/g, '\\$&');
    const re = new RegExp(`\\b${keyPattern}\\b`, 'i');
    if (re.test(normalizedInput)) return v;
  }

  // canonical name not matched — check tokens
  const candidate = String(raw || '').replace(/[\(\)\[\]\.,]/g, ' ').trim();
  if (!candidate) return null;
  const ignored = /^(program|studi|prodi|jurusan|teknik|teknologi|manajemen|ilmu|pendidikan|sistem|informasi|internasional|bisnis|digital|perangkat|lunak|terapan|komputer|multi|media|animasi|desain|grafis|antara|kerja|sama|double|dual|degree|bali|china|dalian|dan|atau|serta|dengan|untuk|dari|ke|di|pada|oleh|dalam)$/i;
  const words = candidate.split(/\s+/).filter((word) => word && !ignored.test(word));
  if (words.length === 0) return null;

  // If any token directly matches a VALID_PROGRAMS alias, accept it only
  // under stricter conditions (uppercase or contextual).
  const rawTokens = String(candidate).split(/\s+/).filter((t) => t && !ignored.test(t));
  for (let i = 0; i < rawTokens.length; i++) {
    const rawToken = rawTokens[i];
    const clean = String(rawToken || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!clean) continue;
    if (!VALID_PROGRAMS.has(clean)) continue;
    // If it's the only token, require uppercase OR context
    const rawStr = String(raw || '');
    const ctxWords = ['prodi','program studi','program','jurusan','kuliah','biaya','daftar','pendaftaran','kampus','profil','informasi'];
    const hasUpper = /[A-Z]/.test(rawToken);
    const hasContext = ctxWords.some(k => new RegExp(`\\b${k.replace(/[-\\/\\^$*+?.()|[\\]{}]/g,'\\$&')}\\b`, 'i').test(rawStr));
    if (rawTokens.length === 1) {
      if (hasUpper || hasContext) return clean;
      continue;
    }
    // multi-token: only accept if token itself shows uppercase or the whole string has context
    if (hasUpper || hasContext) return clean;
  }

  // Handle acronyms cautiously: only accept exact acronym tokens if they are
  // uppercase in the original input OR appear alongside contextual keywords.
  const ctxWords = ['prodi','program','program studi','jurusan','kuliah','biaya','daftar','pendaftaran','kampus','profil','informasi'];
  const rawStr = String(raw || '');
  if (words.length === 1) {
    const token = words[0].replace(/[^A-Za-z]/g, '');
    const up = String(token || '').toUpperCase();
    if (up && VALID_PROGRAMS.has(up)) {
      // check if user typed it in uppercase (deliberate acronym)
      const hasUpper = /[A-Z]/.test(rawStr);
      const hasContext = ctxWords.some(k => new RegExp(`\\b${k.replace(/[-\\/\\^$*+?.()|[\\]{}]/g,'\\$&')}\\b`, 'i').test(rawStr));
      if (hasUpper || hasContext) return up;
    }
    // Not an accepted acronym and we will NOT synthesize arbitrary initials
    return null;
  }

  // For multi-word phrases, do NOT synthesize initials — only accept explicit matches above
  return null;
}

module.exports = { deriveProgramAlias, VALID_PROGRAMS };
