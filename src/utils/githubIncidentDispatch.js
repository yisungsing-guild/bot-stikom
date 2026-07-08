const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../logger');

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (!v) return defaultValue;
  return v === 'true' || v === '1' || v === 'yes' || v === 'y' || v === 'on';
}

function safeString(v, maxLen = 600) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

function redactSecretsInText(text) {
  let t = String(text || '');
  if (!t) return '';

  // Common token patterns
  t = t.replace(/\bsk-[A-Za-z0-9]{10,}\b/g, '<redacted>');
  t = t.replace(/\bBearer\s+[^\s]+/gi, 'Bearer <redacted>');
  // JWT-ish strings
  t = t.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<redacted_jwt>');
  return t;
}

function redactPhoneNumbersInText(text) {
  let t = String(text || '');
  if (!t) return '';

  // Mask obvious phone-like digit runs (10..16 digits)
  t = t.replace(/\b\d{10,16}\b/g, (m) => maskPhoneLike(m));
  return t;
}

function redactTextForGitHub(text, maxLen = 700) {
  const s = safeString(text, maxLen);
  if (!s) return '';
  return safeString(redactPhoneNumbersInText(redactSecretsInText(s)), maxLen);
}

function maskPhoneLike(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return raw;
  const last4 = digits.slice(-4);
  return `<masked:${last4}>`;
}

function sha256Short(value) {
  try {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
  } catch {
    return '';
  }
}

function looksSensitiveKey(key) {
  const k = String(key || '').toLowerCase();
  return /(token|secret|password|api[_-]?key|authorization|cookie|database_url|openai|whatsapp|wati|redis)/.test(k);
}

function shouldOmitContentKey(key) {
  const k = String(key || '').toLowerCase();
  return /(usertext|lastbot|prompt|completion|payload|raw|body|messages?|conversation|transcript)/.test(k);
}

function looksPhoneValue(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 16;
}

function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') return null;

  const out = {};
  const keys = Object.keys(details).slice(0, 24);
  for (const key of keys) {
    const value = details[key];

    if (looksSensitiveKey(key)) {
      out[key] = '<redacted>';
      continue;
    }

    if (shouldOmitContentKey(key)) {
      out[key] = '<omitted>';
      continue;
    }

    if (value === null || typeof value === 'undefined') {
      out[key] = null;
      continue;
    }

    if (typeof value === 'string') {
      const v = redactTextForGitHub(value, 700);
      if (/^sk-/.test(v) || /bearer\s+/i.test(v) || /eyJ[a-zA-Z0-9_-]{10,}/.test(v)) {
        out[key] = '<redacted>';
        continue;
      }

      if (looksPhoneValue(v) || String(key).toLowerCase().includes('chatid')) {
        out[key] = {
          masked: maskPhoneLike(v),
          hash: sha256Short(v)
        };
        continue;
      }

      out[key] = v;
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }

    // For nested objects/arrays, stringify with truncation.
    try {
      const json = JSON.stringify(value);
      out[key] = safeString(redactPhoneNumbersInText(redactSecretsInText(json)), 900);
    } catch {
      out[key] = '<unserializable>';
    }
  }

  return out;
}

function parseOwnerRepoFromUrl(remoteUrl) {
  const u = String(remoteUrl || '').trim();
  if (!u) return null;

  // https://github.com/OWNER/REPO.git
  let m = u.match(/github\.com\/(.+?)\/(.+?)(?:\.git)?$/i);
  if (m) return { owner: m[1], repo: m[2] };

  // git@github.com:OWNER/REPO.git
  m = u.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i);
  if (m) return { owner: m[1], repo: m[2] };

  return null;
}

function inferOwnerRepoFromGitConfig() {
  try {
    const projectRoot = path.join(__dirname, '..', '..');
    const cfgPath = path.join(projectRoot, '.git', 'config');
    const raw = fs.readFileSync(cfgPath, 'utf8');

    // Very small parser: pick origin url if present.
    const lines = raw.split(/\r?\n/);
    let inOrigin = false;
    for (const line of lines) {
      const l = String(line || '').trim();
      if (/^\[remote\s+"origin"\]/i.test(l)) {
        inOrigin = true;
        continue;
      }
      if (inOrigin && /^\[/.test(l)) {
        inOrigin = false;
      }
      if (inOrigin) {
        const mm = l.match(/^url\s*=\s*(.+)$/i);
        if (mm) {
          return parseOwnerRepoFromUrl(mm[1]);
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

function getGitHubIncidentConfig() {
  const enabled = envFlag('ENABLE_GITHUB_INCIDENT_PR', false);
  const token = String(process.env.GITHUB_INCIDENT_TOKEN || process.env.GITHUB_TOKEN || '').trim();

  const repoRaw = String(process.env.GITHUB_INCIDENT_REPO || '').trim();
  let ownerRepo = null;
  if (repoRaw) {
    const mm = repoRaw.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (mm) ownerRepo = { owner: mm[1], repo: mm[2] };
  }

  if (!ownerRepo) {
    ownerRepo = inferOwnerRepoFromGitConfig();
  }

  const eventType = safeString(process.env.GITHUB_INCIDENT_EVENT_TYPE || 'bot_incident', 40) || 'bot_incident';

  const timeoutMsRaw = parseInt(process.env.GITHUB_INCIDENT_TIMEOUT_MS || '4500', 10);
  const timeoutMs = (Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0) ? timeoutMsRaw : 4500;

  return {
    enabled,
    token,
    owner: ownerRepo ? ownerRepo.owner : null,
    repo: ownerRepo ? ownerRepo.repo : null,
    eventType,
    timeoutMs,
  };
}

function buildDispatchPayload(incident) {
  if (!incident) return null;

  const createdAtIso = incident.createdAtMs ? new Date(incident.createdAtMs).toISOString() : new Date().toISOString();
  const kind = safeString(incident.kind || 'incident', 60) || 'incident';
  const code = safeString(incident.code || 'UNKNOWN', 32).toUpperCase() || 'UNKNOWN';
  const summary = redactTextForGitHub(incident.summary || '', 500);

  const actionType = incident.action && incident.action.type ? safeString(incident.action.type, 40) : 'none';

  return {
    incident: {
      code,
      kind,
      summary,
      createdAt: createdAtIso,
      action: {
        type: actionType
      },
      details: sanitizeDetails(incident.details)
    }
  };
}

async function dispatchIncidentToGitHub(incident) {
  try {
    const cfg = getGitHubIncidentConfig();
    if (!cfg.enabled) return { ok: false, disabled: true };
    if (!cfg.token) return { ok: false, error: 'missing_token' };
    if (!cfg.owner || !cfg.repo) return { ok: false, error: 'missing_repo' };

    const payload = buildDispatchPayload(incident);
    if (!payload) return { ok: false, error: 'missing_payload' };

    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/dispatches`;

    const resp = await axios.post(
      url,
      {
        event_type: cfg.eventType,
        client_payload: payload
      },
      {
        timeout: cfg.timeoutMs,
        validateStatus: () => true,
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${cfg.token}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );

    if (resp && resp.status === 204) {
      return { ok: true };
    }

    logger.warn({ status: resp && resp.status, data: resp && resp.data }, '[GitHubIncident] dispatch failed');
    return { ok: false, status: resp && resp.status, data: resp && resp.data };
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[GitHubIncident] dispatch error');
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  getGitHubIncidentConfig,
  dispatchIncidentToGitHub,
};
