const http = require('http');
const fs = require('fs');
const path = require('path');

const queries = [
  'Apa itu TI?',
  'Apa yang dipelajari di TI?',
  'Prospek kerja TI?',
  'Biaya kuliah TI?',
  'Akreditasi TI?',
  'Saya ingin daftar TI'
];

let completed = 0;

// Clear the log file first
const logDir = path.join(__dirname, 'tmp');
try {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'final_wa_outputs.log');
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
} catch (e) {
  console.error('Error clearing log:', e.message);
}

console.log('Sending', queries.length, 'queries to /provider/webhook...\n');

// Send all queries directly to /provider/webhook
queries.forEach((query, idx) => {
  setTimeout(() => {
    const chatId = `62812${String(100000 + Math.random() * 900000).slice(0, 6)}`;
    const payload = JSON.stringify({
      chatId: chatId,
      text: query
    });

    const opts = {
      hostname: 'localhost',
      port: 4001,
      path: '/provider/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-webhook-token': 'w6uMsnxTQ2C8LZlDPpBmb04iz3WeAfvd'
      }
    };

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`[${idx + 1}/${queries.length}] "${query}" - Status: ${res.statusCode}`);
        completed++;
        if (completed === queries.length) {
          setTimeout(() => {
            displayResults();
          }, 5000);
        }
      });
    });

    req.on('error', (e) => {
      console.error(`Error on query "${query}":`, e.message);
      completed++;
      if (completed === queries.length) {
        setTimeout(() => {
          displayResults();
        }, 5000);
      }
    });

    req.write(payload);
    req.end();
  }, idx * 500);
});

function displayResults() {
  const logPath = path.join(logDir, 'final_wa_outputs.log');
  
  console.log('\n' + '='.repeat(120));
  console.log('FINAL WA FORMATTER VERIFICATION OUTPUT');
  console.log('='.repeat(120) + '\n');

  try {
    if (!fs.existsSync(logPath)) {
      console.log('ERROR: Log file not found at', logPath);
      process.exit(1);
    }

    const logContent = fs.readFileSync(logPath, 'utf8');
    const blocks = logContent.split(/===\s+FINAL\s+WA\s+MESSAGE\s+===/).filter(b => b.trim());

    console.log(`Found ${blocks.length} formatted outputs:\n`);

    blocks.forEach((block, idx) => {
      const lines = block.trim().split(/\r?\n/);
      if (lines.length > 1) {
        const header = lines[0];
        const message = lines.slice(1).join('\n').trim();
        
        console.log(`\n${'─'.repeat(120)}`);
        console.log(`OUTPUT #${idx + 1}:`);
        console.log(`${'─'.repeat(120)}`);
        console.log(message);
        
        console.log(`\n✓ Verification Checklist:`);
        const hasGreeting = /^(Pagi|Siang|Sore|Malam|Halo|Hai)/i.test(message);
        const hasIntent = /(?:Sepertinya|Pertanyaan.*tentang|Berdasarkan pertanyaan|Regarding)/i.test(message);
        const hasMain = message.split('\n').length > 5;
        const hasConclusion = /(?:Kesimpulannya|Singkatnya|Jadi|Demikian)/i.test(message);
        const hasRecommendation = /(?:Rekomendasi pertanyaan berikutnya|Fasilitas yang ada|Apakah Kakak ingin)/i.test(message);

        console.log(`  [${hasGreeting ? '✓' : '✗'}] Greeting          - ${hasGreeting ? 'FOUND' : 'MISSING'}`);
        console.log(`  [${hasIntent ? '✓' : '✗'}] Intent/Asumsi    - ${hasIntent ? 'FOUND' : 'MISSING'}`);
        console.log(`  [${hasMain ? '✓' : '✗'}] Jawaban Utama   - ${hasMain ? 'FOUND' : 'MISSING'}`);
        console.log(`  [${hasConclusion ? '✓' : '✗'}] Kesimpulan       - ${hasConclusion ? 'FOUND' : 'MISSING'}`);
        console.log(`  [${hasRecommendation ? '✓' : '✗'}] Rekomendasi      - ${hasRecommendation ? 'FOUND' : 'MISSING'}`);
      }
    });

    console.log('\n' + '='.repeat(120));
  } catch (e) {
    console.error('Error reading log file:', e.message);
  }

  process.exit(0);
}
