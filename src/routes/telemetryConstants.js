const PIPELINE_TYPES = {
  RULE: 'rule',
  RAG: 'rag',
  COMPOSER: 'composer',
  HUMANIZER: 'humanizer',
  FEE_FAST_PATH: 'fee_fast_path',
  LEGACY: 'legacy'
};

const SOURCE_TYPES = {
  RULE: 'rule',
  RAG: 'rag',
  FEE: 'fee',
  AI: 'ai',
  WEB: 'web',
  UNKNOWN: 'unknown'
};

const RESPONSE_MODES = {
  FULL: 'full',
  PARTIAL: 'partial',
  TEXT: 'text'
};

const FALLBACK_REASONS = {
  TIMEOUT: 'timeout',
  NO_ANSWER: 'no_answer',
  LEGACY: 'legacy'
};

function buildFinalPipeline(...stages) {
  return stages.filter(Boolean).join('->');
}

module.exports = {
  PIPELINE_TYPES,
  SOURCE_TYPES,
  RESPONSE_MODES,
  FALLBACK_REASONS,
  buildFinalPipeline
};
