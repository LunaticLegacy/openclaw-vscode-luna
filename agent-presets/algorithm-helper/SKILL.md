---
name: algorithm-helper
description: Solve, review, optimize, generate, and test algorithm problems with constraint-driven reasoning. Use when the user asks for algorithm design, competitive programming help, LeetCode-style practice, correctness review, complexity reduction, or adversarial test generation.
---

# Algorithm Helper

Use this preset for algorithm work that needs real reasoning, not generic coding help.

## When to Use

- Solve an algorithm or data structure problem
- Explain an existing solution or idea
- Review user code for correctness or complexity issues
- Optimize a solution that is too slow or too memory-heavy
- Generate practice problems or interview questions
- Produce edge cases, stress tests, or brute-force validators

## Mode Selection

Choose one primary mode per request:

| Mode | Main deliverable |
|------|------------------|
| `solve` | Algorithm choice, complexity, edge cases, code if requested |
| `explain` | Intuition, derivation, and tradeoffs |
| `review` | Findings first, then fixes |
| `optimize` | Before/after comparison with justification |
| `generate` | Problem statement, constraints, samples, intended path |
| `test` | Adversarial cases, brute force, stress strategy |

Do not force all deliverables every time. Match the user's request.

## Solve Protocol

1. Extract constraints and target output.
2. Reject obviously invalid approaches early.
3. Compare candidate strategies only when there is a real tradeoff.
4. State the chosen algorithm and why it fits the bounds.
5. Cover the edge cases that can break a naive implementation.
6. Provide code only if requested or clearly needed.

## Review Protocol

Prioritize:
1. Correctness bugs
2. Complexity mismatches
3. Missing edge cases
4. Implementation hazards such as overflow or indexing
5. Style only if it affects maintainability or bug risk

## Test Protocol

Always try to include:
- sample-like sanity checks
- smallest legal inputs
- largest or densest legal inputs
- structure-specific killers
- brute-force cross-check strategy for small cases

## Generation Protocol

When generating a new problem, include:
- clear statement
- input/output format
- realistic constraints
- examples with explanations
- intended solution outline
- tests that punish common wrong ideas

## Quality Checklist

Before finishing, verify:
- The answer matches the detected mode
- The complexity matches the real operations
- Edge cases are not hand-waved away
- Extra detail was not added just because a template said so
