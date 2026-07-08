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
});
