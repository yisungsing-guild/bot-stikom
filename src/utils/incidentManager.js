const crypto = require('crypto');

const pendingByCode = new Map();
const recentByFingerprint = new Map();

function nowMs() {
  return Date.now();
}

function envInt(name, fallback) {
  const raw = parseInt(process.env[name] || String(fallback), 10);
  return (Number.isFinite(raw) && raw >= 0) ? raw : fallback;
}

function getIncidentTtlMs() {
  const minutes = envInt('INCIDENT_TTL_MINUTES', 15);
  return Math.max(60_000, minutes * 60_000);
}

function getDedupeWindowMs() {
  return Math.max(0, envInt('INCIDENT_DEDUPE_WINDOW_MS', 60_000));
}

function pruneMaps() {
  const now = nowMs();

  // Prune pending incidents
  for (const [code, inc] of pendingByCode.entries()) {
    if (!inc) {
      pendingByCode.delete(code);
      continue;
    }

    const exp = typeof inc.expiresAtMs === 'number' ? inc.expiresAtMs : 0;
    const consumed = Boolean(inc.consumedAtMs);

    if (consumed || (exp && exp <= now)) {
      pendingByCode.delete(code);
    }
  }

  // Prune dedupe fingerprints
  const windowMs = getDedupeWindowMs();
  if (windowMs <= 0) {
    recentByFingerprint.clear();
    return;
  }

  for (const [fp, ts] of recentByFingerprint.entries()) {
    if (!fp || !ts || (now - ts) > windowMs) {
      recentByFingerprint.delete(fp);
    }
  }
}

function shortCode() {
  // 6 hex chars, uppercase.
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function safeString(v, maxLen = 500) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

function fingerprintIncident(kind, summary, details) {
  try {
    const seed = JSON.stringify({ kind: String(kind || ''), summary: String(summary || ''), details: details || null });
    return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
  } catch {
    const seed = `${String(kind || '')}|${String(summary || '')}`;
    return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
  }
}

function createIncident(input) {
  pruneMaps();

  const kind = safeString(input && input.kind ? input.kind : 'incident', 60) || 'incident';
  const summary = safeString(input && input.summary ? input.summary : '');
  const details = (input && typeof input.details === 'object') ? input.details : null;

  const fp = fingerprintIncident(kind, summary, details);
  const dedupeWindowMs = getDedupeWindowMs();
  if (dedupeWindowMs > 0) {
    const last = recentByFingerprint.get(fp);
    const now = nowMs();
    if (last && (now - last) < dedupeWindowMs) {
      return null; // deduped
    }
    recentByFingerprint.set(fp, now);
  }

  let code = shortCode();
  let guard = 0;
  while (pendingByCode.has(code) && guard < 8) {
    code = shortCode();
    guard++;
  }

  const createdAtMs = nowMs();
  const expiresAtMs = createdAtMs + getIncidentTtlMs();

  const action = (input && input.action && typeof input.action === 'object') ? input.action : { type: 'none' };

  const incident = {
    code,
    kind,
    summary,
    details,
    action,
    createdAtMs,
    expiresAtMs,
    consumedAtMs: null,
  };

  pendingByCode.set(code, incident);
  return incident;
}

function listPendingIncidents() {
  pruneMaps();
  return Array.from(pendingByCode.values())
    .filter((i) => i && !i.consumedAtMs)
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
}

function getLatestPendingIncident() {
  const list = listPendingIncidents();
  return list.length ? list[0] : null;
}

function getPendingIncidentByCode(code) {
  pruneMaps();

  const c = safeString(code, 32).toUpperCase();
  if (!c) return null;

  const inc = pendingByCode.get(c);
  if (!inc) return null;
  if (inc.consumedAtMs) return null;

  const now = nowMs();
  if (inc.expiresAtMs && inc.expiresAtMs <= now) {
    pendingByCode.delete(c);
    return null;
  }

  return inc;
}

function consumeIncidentByCode(code) {
  pruneMaps();

  const c = safeString(code, 32).toUpperCase();
  if (!c) return null;

  const inc = pendingByCode.get(c);
  if (!inc) return null;
  if (inc.consumedAtMs) return null;

  const now = nowMs();
  if (inc.expiresAtMs && inc.expiresAtMs <= now) {
    pendingByCode.delete(c);
    return null;
  }

  inc.consumedAtMs = now;
  pendingByCode.set(c, inc);
  return inc;
}

function consumeLatestPendingIncident() {
  const latest = getLatestPendingIncident();
  if (!latest) return null;
  return consumeIncidentByCode(latest.code);
}

function formatIncidentForTelegram(incident) {
  if (!incident) return '';

  const createdIso = new Date(incident.createdAtMs || Date.now()).toISOString();
  const actionType = incident.action && incident.action.type ? String(incident.action.type) : 'none';

  const lines = [
    '[BOT INCIDENT]',
    `Kode: ${incident.code}`,
    `Tipe: ${incident.kind}`,
    `Waktu: ${createdIso}`,
    incident.summary ? `Ringkas: ${incident.summary}` : null,
    `Aksi runtime repair: ${actionType}`,
    '',
    'Balas: YA (atau: YA <KODE>) untuk membuat PR di GitHub (Option A).',
    'Runtime repair (restart/handover) hanya berjalan jika ENABLE_TELEGRAM_REPAIR=true.',
  ].filter(Boolean);

  // Include small details (avoid huge dumps)
  try {
    const d = incident.details && typeof incident.details === 'object' ? incident.details : null;
    if (d) {
      const keys = Object.keys(d).slice(0, 8);
      if (keys.length) {
        lines.push('', 'Detail:');
        for (const k of keys) {
          const v = d[k];
          const sv = (typeof v === 'string') ? safeString(v, 280) : safeString(JSON.stringify(v), 280);
          if (sv) lines.push(`- ${k}: ${sv}`);
        }
      }
    }
  } catch {
    // ignore
  }

  return lines.join('\n');
}

module.exports = {
  createIncident,
  listPendingIncidents,
  getLatestPendingIncident,
  getPendingIncidentByCode,
  consumeIncidentByCode,
  consumeLatestPendingIncident,
  formatIncidentForTelegram,
};
