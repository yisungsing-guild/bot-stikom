#!/usr/bin/env node

/**
 * Real Production UAT Auditor
 * 
 * Menjalankan bot server REAL dan capture complete flow:
 * - Actual Intent Detection → Rule Engine → RAG → Humanizer → Formatter → Provider
 * - Parse logs real-time
 * - Comprehensive audit report
 */

const http = require('http');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const BOT_PORT = process.env.BOT_PORT || 4001;
const BOT_URL = `http://localhost:${BOT_PORT}`;
const WEBHOOK_ENDPOINT = `${BOT_URL}/fonnte/webhook`;

// Log file paths
const TMP_DIR = path.join(__dirname, 'tmp');
const PROVIDER_TRACES_LOG = path.join(TMP_DIR, 'provider_traces.log');
const FINAL_WA_OUTPUT_LOG = path.join(TMP_DIR, 'final_wa_outputs.log');
const PROVIDER_LOG = path.join(TMP_DIR, 'provider_send_results.log');

// Comprehensive test scenarios
const TEST_SCENARIOS = [
  {
    scenario: 'A',
    name: 'Menu PMB - Greeting & Menu',
    tests: [
      { id: 1, q: 'Halo', intent: 'GREETING' },
      { id: 2, q: 'Menu', intent: 'MENU' }
    ]
  },
  {
    scenario: 'B',
    name: 'Program Definition',
    tests: [
      { id: 3, q: 'Apa itu SI?', intent: 'ACADEMIC_PROGRAM' },
      { id: 4, q: 'Definisi TI', intent: 'ACADEMIC_PROGRAM' },
      { id: 5, q: 'Jelaskan BD', intent: 'ACADEMIC_PROGRAM' },
      { id: 6, q: 'SK apa sih?', intent: 'ACADEMIC_PROGRAM' },
      { id: 7, q: 'Program MI?', intent: 'ACADEMIC_PROGRAM' }
    ]
  },
  {
    scenario: 'C',
    name: 'Program & Prospect',
    tests: [
      { id: 8, q: 'SI prospeknya?', intent: 'ACADEMIC_PROGRAM' },
      { id: 9, q: 'TI dan karir?', intent: 'ACADEMIC_PROGRAM' },
      { id: 10, q: 'BD peluang kerja?', intent: 'ACADEMIC_PROGRAM' },
      { id: 11, q: 'SK jenjang?', intent: 'ACADEMIC_PROGRAM' },
      { id: 12, q: 'MI arah karir?', intent: 'ACADEMIC_PROGRAM' }
    ]
  },
  {
    scenario: 'D',
    name: 'Fee Inquiry - All Waves',
    tests: [
      { id: 13, q: 'Biaya TI gelombang 1A?', intent: 'COST' },
      { id: 14, q: 'Harga SI 2C?', intent: 'COST' },
      { id: 15, q: 'Biaya SK 1B?', intent: 'COST' },
      { id: 16, q: 'MI gelombang 3?', intent: 'COST' },
      { id: 17, q: 'BD Khusus?', intent: 'COST' },
      { id: 18, q: 'Biaya masuk TI?', intent: 'COST' },
      { id: 19, q: 'DPP SI?', intent: 'COST' },
      { id: 20, q: 'Uang kuliah BD?', intent: 'COST' }
    ]
  },
  {
    scenario: 'E',
    name: 'Fee Breakdown - Detail',
    tests: [
      { id: 21, q: 'Rincian biaya TI 1A lengkap?', intent: 'COST' },
      { id: 22, q: 'Detail SI 2C?', intent: 'COST' },
      { id: 23, q: 'Breakdown SK 1B?', intent: 'COST' },
      { id: 24, q: 'Komposisi MI 3?', intent: 'COST' },
      { id: 25, q: 'Rincian BD Khusus?', intent: 'COST' },
      { id: 26, q: 'DPP TI 1A detil?', intent: 'COST' },
      { id: 27, q: 'SI 2C apa saja?', intent: 'COST' },
      { id: 28, q: 'SK 1B cicilan?', intent: 'COST' },
      { id: 29, q: 'MI 3 DPP?', intent: 'COST' },
      { id: 30, q: 'BD biaya apa aja?', intent: 'COST' },
      { id: 31, q: 'TI cicilan?', intent: 'COST' },
      { id: 32, q: 'Biaya admin SI?', intent: 'COST' },
      { id: 33, q: 'SPP SK?', intent: 'COST' },
      { id: 34, q: 'Total MI?', intent: 'COST' }
    ]
  },
  {
    scenario: 'F',
    name: 'Multi-turn Conversation',
    tests: [
      { id: 35, q: 'TI apa?', intent: 'ACADEMIC_PROGRAM', multiturn: true },
      { id: 36, q: 'Prospeknya?', intent: 'ACADEMIC_PROGRAM', multiturn: true },
      { id: 37, q: 'Biaya?', intent: 'COST', multiturn: true },
      { id: 38, q: 'Gelombang 1A', intent: 'COST', multiturn: true },
      { id: 39, q: 'Rincian?', intent: 'COST', multiturn: true }
    ]
  },
  {
    scenario: 'G',
    name: 'Program Switching',
    tests: [
      { id: 40, q: 'TI vs SI?', intent: 'ACADEMIC_PROGRAM' },
      { id: 41, q: 'BD biaya', intent: 'COST' },
      { id: 42, q: 'Balik SI', intent: 'ACADEMIC_PROGRAM' },
      { id: 43, q: 'SK vs MI?', intent: 'ACADEMIC_PROGRAM' },
      { id: 44, q: 'SK info', intent: 'ACADEMIC_PROGRAM' },
      { id: 45, q: 'SI', intent: 'ACADEMIC_PROGRAM' },
      { id: 46, q: 'SI biaya 1A', intent: 'COST' },
      { id: 47, q: 'TI 2C', intent: 'COST' },
      { id: 48, q: 'MI juga', intent: 'COST' },
      { id: 49, q: 'BD', intent: 'ACADEMIC_PROGRAM' },
      { id: 50, q: 'BD semua biaya', intent: 'COST' },
      { id: 51, q: 'SK lagi', intent: 'ACADEMIC_PROGRAM' }
    ]
  },
  {
    scenario: 'H',
    name: 'Edge Cases - Ambiguous',
    tests: [
      { id: 52, q: 'Berapa?', shouldRespond: true },
      { id: 53, q: 'Apa?', shouldRespond: true },
      { id: 54, q: 'Gimana?', shouldRespond: true },
      { id: 55, q: 'Bisa?', shouldRespond: true }
    ]
  }
];

// State
let testResults = [];
let botProcess = null;
let logWatchers = {};
const chatId = `uat-${uuidv4()}`;

/**
 * Ensure tmp directory exists and clear old logs
 */
function initLogs() {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
  
  // Keep only recent portion of logs to avoid massive files
  const truncateLog = (logPath) => {
    try {
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf-8');
        const lines = content.split('\n');
        if (lines.length > 5000) {
          fs.writeFileSync(logPath, lines.slice(-5000).join('\n'), 'utf-8');
        }
      }
    } catch (e) {}
  };
  
  truncateLog(PROVIDER_TRACES_LOG);
  truncateLog(FINAL_WA_OUTPUT_LOG);
  truncateLog(PROVIDER_LOG);
}

/**
 * Start bot server
 */
async function startBotServer() {
  return new Promise((resolve, reject) => {
    console.log(`\n[Server] Starting bot at ${BOT_URL}...`);
    
    botProcess = spawn('node', ['src/index.js'], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: BOT_PORT,
        NODE_ENV: 'test',
        ENABLE_RAG: 'true',
        DISABLE_BROADCAST_SCHEDULER: 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let serverReady = false;
    const timeout = setTimeout(() => {
      if (!serverReady) {
        botProcess.kill();
        reject(new Error('Bot server startup timeout'));
      }
    }, 10000);
    
    botProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Listening') || msg.includes('listening')) {
        serverReady = true;
        clearTimeout(timeout);
        resolve();
      }
    });
    
    botProcess.on('error', reject);
  });
}

/**
 * Wait for bot to be ready
 */
async function waitForBotReady(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await axios.get(`${BOT_URL}/admin/health`, {
        timeout: 1000,
        validateStatus: () => true
      }).catch(() => null);
      
      // Try webhook
      const res = await axios.get(`${BOT_URL}/fonnte/webhook`, {
        timeout: 1000,
        validateStatus: () => true
      });
      
      if (res.status === 200) {
        console.log('[Server] Bot is ready');
        await new Promise(r => setTimeout(r, 500));
        return true;
      }
    } catch (e) {}
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  throw new Error('Bot never became ready');
}

/**
 * Send test message via webhook
 */
async function sendTestMessage(testId, question) {
  const messageId = uuidv4();
  const timestamp = Math.floor(Date.now() / 1000);
  
  try {
    const response = await axios.post(WEBHOOK_ENDPOINT, {
      phone: chatId,
      sender: chatId,
      text: question,
      messageId,
      timestamp,
      id: messageId
    }, {
      timeout: 3000,
      validateStatus: () => true
    });
    
    return { success: response.status === 200, messageId, timestamp };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Parse logs to extract flow events
 */
function parseFlowFromLogs(messageId, testId) {
  const flow = {
    testId,
    messageId,
    intent: null,
    ruleMatched: null,
    ragUsed: false,
    ragScore: null,
    humanized: false,
    formatted: false,
    finalMessage: null,
    events: []
  };
  
  try {
    // Parse provider traces
    if (fs.existsSync(PROVIDER_TRACES_LOG)) {
      const content = fs.readFileSync(PROVIDER_TRACES_LOG, 'utf-8');
      const lines = content.split('\n').reverse().slice(0, 1000).reverse();
      
      for (const line of lines) {
        try {
          // Look for trace events mentioning this test
          if (line.includes(messageId) || line.includes(testId)) {
            const data = JSON.parse(line);
            
            if (data.tag === 'TRACE_INTENT_DETAILED' || data.tag === 'TRACE_INTENT') {
              flow.intent = data.detectedIntent || data.incomingIntent;
              flow.events.push({
                type: 'INTENT_DETECTED',
                intent: flow.intent,
                confidence: data.confidence || 'N/A'
              });
            }
            
            if (data.tag === 'TRACE_SESSION' && data.matchedRule) {
              flow.ruleMatched = data.matchedRule;
              flow.events.push({
                type: 'RULE_MATCHED',
                rule: flow.ruleMatched
              });
            }
            
            if (data.tag === 'TRACE_RAG' || data.tag === 'RAG_QUERY') {
              flow.ragUsed = true;
              flow.ragScore = data.confidenceScore;
              flow.events.push({
                type: 'RAG_QUERY',
                question: data.question?.substring(0, 50) || 'N/A',
                score: flow.ragScore
              });
            }
          }
        } catch (e) {}
      }
    }
    
    // Parse final WA output
    if (fs.existsSync(FINAL_WA_OUTPUT_LOG)) {
      const content = fs.readFileSync(FINAL_WA_OUTPUT_LOG, 'utf-8');
      const lines = content.split('\n').reverse().slice(0, 500).reverse();
      
      let inFinalBlock = false;
      let messageLines = [];
      
      for (const line of lines) {
        if (line.includes('=== FINAL WA MESSAGE ===')) {
          inFinalBlock = true;
        } else if (inFinalBlock) {
          if (line.includes('===') || line.includes('BEFORE') || line.includes('AFTER')) {
            break;
          }
          if (line.trim()) {
            messageLines.push(line);
          }
        }
      }
      
      if (messageLines.length > 0) {
        flow.finalMessage = messageLines.join('\n').trim().substring(0, 500);
        flow.events.push({
          type: 'FINAL_MESSAGE',
          length: flow.finalMessage.length
        });
      }
    }
  } catch (error) {
    console.error(`Error parsing logs: ${error.message}`);
  }
  
  return flow;
}

/**
 * Run single test
 */
async function runTest(testCase) {
  const { id, q, intent } = testCase;
  
  console.log(`[Test ${id}] ${q.substring(0, 60)}...`);
  
  try {
    // Send message
    const sendResult = await sendTestMessage(id, q);
    if (!sendResult.success) {
      return {
        id,
        question: q,
        expectedIntent: intent,
        status: 'FAIL',
        reason: 'WEBHOOK_SEND_FAILED',
        error: sendResult.error
      };
    }
    
    // Wait for async processing
    await new Promise(r => setTimeout(r, 1500));
    
    // Parse flow from logs
    const flow = parseFlowFromLogs(sendResult.messageId, id);
    
    // Determine pass/fail
    const intentMatch = !intent || flow.intent === intent;
    const hasResponse = !!flow.finalMessage && flow.finalMessage.length > 10;
    const status = intentMatch && hasResponse ? 'PASS' : 'FAIL';
    
    const result = {
      id,
      question: q,
      expectedIntent: intent,
      detectedIntent: flow.intent,
      status,
      flow,
      timestamp: new Date().toISOString()
    };
    
    if (status === 'FAIL') {
      result.reason = !intentMatch ? 'INTENT_MISMATCH' : 'NO_RESPONSE';
    }
    
    // Print result
    const icon = status === 'PASS' ? '✅' : '❌';
    console.log(`  ${icon} Intent: ${flow.intent || 'N/A'} | Response: ${hasResponse ? 'Yes' : 'No'}`);
    
    return result;
    
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return {
      id,
      question: q,
      expectedIntent: intent,
      status: 'ERROR',
      error: error.message
    };
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(80));
  console.log('UAT END-TO-END PRODUCTION FLOW AUDIT');
  console.log('='.repeat(80));
  console.log(`Start Time: ${new Date().toISOString()}`);
  console.log(`Bot URL: ${BOT_URL}`);
  console.log(`Test ChatId: ${chatId}`);
  console.log('='.repeat(80));
  
  const results = [];
  let scenarioIndex = 0;
  
  for (const scenario of TEST_SCENARIOS) {
    scenarioIndex++;
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`SCENARIO ${scenario.scenario}: ${scenario.name}`);
    console.log(`${'─'.repeat(80)}`);
    
    for (const test of scenario.tests) {
      const result = await runTest(test);
      results.push({ ...result, scenario: scenario.scenario, scenarioName: scenario.name });
      
      // Delay between tests
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  return results;
}

/**
 * Generate comprehensive report
 */
function generateReport(results) {
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const errors = results.filter(r => r.status === 'ERROR').length;
  const total = results.length;
  const rate = ((passed / total) * 100).toFixed(2);
  
  let md = `# UAT END-TO-END PRODUCTION FLOW AUDIT REPORT

**Generated:** ${new Date().toISOString()}  
**Bot URL:** ${BOT_URL}  
**Total Tests:** ${total}  
**Environment:** Production-like

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Tests | ${total} |
| Passed | ${passed} (${rate}%) |
| Failed | ${failed} |
| Errors | ${errors} |
| Status | ${rate >= 98 ? '✅ PRODUCTION READY' : rate >= 80 ? '⚠️ REVIEW NEEDED' : '❌ NOT READY'} |

---

## Results by Scenario

`;

  // Group by scenario
  const byScenario = {};
  for (const result of results) {
    if (!byScenario[result.scenario]) byScenario[result.scenario] = [];
    byScenario[result.scenario].push(result);
  }
  
  for (const [scenario, scenarioResults] of Object.entries(byScenario)) {
    const scenPassed = scenarioResults.filter(r => r.status === 'PASS').length;
    const scenRate = ((scenPassed / scenarioResults.length) * 100).toFixed(0);
    const scenName = scenarioResults[0]?.scenarioName || scenario;
    
    md += `
### Scenario ${scenario}: ${scenName}
**Result:** ${scenPassed}/${scenarioResults.length} (${scenRate}%)

| Test # | Question | Expected Intent | Detected Intent | Status |
|--------|----------|-----------------|-----------------|--------|
`;
    
    for (const r of scenarioResults) {
      const q = r.question.substring(0, 35);
      const expectedIntent = r.expectedIntent || 'N/A';
      const detectedIntent = r.detectedIntent || 'N/A';
      const icon = r.status === 'PASS' ? '✅' : '❌';
      md += `| ${r.id} | ${q} | ${expectedIntent} | ${detectedIntent} | ${icon} |\n`;
    }
    md += '\n';
  }
  
  // Failure analysis
  const failures = results.filter(r => r.status !== 'PASS');
  if (failures.length > 0) {
    md += `
---

## Failure Analysis (${failures.length} failures)

`;
    
    for (const failure of failures) {
      md += `
### Test #${failure.id}: "${failure.question}"

**Status:** ${failure.status}  
**Reason:** ${failure.reason || failure.error}  
**Expected Intent:** ${failure.expectedIntent}  
**Detected Intent:** ${failure.detectedIntent || 'N/A'}  

`;
      
      if (failure.flow?.finalMessage) {
        md += `**Final Message:**
\`\`\`
${failure.flow.finalMessage}
\`\`\`

`;
      }
    }
  }
  
  // Flow statistics
  md += `
---

## Processing Pipeline Statistics

`;
  
  const allRagTests = results.filter(r => r.flow?.ragUsed);
  const allRuleTests = results.filter(r => r.flow?.ruleMatched);
  
  md += `
- **RAG Queries:** ${allRagTests.length} (${((allRagTests.length / total) * 100).toFixed(1)}%)
- **Rule Engine Matches:** ${allRuleTests.length} (${((allRuleTests.length / total) * 100).toFixed(1)}%)
- **Humanized Responses:** ${results.filter(r => r.flow?.humanized).length}
- **Formatted Responses:** ${results.filter(r => r.flow?.formatted).length}

`;
  
  // Raw JSON
  md += `
---

## Raw Test Results

\`\`\`json
${JSON.stringify(results, null, 2)}
\`\`\`
`;
  
  return md;
}

/**
 * Save report
 */
function saveReport(report, results) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  
  // Markdown
  const mdPath = path.join(__dirname, `UAT_E2E_REAL_PRODUCTION_${timestamp}.md`);
  fs.writeFileSync(mdPath, report, 'utf-8');
  
  // JSON
  const jsonPath = path.join(__dirname, `uat-e2e-real-results-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    botUrl: BOT_URL,
    summary: {
      total: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => r.status !== 'PASS').length
    },
    results
  }, null, 2), 'utf-8');
  
  console.log(`\n✅ Report: ${mdPath}`);
  console.log(`✅ Results: ${jsonPath}`);
}

/**
 * Cleanup
 */
function cleanup() {
  if (botProcess) {
    console.log('\n[Server] Shutting down bot...');
    botProcess.kill();
  }
}

/**
 * Main
 */
async function main() {
  try {
    initLogs();
    
    // Start bot server
    await startBotServer();
    await waitForBotReady();
    
    // Run tests
    const results = await runAllTests();
    
    // Generate report
    const report = generateReport(results);
    saveReport(report, results);
    
    // Summary
    const passed = results.filter(r => r.status === 'PASS').length;
    const rate = ((passed / results.length) * 100).toFixed(2);
    
    console.log('\n' + '='.repeat(80));
    console.log('AUDIT COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total: ${results.length} | Passed: ${passed} (${rate}%) | Failed: ${results.length - passed}`);
    console.log('='.repeat(80));
    
    cleanup();
    process.exit(passed === results.length ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Fatal Error:', error.message);
    cleanup();
    process.exit(1);
  }
}

// Handle signals
process.on('SIGINT', () => {
  console.log('\n[Signal] Received SIGINT');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Signal] Received SIGTERM');
  cleanup();
  process.exit(0);
});

if (require.main === module) {
  main();
}

module.exports = { runAllTests, generateReport };
