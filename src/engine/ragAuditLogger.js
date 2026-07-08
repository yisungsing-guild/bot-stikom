/**
 * RAG System End-to-End Audit Logging
 * 
 * This enhanced logging helps debug intent-aware filtering issues.
 * Enable with: RAG_AUDIT_LOGGING=true
 */

const fs = require('fs');
const path = require('path');

class RagAuditLogger {
  constructor() {
    this.logsDir = path.join(__dirname, '..', '..', 'rag-audit-logs');
    this.ensureLogsDir();
  }

  ensureLogsDir() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Log ingest details
   */
  logIngest(trainingId, totalChunks, enrichedChunks) {
    if (process.env.RAG_AUDIT_LOGGING !== 'true') return;

    const timestamp = new Date().toISOString();
    const filename = `ingest-${timestamp.split('T')[0]}.log`;
    const filepath = path.join(this.logsDir, filename);

    const log = {
      timestamp,
      event: 'INGEST',
      trainingId,
      totalChunks,
      enrichedChunks,
      enrichmentRate: enrichedChunks / totalChunks
    };

    fs.appendFileSync(filepath, JSON.stringify(log) + '\n', 'utf8');
  }

  /**
   * Log chunk enrichment details
   */
  logChunkEnrichment(chunkId, category, confidence, patterns) {
    if (process.env.RAG_AUDIT_LOGGING !== 'true') return;

    const timestamp = new Date().toISOString();
    const filename = `chunk-enrichment-${timestamp.split('T')[0]}.log`;
    const filepath = path.join(this.logsDir, filename);

    const log = {
      timestamp,
      event: 'CHUNK_ENRICHMENT',
      chunkId,
      category,
      confidence,
      patternsMatched: patterns
    };

    fs.appendFileSync(filepath, JSON.stringify(log) + '\n', 'utf8');
  }

  /**
   * Log query retrieval with full details
   */
  logQueryRetrieval(question, userIntent, topChunksBeforeFiltering, topChunksAfterFiltering) {
    if (process.env.RAG_AUDIT_LOGGING !== 'true') return;

    const timestamp = new Date().toISOString();
    const filename = `query-retrieval-${timestamp.split('T')[0]}.jsonl`;
    const filepath = path.join(this.logsDir, filename);

    const log = {
      timestamp,
      event: 'QUERY_RETRIEVAL',
      question: String(question || '').substring(0, 200),
      detectedIntent: userIntent,
      beforeFiltering: {
        count: topChunksBeforeFiltering.length,
        chunks: topChunksBeforeFiltering.slice(0, 20).map((s, idx) => ({
          rank: idx + 1,
          chunkId: s.item.id,
          filename: s.item.filename,
          docCategory: s.item.docCategory || s.item.category || 'UNKNOWN',
          score: Number(s.score.toFixed(4)),
          compositeScore: Number(s.compositeScore ? s.compositeScore.toFixed(4) : 0),
          preview: String(s.item.chunk || '').substring(0, 100).replace(/\n/g, ' ')
        }))
      },
      afterFiltering: {
        count: topChunksAfterFiltering.length,
        chunks: topChunksAfterFiltering.slice(0, 20).map((s, idx) => ({
          rank: idx + 1,
          chunkId: s.item.id,
          filename: s.item.filename,
          docCategory: s.item.docCategory || s.item.category || 'UNKNOWN',
          score: Number(s.score.toFixed(4)),
          compositeScore: Number(s.compositeScore ? s.compositeScore.toFixed(4) : 0),
          preview: String(s.item.chunk || '').substring(0, 100).replace(/\n/g, ' ')
        }))
      },
      filteringStats: {
        totalBefore: topChunksBeforeFiltering.length,
        totalAfter: topChunksAfterFiltering.length,
        filtered: topChunksBeforeFiltering.length - topChunksAfterFiltering.length,
        filterRate: ((topChunksBeforeFiltering.length - topChunksAfterFiltering.length) / Math.max(topChunksBeforeFiltering.length, 1) * 100).toFixed(2) + '%'
      }
    };

    fs.appendFileSync(filepath, JSON.stringify(log) + '\n', 'utf8');
  }

  /**
   * Log filtering decisions with reasons
   */
  logFilteringDecision(chunkId, filename, docCategory, intent, decision, reason) {
    if (process.env.RAG_AUDIT_LOGGING !== 'true') return;

    const timestamp = new Date().toISOString();
    const dateStr = timestamp.split('T')[0];
    const filename_log = `filtering-decisions-${dateStr}.log`;
    const filepath = path.join(this.logsDir, filename_log);

    const log = {
      timestamp,
      event: 'FILTERING_DECISION',
      chunkId,
      sourceFile: filename,
      docCategory,
      intent,
      decision, // 'ACCEPT' | 'REJECT'
      reason
    };

    fs.appendFileSync(filepath, JSON.stringify(log) + '\n', 'utf8');
  }

  /**
   * Create summary report
   */
  generateSummary() {
    if (!fs.existsSync(this.logsDir)) {
      return 'No audit logs found';
    }

    const files = fs.readdirSync(this.logsDir);
    const report = [];

    report.push('=== RAG AUDIT LOG SUMMARY ===\n');
    report.push(`Generated: ${new Date().toISOString()}\n`);
    report.push(`Log files: ${files.length}\n\n`);

    // Read latest query-retrieval log
    const queryFiles = files.filter(f => f.startsWith('query-retrieval'));
    if (queryFiles.length > 0) {
      const latest = queryFiles.sort().pop();
      report.push(`Latest Query Log: ${latest}\n`);
      const filepath = path.join(this.logsDir, latest);
      const content = fs.readFileSync(filepath, 'utf8');
      const lines = content.trim().split('\n').slice(-5); // Last 5 queries
      report.push('Last 5 Queries:\n');
      for (const line of lines) {
        try {
          const log = JSON.parse(line);
          report.push(`  Q: "${log.question}"\n`);
          report.push(`     Intent: ${log.detectedIntent}\n`);
          report.push(`     Before: ${log.beforeFiltering.count} chunks\n`);
          report.push(`     After: ${log.afterFiltering.count} chunks\n`);
          report.push(`     Filtered: ${log.filteringStats.filtered} (${log.filteringStats.filterRate})\n\n`);
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    return report.join('');
  }

  /**
   * Get detailed report for specific query
   */
  getQueryReport(queryText) {
    if (!fs.existsSync(this.logsDir)) {
      return null;
    }

    const queryFiles = fs.readdirSync(this.logsDir).filter(f => f.startsWith('query-retrieval'));
    const queryText_lower = String(queryText || '').toLowerCase();

    for (const file of queryFiles.sort().reverse()) {
      const filepath = path.join(this.logsDir, file);
      const content = fs.readFileSync(filepath, 'utf8');
      const lines = content.trim().split('\n');

      for (const line of lines) {
        try {
          const log = JSON.parse(line);
          if (log.question.toLowerCase().includes(queryText_lower)) {
            return log;
          }
        } catch (e) {
          // Ignore
        }
      }
    }

    return null;
  }
}

module.exports = {
  RagAuditLogger,
  auditLogger: new RagAuditLogger()
};
