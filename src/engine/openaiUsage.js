const OPENAI_USAGE = Object.freeze({
  ANSWER_GENERATION: 'answer_generation',
  QUERY_REWRITE: 'query_rewrite',
  DOCUMENT_INGESTION: 'document_ingestion',
  TRANSLATION: 'translation',
  EMBEDDING: 'embedding',
  VISION_EXTRACTION: 'vision_extraction'
});

module.exports = { OPENAI_USAGE };
