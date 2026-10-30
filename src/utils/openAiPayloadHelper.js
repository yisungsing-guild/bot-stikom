'use strict';

/**
 * src/utils/openAiPayloadHelper.js
 *
 * Central helper for Chat Completions payload compatibility with OpenAI models,
 * specifically enforcing contracts for GPT-6 Luna and reasoning models:
 *
 * Contract Invariants:
 * 1. For Chat Completions using function calling (tools / functions), set reasoning_effort: "none".
 * 2. If reasoning_effort is NOT "none", do NOT send temperature or top_p.
 * 3. Modern models (including gpt-6-luna) must use max_completion_tokens, never legacy max_tokens.
 * 4. response_format / structured outputs are preserved.
 */

function sanitizeOpenAiChatPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return {};
  const p = { ...payload };
  const modelName = String(p.model || '').toLowerCase();
  const isGpt6OrReasoning = /gpt-6|luna|o1|o3/i.test(modelName);

  // 1. Function calling / tools: enforce reasoning_effort: "none"
  const hasTools = (Array.isArray(p.tools) && p.tools.length > 0) || Boolean(p.tool_choice);
  const hasFunctions = (Array.isArray(p.functions) && p.functions.length > 0) || Boolean(p.function_call);
  if (hasTools || hasFunctions) {
    p.reasoning_effort = 'none';
  }

  // 1b. Structured JSON-schema extraction (e.g. semantic parsing) on GPT-6 / reasoning models:
  // with a small max_completion_tokens budget, hidden reasoning can consume the entire budget
  // (finish_reason="length", empty content). Default to reasoning_effort "none" unless the caller
  // explicitly requested a reasoning level.
  const hasJsonSchema = Boolean(p.response_format && p.response_format.type === 'json_schema');
  if (hasJsonSchema && isGpt6OrReasoning && p.reasoning_effort === undefined) {
    p.reasoning_effort = 'none';
  }

  // 2. For GPT-6 Luna and reasoning models (or active reasoning_effort),
  // strip temperature and top_p completely to avoid 400 Bad Request
  // ("Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.")
  if (isGpt6OrReasoning || (p.reasoning_effort && p.reasoning_effort !== 'none')) {
    delete p.temperature;
    delete p.top_p;
  }

  // 3. Ensure max_completion_tokens for GPT-6 Luna and modern models
  if (isGpt6OrReasoning || /^gpt-(?:[4-9]|4o)/i.test(modelName)) {
    if (p.max_tokens !== undefined && p.max_completion_tokens === undefined) {
      p.max_completion_tokens = p.max_tokens;
      delete p.max_tokens;
    }
  }

  return p;
}

module.exports = {
  sanitizeOpenAiChatPayload
};
