---
name: fk-cost-aware-llm-pipeline
description: Use when an app calls LLM APIs and spend must be controlled - model routing by task complexity, budgets, narrow retries, prompt caching, batching and cost logging.
---

# Cost-aware LLM pipeline

Never quote model ids or prices from memory: read current ids, prices and caching rules from the provider's docs (for Claude, the `claude-api` skill). Keep model ids in configuration, not scattered through code.

## Steps

1. **Measure first**: log per call the model, input/output/cached tokens, cost, latency, feature name and outcome. Without this, routing thresholds are guesses.
2. **Route by complexity**: default to the cheapest model that passes the feature's evals (`fk-eval-harness`); escalate to a stronger model only on measurable signals (input size, item count, a failed validation, low confidence, an explicit "hard" task type).
   ```python
   def select_model(text_len: int, items: int, force: str | None = None) -> str:
       if force:
           return force
       if text_len >= cfg.complex_text_threshold or items >= cfg.complex_item_threshold:
           return cfg.model_strong
       return cfg.model_fast
   ```
   Log every routing decision so thresholds can be tuned on real data.
3. **Set budgets before running batches**: per request, per user, per job and per day. Check the running total before each call and stop with a clear error (`BudgetExceeded`) rather than overspending. Keep the tracker append-only (a list of cost records) so spend is auditable.
4. **Retry narrowly**: only transient errors (connection errors, rate limits/429 honoring `Retry-After`, overloaded/5xx), with exponential backoff, jitter and a small cap. Never retry authentication, permission or invalid-request errors. Set request timeouts.
5. **Cache prompts**: put stable content first (system prompt, tool definitions, long reference documents, few-shot examples) and mark the cache breakpoint after it; put volatile content (user input, retrieved snippets, timestamps) after the breakpoint. Any byte change before the breakpoint invalidates the cache. Check the provider's minimum cacheable length and cache lifetime, and verify hits via the cached-token fields in responses.
6. **Reduce tokens**: trim retrieved context to what the task needs, cap `max_tokens` per feature, ask for structured output instead of prose, summarise long histories, and deduplicate repeated requests with an application-level cache keyed by normalized input.
7. **Batch** non-interactive workloads through the provider's batch API when latency allows (typically much cheaper).
8. **Review monthly**: cost per feature and per successful outcome, cache hit rate, routing distribution; adjust thresholds with eval evidence.

## Rules

- Quality gates (evals) decide whether a cheaper model is acceptable, not intuition.
- Budgets fail closed for automated jobs; interactive features degrade gracefully (shorter answer, cheaper model, or a clear message).
- Spending limits are also set at the provider account level as a backstop.

## Anti-patterns

- The strongest model for every call regardless of task.
- Retrying every error (pays for permanent failures repeatedly).
- Dynamic text at the top of the prompt, defeating the cache.
- Hard-coded model names and prices across the codebase.
- No per-feature cost visibility.

_Source: adapted from ECC `skills/cost-aware-llm-pipeline` (MIT); dated price table removed; see NOTICE.md._
