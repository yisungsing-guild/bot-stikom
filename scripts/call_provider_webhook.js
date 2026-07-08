(async () => {
  try {
    const axios = require('axios');
    const url = process.env.INTERNAL_PROVIDER_URL || `http://127.0.0.1:${process.env.PORT || '4001'}/provider/webhook`;
    const q = 'kalo program studi teknologi informasi itu belajar apa saja, dan nanti bisa bekerja di bidang apa saja?';
    console.log('Posting to', url);
    const headers = {};
    // Try to source token from env first, otherwise read .env.local
    let token = process.env.PROVIDER_WEBHOOK_TOKEN;
    if (!token) {
      try {
        const fs = require('fs');
        const envRaw = fs.readFileSync('.env.local', 'utf8');
        const m = envRaw.match(/PROVIDER_WEBHOOK_TOKEN\s*=\s*"?([^"\n\r]+)"?/i);
        if (m && m[1]) token = m[1].trim();
      } catch (e) {}
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-webhook-token'] = token;
    }
    const resp = await axios.post(url, { chatId: '6281234567890', text: q }, { timeout: 120000, headers });
    console.log('Response:', resp.status, resp.data);
  } catch (e) {
    console.error('Request failed:', e && e.response ? (e.response.status + ' ' + JSON.stringify(e.response.data)) : (e && e.message));
    console.error(e && e.stack);
    process.exit(1);
  }
})();
