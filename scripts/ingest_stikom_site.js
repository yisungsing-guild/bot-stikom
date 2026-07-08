#!/usr/bin/env node

require('dotenv').config();

const axios = require('axios');
const jwt = require('jsonwebtoken');

function parseArgs(argv) {
  const out = { mode: 'sitemap', maxPages: 10, url: 'https://www.stikom-bali.ac.id/id/', port: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode' && argv[i + 1]) out.mode = String(argv[++i]);
    else if (a === '--maxPages' && argv[i + 1]) out.maxPages = parseInt(argv[++i], 10);
    else if (a === '--url' && argv[i + 1]) out.url = String(argv[++i]);
    else if (a === '--port' && argv[i + 1]) out.port = parseInt(argv[++i], 10);
  }
  return out;
}

async function main() {
  const { mode, maxPages, url, port: portArg } = parseArgs(process.argv);

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET not configured.');
    process.exitCode = 1;
    return;
  }

  const port = portArg || process.env.PORT || 4000;
  const baseUrl = `http://localhost:${port}`;

  const payload = {
    username: process.env.ADMIN_USERNAME || 'admin',
    role: 'admin',
    type: 'access'
  };

  // verifyToken() only checks signature; keep short expiration anyway.
  const token = jwt.sign(payload, secret, { expiresIn: '10m' });

  const body = { url, mode, maxPages };

  try {
    console.log('[Ingest] Requesting:', { baseUrl, mode, maxPages, url });
    const resp = await axios.post(`${baseUrl}/admin/training/url`, body, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000
    });

    const data = resp.data || {};
    console.log('[Ingest] Response:', {
      ok: data.ok,
      mode: data.mode,
      sitemapUrl: data.sitemapUrl,
      requested: data.requested,
      createdCount: data.createdCount,
      created: Array.isArray(data.created) ? data.created.length : undefined
    });

    if (Array.isArray(data.created) && data.created.length) {
      console.log('[Ingest] Created training IDs (first 5):', data.created.slice(0, 5).map(x => x.id));
    }

    console.log('[Ingest] Note: RAG ingestion runs in background. Give it a moment before testing answers.');
  } catch (err) {
    const status = err.response?.status;
    const serverData = err.response?.data;
    console.error('[Ingest] Failed:', {
      status,
      error: serverData?.error || err.message
    });
    if (!status) {
      console.error('[Ingest] Is the server running on', baseUrl, '?');
    }
    process.exitCode = 1;
  }
}

main();
