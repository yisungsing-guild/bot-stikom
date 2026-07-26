const fs = require('fs');
const path = require('path');
const { appendAnswerQualityLog } = require('../src/engine/semanticRagEngine');

describe('appendAnswerQualityLog data fidelity', () => {
  const testLogPath = path.join(__dirname, '..', 'tmp', 'answer-quality.jsonl');

  beforeEach(() => {
    // Clear test log file before each test
    if (fs.existsSync(testLogPath)) {
      fs.unlinkSync(testLogPath);
    }
  });

  afterEach(() => {
    // Clean up test log file after each test
    if (fs.existsSync(testLogPath)) {
      fs.unlinkSync(testLogPath);
    }
  });

  test('preserves caller-provided confidenceTier=VERY_LOW and action=fallback even when confidenceScore is above 0.3', () => {
    const answer = 'This is a normal answer without fallback phrases';
    const metadata = {
      confidenceScore: 0.5,
      confidenceTier: 'VERY_LOW',
      action: 'fallback',
      source: 'test',
      question: 'test question',
      category: 'test'
    };

    appendAnswerQualityLog(answer, metadata);

    // Read the log file and verify the entry
    const logContent = fs.readFileSync(testLogPath, 'utf8');
    const logEntry = JSON.parse(logContent.trim());

    expect(logEntry.confidenceTier).toBe('VERY_LOW');
    expect(logEntry.action).toBe('fallback');
    expect(logEntry.confidenceScore).toBe(0.5);
    expect(logEntry.source).toBe('test');
    expect(logEntry.question).toBe('test question');
    expect(logEntry.category).toBe('test');
  });

  test('preserves caller-provided confidenceTier=HIGH and action=answer when provided', () => {
    const answer = 'This is a normal answer';
    const metadata = {
      confidenceScore: 0.8,
      confidenceTier: 'HIGH',
      action: 'answer',
      source: 'test',
      question: 'another test',
      category: 'general'
    };

    appendAnswerQualityLog(answer, metadata);

    const logContent = fs.readFileSync(testLogPath, 'utf8');
    const logEntry = JSON.parse(logContent.trim());

    expect(logEntry.confidenceTier).toBe('HIGH');
    expect(logEntry.action).toBe('answer');
    expect(logEntry.confidenceScore).toBe(0.8);
  });

  test('derives confidenceTier when not provided by caller', () => {
    const answer = 'This is a normal answer';
    const metadata = {
      confidenceScore: 0.25,
      source: 'test',
      question: 'test'
    };

    appendAnswerQualityLog(answer, metadata);

    const logContent = fs.readFileSync(testLogPath, 'utf8');
    const logEntry = JSON.parse(logContent.trim());

    expect(logEntry.confidenceTier).toBe('MEDIUM'); // Derived from 0.25
    expect(logEntry.confidenceScore).toBe(0.25);
  });

  test('derives action when not provided by caller', () => {
    const answer = 'Maaf, saya belum memiliki data tersebut';
    const metadata = {
      confidenceScore: 0.1,
      source: 'test',
      question: 'test'
    };

    appendAnswerQualityLog(answer, metadata);

    const logContent = fs.readFileSync(testLogPath, 'utf8');
    const logEntry = JSON.parse(logContent.trim());

    expect(logEntry.action).toBe('fallback'); // Derived from fallback phrase
  });

  test('uses ts as canonical timestamp field without duplicate timestamp', () => {
    const answer = 'Test answer';
    const metadata = {
      source: 'test',
      question: 'test'
    };

    appendAnswerQualityLog(answer, metadata);

    const logContent = fs.readFileSync(testLogPath, 'utf8');
    const logEntry = JSON.parse(logContent.trim());

    expect(logEntry.ts).toBeDefined();
    expect(logEntry.timestamp).toBeUndefined(); // No duplicate timestamp field
  });

  test('prefers answerPreview over full answer field', () => {
    const longAnswer = 'A'.repeat(300);
    const metadata = {
      source: 'test',
      question: 'test'
    };

    appendAnswerQualityLog(longAnswer, metadata);

    const logContent = fs.readFileSync(testLogPath, 'utf8');
    const logEntry = JSON.parse(logContent.trim());

    expect(logEntry.answerPreview).toBeDefined();
    expect(logEntry.answerPreview.length).toBeLessThanOrEqual(200);
    expect(logEntry.answer).toBeUndefined(); // No full answer field
  });

  test('preserves caller-provided reason, category, and source exactly', () => {
    const answer = 'Test answer';
    const metadata = {
      source: 'custom-source',
      question: 'custom question',
      category: 'custom-category',
      reason: 'custom reason',
      confidenceScore: 0.3
    };

    appendAnswerQualityLog(answer, metadata);

    const logContent = fs.readFileSync(testLogPath, 'utf8');
    const logEntry = JSON.parse(logContent.trim());

    expect(logEntry.source).toBe('custom-source');
    expect(logEntry.question).toBe('custom question');
    expect(logEntry.category).toBe('custom-category');
    expect(logEntry.reason).toBe('custom reason');
  });
});
