const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('openai', () => {
  const create = jest.fn();
  return {
    OpenAI: jest.fn().mockImplementation(() => ({
      audio: {
        transcriptions: { create }
      }
    })),
    __mockCreate: create,
  };
});

const { FileParser } = require('../src/engine/fileParser');
const { __mockCreate } = require('openai');

describe('FileParser video ingestion', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.VIDEO_TRANSCRIPTION_ENABLED = 'true';
    __mockCreate.mockReset();
  });
  it('builds training content for video uploads and preserves source URL', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-parser-'));
    const videoPath = path.join(tempDir, 'sample-video.mp4');
    fs.writeFileSync(videoPath, 'not-a-real-video-file');

    const content = await FileParser.parseFileContentAsync(videoPath, 'sample-video.mp4', {
      sourceUrl: 'https://firebasestorage.googleapis.com/v0/b/demo/o/video.mp4'
    });

    expect(typeof content).toBe('string');
    expect(content).toContain('sample-video.mp4');
    expect(content).toContain('https://firebasestorage.googleapis.com/v0/b/demo/o/video.mp4');
    expect(content.toLowerCase()).toContain('video');
  });

  it('transcribes uploaded videos into training content automatically', async () => {
    __mockCreate.mockResolvedValue({ text: 'Transkrip otomatis dari video' });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-parser-'));
    const videoPath = path.join(tempDir, 'sample-video.mp4');
    fs.writeFileSync(videoPath, 'not-a-real-video-file');

    const content = await FileParser.parseFileContentAsync(videoPath, 'sample-video.mp4', {
      sourceUrl: 'https://firebasestorage.googleapis.com/v0/b/demo/o/video.mp4'
    });

    expect(content).toContain('Transkrip otomatis dari video');
    expect(__mockCreate).toHaveBeenCalled();
  });
});
