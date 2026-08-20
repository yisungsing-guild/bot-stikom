/**
 * Performance Instrumentation Utility
 * 
 * Mengukur retrieval pipeline performance:
 * - Candidate count before/after limits
 * - MMR iterations dan comparisons
 * - Duration per stage
 */

class RetrievalMetrics {
  constructor(queryId) {
    this.queryId = queryId;
    this.startTime = Date.now();
    this.stages = {};
    this.mmrMetrics = {
      inputContexts: 0,
      preMMRLimit: 0,
      afterPreLimit: 0,
      iterations: 0,
      totalComparisons: 0,
      finalSelected: 0,
      duration: 0
    };
  }

  stageStart(stageName) {
    this.stages[stageName] = {
      startTime: Date.now(),
      endTime: null,
      duration: null
    };
  }

  stageEnd(stageName) {
    if (this.stages[stageName]) {
      this.stages[stageName].endTime = Date.now();
      this.stages[stageName].duration = this.stages[stageName].endTime - this.stages[stageName].startTime;
    }
  }

  recordMMRMetrics(data) {
    Object.assign(this.mmrMetrics, data);
  }

  getTotalDuration() {
    return Date.now() - this.startTime;
  }

  getReport() {
    const stageReport = {};
    for (const [name, timing] of Object.entries(this.stages)) {
      stageReport[name] = timing.duration || 0;
    }

    return {
      queryId: this.queryId,
      totalDuration: this.getTotalDuration(),
      stages: stageReport,
      mmr: this.mmrMetrics,
      summary: {
        candidateReductionRatio: this.mmrMetrics.preMMRLimit > 0
          ? (this.mmrMetrics.afterPreLimit / this.mmrMetrics.preMMRLimit).toFixed(2)
          : 'N/A',
        avgComparisonsPerIteration: this.mmrMetrics.iterations > 0
          ? Math.round(this.mmrMetrics.totalComparisons / this.mmrMetrics.iterations)
          : 0
      }
    };
  }

  printReport(label = '') {
    const report = this.getReport();
    console.log('\n' + '='.repeat(70));
    console.log(`METRICS: ${label}`);
    console.log('='.repeat(70));
    console.log('Total Duration:', report.totalDuration + 'ms');
    console.log('\nStages:');
    for (const [stage, duration] of Object.entries(report.stages)) {
      console.log(`  ${stage}: ${duration}ms`);
    }
    console.log('\nMMR Processing:');
    console.log(`  Input contexts: ${report.mmr.inputContexts}`);
    console.log(`  After pre-limit: ${report.mmr.afterPreLimit}`);
    console.log(`  Reduction ratio: ${report.summary.candidateReductionRatio}`);
    console.log(`  Iterations: ${report.mmr.iterations}`);
    console.log(`  Total comparisons: ${report.mmr.totalComparisons}`);
    console.log(`  Avg comparisons/iteration: ${report.summary.avgComparisonsPerIteration}`);
    console.log(`  Final selected: ${report.mmr.finalSelected}`);
    console.log(`  MMR duration: ${report.mmr.duration}ms`);
    console.log('='.repeat(70) + '\n');
    return report;
  }
}

module.exports = {
  RetrievalMetrics
};
