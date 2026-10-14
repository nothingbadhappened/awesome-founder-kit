---
name: fk-eval-harness
description: Use when building or changing LLM features or agent workflows - define capability and regression evals before the change, pick graders, measure pass@k / pass^k, and report results.
---

# Eval harness (eval-driven development)

Evals are the unit tests of LLM behaviour: define what "good" means before changing a prompt, model, tool or agent flow, then measure. The project's eval location and release thresholds win.

## Steps

1. **Define before changing anything** in `evals/<feature>.md` (or the project's eval folder), versioned with the code:
   - **Capability evals**: what the system must newly do. Task, success criteria (checklist), expected output.
   - **Regression evals**: behaviour that must not change. Baseline (commit SHA or checkpoint), existing cases, previous pass count.
   - Include unhappy paths: refusals, malformed input, empty context, adversarial/prompt-injection inputs, tool failures.
2. **Choose a grader per criterion**, cheapest deterministic first:
   - Code grader: exact match, tests pass, build succeeds, JSON schema validates, tool called with the right arguments.
   - Rule grader: regex/schema constraints, forbidden content, length limits.
   - Model grader (LLM-as-judge): a rubric with explicit criteria and a 1-5 score plus reasoning; use a different model or prompt from the one under test where possible; calibrate it against a few human-labelled examples.
   - Human grader: ambiguous or high-risk outputs (security, legal, medical, money); state the risk level and why.
3. **Build the dataset**: representative real inputs (scrubbed of personal data), edge cases, and every past production failure. Keep a held-out set you do not tune prompts against.
4. **Run** each case k times when outputs are stochastic; record model, prompt version, temperature, tool versions, cost and latency per run.
5. **Score**:
   - pass@k: at least one success in k attempts (useful when a human or retry loop picks the best).
   - pass^k: all k attempts succeed (use for release-critical, unattended paths).
   - Track cost and latency alongside quality; a pass-rate gain that doubles cost is a trade-off to decide, not a win by default.
6. **Report** and compare with the baseline:

```
EVAL REPORT: <feature>   baseline: <sha>   model: <id>   prompt: <version>
Capability: 4/5 (pass@3 = 100%)    Regression: 12/12 (pass^3 = 100%)
Cost/run: $0.004 (+10%)   p95 latency: 2.1 s (-5%)
Failures: <case> - <observed vs expected>
Status: READY FOR REVIEW | NOT READY
```

7. **Gate**: release only when the thresholds the project set are met (a common starting point: capability pass@3 >= 0.9, release-critical regressions pass^3 = 1.0). Add every new production failure as a regression case.

## Rules

- Deterministic graders over model graders whenever the criterion allows it.
- Flaky graders never gate releases; fix or demote them.
- Do not overfit prompts to the eval set; watch the held-out score.
- Evals run in CI (or a scheduled job) on prompt, model, tool or dependency changes, not only by hand.
- Untrusted model output used by tools is validated like any user input.

## Anti-patterns

- Measuring only happy paths.
- Changing the model or prompt and the eval set in the same step.
- Treating a single run as evidence for a stochastic system.
- Ignoring cost and latency drift.

_Source: adapted from ECC `skills/eval-harness` (MIT); ECC-specific scripts and commands removed; see NOTICE.md._
