const { sanitizeFilename, validateFileType, ALLOWED_FILE_TYPES } = require('../src/middleware/uploadSecurity');

describe('uploadSecurity helpers', () => {
  test('sanitizeFilename removes dangerous characters', () => {
    const input = '../path/..\\evil.txt:"?*';
    const out = sanitizeFilename(input);
    expect(out).not.toMatch(/[\\/]/);
    expect(out).not.toContain('..');
    expect(out).not.toMatch(/[<>:"|?*]/);
  });

  test('validateFileType rejects unsupported extensions', () => {
    const res = validateFileType('evil.exe', 'application/octet-stream');
    expect(res.valid).toBe(false);
  });

  test('validateFileType allows whitelisted extensions', () => {
    const sampleExt = ALLOWED_FILE_TYPES[0] || 'txt';
    const res = validateFileType(`file.${sampleExt}`, 'text/plain');
    expect(res.valid).toBe(true);
  });
  test('validateFileType allows common image extensions for OCR training', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff']) {
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'tif' || ext === 'tiff' ? 'image/tiff' : `image/${ext}`);
      const res = validateFileType(`brosur.${ext}`, mime);
      expect(res.valid).toBe(true);
    }
  });
});

