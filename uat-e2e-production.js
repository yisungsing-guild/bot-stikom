#!/usr/bin/env node

/**
 * UAT End-to-End Production Flow Audit
 * 
 * Simulasi user WhatsApp sungguhan:
 * - Send ke /fonnte/webhook (sama seperti real WhatsApp)
 * - Bot memproses full flow: FSM → Intent → Rule Engine → RAG → Humanizer → Formatter → Provider
 * - Capture setiap step
 * - Generate laporan lengkap
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configuration
const BOT_URL = process.env.BOT_URL || 'http://localhost:4001';
const WEBHOOK_ENDPOINT = `${BOT_URL}/fonnte/webhook`;
const TIMEOUT_MS = parseInt(process.env.TEST_TIMEOUT_MS || '8000', 10);
const POLL_INTERVAL_MS = 200;

// Test data structure
const TEST_SCENARIOS = [
  {
    name: 'A: Menu PMB - Basic greeting',
    tests: [
      { no: 1, question: 'Halo, apa kabar?', expectedIntent: 'GREETING' },
      { no: 2, question: 'Menu utama', expectedIntent: 'MENU' }
    ]
  },
  {
    name: 'B: Program Definition - Single program inquiry',
    tests: [
      { no: 3, question: 'Apa itu SI?', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 4, question: 'Definisi TI lengkap', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 5, question: 'Apa bedanya SI dan TI?', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 6, question: 'Jelaskan program BD', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 7, question: 'Apa kabar program SK?', expectedIntent: 'ACADEMIC_PROGRAM' }
    ]
  },
  {
    name: 'C: Program + Prospect - Multi-intent',
    tests: [
      { no: 8, question: 'SI itu apa dan prospeknya bagaimana?', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 9, question: 'Daftar TI gimana dan ada prospek?', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 10, question: 'Cerita tentang BD dan jenjang karirnya', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 11, question: 'SK bagus gak? Prospeknya?', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 12, question: 'Penjelasan MI dan peluang kerjanya', expectedIntent: 'ACADEMIC_PROGRAM' }
    ]
  },
  {
    name: 'D: Fee Inquiry - Wave variations',
    tests: [
      { no: 13, question: 'Berapa biaya TI gelombang 1A?', expectedIntent: 'COST' },
      { no: 14, question: 'Biaya SI gelombang 2C berapa?', expectedIntent: 'COST' },
      { no: 15, question: 'Harga SK gelombang 1B?', expectedIntent: 'COST' },
      { no: 16, question: 'Total biaya MI gelombang 3?', expectedIntent: 'COST' },
      { no: 17, question: 'Berapa bayar BD Khusus?', expectedIntent: 'COST' },
      { no: 18, question: 'Biaya masuk TI?', expectedIntent: 'COST' },
      { no: 19, question: 'DPP SI berapa saja?', expectedIntent: 'COST' },
      { no: 20, question: 'Uang kuliah BD?', expectedIntent: 'COST' }
    ]
  },
  {
    name: 'E: Fee Breakdown - Detailed fee structures',
    tests: [
      { no: 21, question: 'Rincian biaya TI gelombang 1A lengkap', expectedIntent: 'COST' },
      { no: 22, question: 'Detil biaya SI 2C (DPP + SPP)', expectedIntent: 'COST' },
      { no: 23, question: 'Breakdown biaya SK 1B apa aja?', expectedIntent: 'COST' },
      { no: 24, question: 'Komposisi biaya MI gelombang 3 detail', expectedIntent: 'COST' },
      { no: 25, question: 'Rincian lengkap fee BD Khusus', expectedIntent: 'COST' },
      { no: 26, question: 'DPP TI gelombang 1A berapa? Detailnya apa aja?', expectedIntent: 'COST' },
      { no: 27, question: 'SI 2C ada apa aja biayanya?', expectedIntent: 'COST' },
      { no: 28, question: 'SK 1B total berapa? Ada cicilan?', expectedIntent: 'COST' },
      { no: 29, question: 'MI gelombang 3 DPP nya brapa?', expectedIntent: 'COST' },
      { no: 30, question: 'BD Khusus biaya apa aja sih?', expectedIntent: 'COST' },
      { no: 31, question: 'Berapa biaya masuk TI? Bisa cicil?', expectedIntent: 'COST' },
      { no: 32, question: 'Biaya admin SI?', expectedIntent: 'COST' },
      { no: 33, question: 'SPP SK berapa?', expectedIntent: 'COST' },
      { no: 34, question: 'Total investasi MI?', expectedIntent: 'COST' }
    ]
  },
  {
    name: 'F: Multi-turn Context - Message continuity',
    tests: [
      { no: 35, question: 'Apa itu TI?', context: true, expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 36, question: 'Prospeknya bagaimana?', context: true, expectedIntent: 'ACADEMIC_PROGRAM', parentContext: 35 },
      { no: 37, question: 'Berapa biayanya?', context: true, expectedIntent: 'COST', parentContext: 35 },
      { no: 38, question: 'Gelombang 1A ya', context: true, expectedIntent: 'COST', parentContext: 37 },
      { no: 39, question: 'Rincian biayanya dong', context: true, expectedIntent: 'COST', parentContext: 38 },
      { no: 40, question: 'Bagaimana cara daftar?', context: true, expectedIntent: 'ENROLLMENT', parentContext: 35 },
      { no: 41, question: 'Lihat SI dong', context: true, expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 42, question: 'Biaya SI?', context: true, expectedIntent: 'COST', parentContext: 41 },
      { no: 43, question: 'Gelombang berapa saja?', context: true, expectedIntent: 'COST', parentContext: 42 },
      { no: 44, question: 'Perbedaan gelombang apa sih?', context: true, expectedIntent: 'COST', parentContext: 43 },
      { no: 45, question: 'Jadwal pendaftaran kapan?', context: true, expectedIntent: 'SCHEDULE', parentContext: 35 },
      { no: 46, question: 'Syarat masuk apa saja?', context: true, expectedIntent: 'ENROLLMENT', parentContext: 35 },
      { no: 47, question: 'Cek SK sekarang', context: true, expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 48, question: 'Skema pembayaran gimana?', context: true, expectedIntent: 'COST', parentContext: 47 },
      { no: 49, question: 'Bisa dicicil gak?', context: true, expectedIntent: 'COST', parentContext: 48 },
      { no: 50, question: 'Bunga cicilan berapa?', context: true, expectedIntent: 'COST', parentContext: 49 },
      { no: 51, question: 'Balik ke menu utama', context: true, expectedIntent: 'MENU' },
      { no: 52, question: 'Lihat jadwal?', context: true, expectedIntent: 'SCHEDULE', parentContext: 51 }
    ]
  },
  {
    name: 'G: Context Switching - Program switching',
    tests: [
      { no: 53, question: 'Bandingkan TI dan SI', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 54, question: 'Sekarang biaya BD', expectedIntent: 'COST' },
      { no: 55, question: 'Kembali ke TI', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 56, question: 'Bedanya SK dengan MI?', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 57, question: 'SK apa sih?', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 58, question: 'Ke SI sekarang', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 59, question: 'Biaya SI wave 1A', expectedIntent: 'COST' },
      { no: 60, question: 'Lalu TI wave 2C', expectedIntent: 'COST' },
      { no: 61, question: 'Mi juga dong', expectedIntent: 'COST' },
      { no: 62, question: 'Ke BD', expectedIntent: 'ACADEMIC_PROGRAM' },
      { no: 63, question: 'Biaya BD semua gelombang', expectedIntent: 'COST' },
      { no: 64, question: 'Cek SK lagi', expectedIntent: 'ACADEMIC_PROGRAM' }
    ]
  },
  {
    name: 'H: Ambiguous Queries - Edge cases',
    tests: [
      { no: 65, question: 'Berapa?', expectedIntent: 'COST' },
      { no: 66, question: 'Apa ini?', expectedIntent: 'GREETING' },
      { no: 67, question: 'Gimana?', expectedIntent: 'GREETING' },
      { no: 68, question: 'Bisa?', expectedIntent: 'GREETING' }
    ]
  }
];

// Global state for flow tracking
let testResults = [];
let globalChatId = `uat-${uuidv4()}`;
let flowTracking = {};

/**
 * Send message via webhook and wait for processing
 */
async function sendWebhookMessage(chatId, text, testNo) {
  const messageId = uuidv4();
  const timestamp = Date.now();
  
  try {
    console.log(`\n[TEST #${testNo}] Sending: "${text.substring(0, 80)}..."`);
    
    const payload = {
      phone: chatId,
      sender: chatId,
      text,
      messageId,
      timestamp,
      id: messageId
    };
    
    const response = await axios.post(WEBHOOK_ENDPOINT, payload, {
      timeout: TIMEOUT_MS,
      validateStatus: () => true // Don't throw on any status
    });
    
    console.log(`[TEST #${testNo}] Webhook responded with status ${response.status}`);
    
    // Wait for async processing
    await sleep(500);
    
    return {
      success: response.status === 200,
      messageId,
      timestamp
    };
  } catch (error) {
    console.error(`[TEST #${testNo}] Webhook error:`, error.message);
    return {
      success: false,
      messageId,
      timestamp,
      error: error.message
    };
  }
}

/**
 * Poll bot state for results (simplified - real implementation would capture logs)
 */
async function waitForBotResponse(chatId, messageId, timeout = TIMEOUT_MS) {
  const startTime = Date.now();
  
  // In production audit, we'd:
  // 1. Capture logs from /tmp/provider_traces.log
  // 2. Read /tmp/final_wa_outputs.log for final message
  // 3. Parse intent detection traces
  // 4. Extract RAG queries and results
  
  while (Date.now() - startTime < timeout) {
    try {
      // Check if final WA message was logged
      const finalWaLog = path.join(__dirname, 'tmp', 'final_wa_outputs.log');
      if (fs.existsSync(finalWaLog)) {
        const content = fs.readFileSync(finalWaLog, 'utf-8');
        if (content.includes(messageId) || content.length > 100) {
          return { 
            success: true,
            hasOutput: true 
          };
        }
      }
    } catch (e) {}
    
    await sleep(POLL_INTERVAL_MS);
  }
  
  return { 
    success: true,
    timeout: true,
    message: 'Processing timeout (bot may be slow or hung)'
  };
}

/**
 * Extract latest bot response from logs
 */
function extractLatestBotResponse() {
  try {
    const finalWaLog = path.join(__dirname, 'tmp', 'final_wa_outputs.log');
    if (!fs.existsSync(finalWaLog)) return null;
    
    const content = fs.readFileSync(finalWaLog, 'utf-8');
    const lines = content.split('\n').reverse();
    
    // Find the last "=== FINAL WA MESSAGE ===" block
    let message = null;
    let inBlock = false;
    let blockLines = [];
    
    for (const line of lines) {
      if (line.includes('=== FINAL WA MESSAGE ===')) {
        inBlock = true;
      } else if (inBlock && line.includes('=== BEFORE DECORATE ===')) {
        break;
      } else if (inBlock) {
        blockLines.unshift(line);
      }
    }
    
    if (blockLines.length > 0) {
      message = blockLines.join('\n').trim();
    }
    
    return message;
  } catch (error) {
    return null;
  }
}

/**
 * Extract intent detection from logs
 */
function extractDetectedIntent(testNo) {
  try {
    const tracesLog = path.join(__dirname, 'tmp', 'provider_traces.log');
    if (!fs.existsSync(tracesLog)) return null;
    
    const content = fs.readFileSync(tracesLog, 'utf-8');
    const lines = content.split('\n').reverse();
    
    for (const line of lines) {
      if (line.includes('TRACE_INTENT')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.detectedIntent) {
            return parsed.detectedIntent;
          }
        } catch (e) {}
      }
    }
  } catch (error) {}
  
  return null;
}

/**
 * Run a single test
 */
async function runTest(testCase, parentChatId = null) {
  const { no, question, expectedIntent, context = false } = testCase;
  
  // Use same chatId for context tests
  const chatId = context ? parentChatId || globalChatId : globalChatId;
  
  const result = {
    testNo: no,
    question,
    expectedIntent,
    status: 'RUNNING',
    timestamp: new Date().toISOString(),
    details: {}
  };
  
  try {
    // Send message
    const webhookResult = await sendWebhookMessage(chatId, question, no);
    if (!webhookResult.success) {
      result.status = 'FAIL';
      result.failReason = 'WEBHOOK_ERROR';
      result.details.webhookError = webhookResult.error;
      testResults.push(result);
      return result;
    }
    
    // Wait for processing
    const processingResult = await waitForBotResponse(chatId, webhookResult.messageId);
    
    // Extract results from logs
    const detectedIntent = extractDetectedIntent(no);
    const finalMessage = extractLatestBotResponse();
    
    result.details = {
      detectedIntent,
      finalMessage: finalMessage ? finalMessage.substring(0, 500) : null,
      webhookSuccess: true
    };
    
    // Determine if test passed
    const intentMatch = !expectedIntent || detectedIntent === expectedIntent;
    const hasResponse = !!finalMessage && finalMessage.length > 10;
    
    if (intentMatch && hasResponse) {
      result.status = 'PASS';
    } else if (!intentMatch) {
      result.status = 'FAIL';
      result.failReason = 'INTENT_MISMATCH';
    } else if (!hasResponse) {
      result.status = 'FAIL';
      result.failReason = 'NO_RESPONSE';
    }
    
  } catch (error) {
    result.status = 'ERROR';
    result.error = error.message;
  }
  
  testResults.push(result);
  
  // Print result
  const statusIcon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${statusIcon} Test #${no}: ${result.status} - Intent: ${result.details.detectedIntent || 'N/A'}`);
  
  return result;
}

/**
 * Run all test scenarios
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(80));
  console.log('UAT END-TO-END PRODUCTION FLOW AUDIT');
  console.log('='.repeat(80));
  console.log(`Start Time: ${new Date().toISOString()}`);
  console.log(`Bot URL: ${BOT_URL}`);
  console.log(`Test ChatId: ${globalChatId}`);
  console.log('='.repeat(80) + '\n');
  
  let scenarioIndex = 0;
  
  for (const scenario of TEST_SCENARIOS) {
    scenarioIndex++;
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`SCENARIO ${String.fromCharCode(64 + scenarioIndex)}: ${scenario.name}`);
    console.log(`${'─'.repeat(80)}`);
    
    let parentContext = null;
    
    for (const test of scenario.tests) {
      const result = await runTest(test, parentContext);
      
      // Track parent context for multi-turn tests
      if (test.context && result.status === 'PASS') {
        parentContext = globalChatId;
      }
      
      // Small delay between tests
      await sleep(300);
    }
  }
  
  return testResults;
}

/**
 * Generate audit report
 */
function generateReport(results) {
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const errors = results.filter(r => r.status === 'ERROR').length;
  const total = results.length;
  const successRate = ((passed / total) * 100).toFixed(2);
  
  let report = `
# UAT END-TO-END PRODUCTION FLOW AUDIT REPORT

**Generated:** ${new Date().toISOString()}  
**Bot URL:** ${BOT_URL}  
**Test ChatId:** ${globalChatId}

---

## Executive Summary

- **Total Tests:** ${total}
- **Passed:** ${passed} (${successRate}%)
- **Failed:** ${failed}
- **Errors:** ${errors}
- **Status:** ${successRate >= 98 ? '✅ PRODUCTION READY' : successRate >= 80 ? '⚠️ NEEDS REVIEW' : '❌ NOT READY'}

---

## Results by Scenario

`;

  // Group by scenario
  const scenarioResults = {};
  TEST_SCENARIOS.forEach((scenario, idx) => {
    const scenarioLetter = String.fromCharCode(65 + idx);
    scenarioResults[scenarioLetter] = {
      name: scenario.name,
      tests: scenario.tests.map(t => t.no)
    };
  });
  
  for (const [letter, scenario] of Object.entries(scenarioResults)) {
    const scenarioTests = results.filter(r => scenario.tests.includes(r.testNo));
    const scenarioPassed = scenarioTests.filter(r => r.status === 'PASS').length;
    const scenarioTotal = scenarioTests.length;
    const scenarioRate = ((scenarioPassed / scenarioTotal) * 100).toFixed(0);
    
    report += `
### Scenario ${letter}: ${scenario.name}

**Result:** ${scenarioPassed}/${scenarioTotal} (${scenarioRate}%)

| Test # | Question | Intent | Status |
|--------|----------|--------|--------|
`;
    
    for (const test of scenarioTests) {
      const question = test.question.substring(0, 50);
      const intent = test.details?.detectedIntent || 'N/A';
      const status = test.status === 'PASS' ? '✅' : test.status === 'FAIL' ? '❌' : '⚠️';
      report += `| ${test.testNo} | ${question} | ${intent} | ${status} |\n`;
    }
    
    report += '\n';
  }
  
  // Failure details
  if (failed > 0) {
    report += '\n---\n\n## Failure Analysis\n\n';
    
    const failures = results.filter(r => r.status === 'FAIL' || r.status === 'ERROR');
    for (const failure of failures) {
      report += `
### Test #${failure.testNo}: ${failure.question}

**Status:** ${failure.status}  
**Reason:** ${failure.failReason || failure.error}  
**Expected Intent:** ${failure.expectedIntent}  
**Detected Intent:** ${failure.details?.detectedIntent || 'N/A'}  

**Final Message:**
\`\`\`
${failure.details?.finalMessage || 'No message'}
\`\`\`

`;
    }
  }
  
  report += '\n---\n\n## Raw Test Results\n\n';
  report += '```json\n';
  report += JSON.stringify(results, null, 2);
  report += '\n```\n';
  
  return report;
}

/**
 * Save report to files
 */
function saveReport(report, results) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  
  // Save markdown report
  const reportPath = path.join(__dirname, `UAT_E2E_REPORT_${timestamp}.md`);
  fs.writeFileSync(reportPath, report, 'utf-8');
  console.log(`\n✅ Report saved: ${reportPath}`);
  
  // Save JSON results
  const jsonPath = path.join(__dirname, `uat-e2e-results-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    botUrl: BOT_URL,
    testChatId: globalChatId,
    summary: {
      total: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => r.status === 'FAIL').length,
      errors: results.filter(r => r.status === 'ERROR').length
    },
    results
  }, null, 2), 'utf-8');
  console.log(`✅ JSON results saved: ${jsonPath}`);
}

/**
 * Utility: sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Run all tests
    const results = await runAllTests();
    
    // Generate and save report
    const report = generateReport(results);
    saveReport(report, results);
    
    // Print summary
    const passed = results.filter(r => r.status === 'PASS').length;
    const total = results.length;
    const successRate = ((passed / total) * 100).toFixed(2);
    
    console.log('\n' + '='.repeat(80));
    console.log('AUDIT COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed} (${successRate}%)`);
    console.log(`Failed: ${total - passed}`);
    console.log('='.repeat(80));
    
    process.exit(passed === total ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  runAllTests,
  generateReport,
  sendWebhookMessage
};
