/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

(async () => {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/debugPdfText.js "C:\\path\\to\\file.pdf"');
    process.exit(1);
  }

  const filePath = path.resolve(input);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch {
    console.error('Missing dependency: pdf-parse. Run: npm install');
    process.exit(1);
  }

  const buf = fs.readFileSync(filePath);
  const data = await pdfParse(buf);
  const text = data && typeof data.text === 'string' ? data.text : '';
  const trimmed = text.trim();

  console.log(
    JSON.stringify(
      {
        filePath,
        pages: data && data.numpages ? data.numpages : null,
        rawLength: text.length,
        trimmedLength: trimmed.length,
        sample: trimmed.slice(0, 400),
      },
      null,
      2
    )
  );
})().catch(err => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
