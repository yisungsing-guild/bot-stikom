#!/usr/bin/env node

/**
 * Simple RAG Audit Test Runner
 * 
 * Usage:
 *   node run-rag-audit.js
 * 
 * This runs test queries and shows the audit results
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Test queries
const queries = [
  'Apa itu TI',
  'TI belajar apa saja',
  'TI fokus ke apa',
  'Prospek kerja TI',
  'Apa itu SI',
  'SI belajar apa saja',
  'Ada kampus selain Renon'
];

async function main() {
  console.log('=========================================');
  console.log('Starting RAG System Audit Test');
  console.log('=========================================\n');

  // Set environment
  const env = {
    ...process.env,
    RAG_AUDIT_LOGGING: 'true',
    RAG_DEBUG_INTENT_FILTERING: 'true',
    NODE_ENV: 'test'
  };

  console.log('Environment:');
  console.log('  RAG_AUDIT_LOGGING:', env.RAG_AUDIT_LOGGING);
  console.log('  RAG_DEBUG_INTENT_FILTERING:', env.RAG_DEBUG_INTENT_FILTERING);
  console.log('');

  // Run test script with environment
  try {
    console.log('Running audit test...\n');
    const { stdout, stderr } = await execAsync('node rag-audit-test.js', {
      env,
      cwd: __dirname,
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });

    if (stdout) {
      console.log(stdout);
    }
    if (stderr) {
      console.error('STDERR:', stderr);
    }

  } catch (error) {
    console.error('Error running audit test:', error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
  }

  // Check and display audit logs
  console.log('\n=========================================');
  console.log('Checking Audit Logs');
  console.log('=========================================\n');

  const auditLogsDir = path.join(__dirname, 'rag-audit-logs');
  if (fs.existsSync(auditLogsDir)) {
    const files = fs.readdirSync(auditLogsDir);
    console.log(`Found ${files.length} audit log files:\n`);

    // Show latest query retrieval log
    const queryFiles = files.filter(f => f.startsWith('query-retrieval'));
    if (queryFiles.length > 0) {
      const latest = queryFiles.sort().pop();
      console.log(`Latest Query Retrieval Log: ${latest}\n`);
      console.log('Sample entries:');

      const filepath = path.join(auditLogsDir, latest);
      const content = fs.readFileSync(filepath, 'utf8');
      const lines = content.trim().split('\n').slice(-3); // Last 3 entries

      for (const line of lines) {
        try {
          const log = JSON.parse(line);
          console.log(`\n  Q: "${log.question}"`);
          console.log(`  Intent: ${log.detectedIntent}`);
          console.log(`  Before filtering: ${log.beforeFiltering.count} chunks`);
          console.log(`  After filtering: ${log.afterFiltering.count} chunks`);
          console.log(`  Filtered: ${log.filteringStats.filtered} (${log.filteringStats.filterRate})`);

          // Show top 3 before and after
          if (log.beforeFiltering.chunks.length > 0) {
            console.log('  Top 3 before filtering:');
            for (const chunk of log.beforeFiltering.chunks.slice(0, 3)) {
              console.log(`    - ${chunk.filename} [${chunk.docCategory}] (${chunk.score.toFixed(3)})`);
            }
          }

          if (log.afterFiltering.chunks.length > 0) {
            console.log('  Top 3 after filtering:');
            for (const chunk of log.afterFiltering.chunks.slice(0, 3)) {
              console.log(`    - ${chunk.filename} [${chunk.docCategory}] (${chunk.score.toFixed(3)})`);
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    // Show filtering decisions log
    const decisionFiles = files.filter(f => f.startsWith('filtering-decisions'));
    if (decisionFiles.length > 0) {
      const latest = decisionFiles.sort().pop();
      console.log(`\n\nFiltering Decisions Log: ${latest}\n`);

      const filepath = path.join(auditLogsDir, latest);
      const content = fs.readFileSync(filepath, 'utf8');
      const lines = content.trim().split('\n').slice(-10); // Last 10 entries

      const decisions = {};
      for (const line of lines) {
        try {
          const log = JSON.parse(line);
          const key = `${log.intent}|${log.decision}|${log.reason}`;
          decisions[key] = (decisions[key] || 0) + 1;
        } catch (e) {
          // Ignore
        }
      }

      console.log('Decision Summary:');
      for (const [key, count] of Object.entries(decisions)) {
        const [intent, decision, reason] = key.split('|');
        console.log(`  ${decision} - ${reason}: ${count} (intent: ${intent})`);
      }
    }

  } else {
    console.log('No audit logs found. Create rag-audit-logs/ directory first.');
  }

  console.log('\n=========================================');
  console.log('Audit Test Complete');
  console.log('=========================================');
}

main().catch(console.error);
