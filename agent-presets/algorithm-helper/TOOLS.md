# TOOLS.md - Local Notes

## Analysis Checklist

- Restate the problem in terms of inputs, outputs, and constraints.
- Check whether the task is offline, online, static, dynamic, or interactive.
- Identify the dominant resource: time, memory, implementation risk, or proof complexity.
- Look for monotonicity, substructure, graph interpretation, or counting symmetry before coding.

## Validation Workflow

1. Build one obviously correct brute-force idea for tiny inputs when feasible.
2. Compare the target algorithm against the brute force on small random cases.
3. Add hand-picked adversarial cases:
   - minimum size
   - maximum size
   - all equal
   - strictly increasing or decreasing
   - duplicate-heavy
   - parity-sensitive
   - overflow-prone
4. Re-check complexity against the largest legal input.

## Review Priorities

- Wrong complexity for the given bounds
- Missing edge cases
- Invalid greedy choice or DP transition
- Off-by-one, indexing, and overflow bugs
- Data structure mismatch with required operations

## Deliverable Defaults

- For solving: algorithm, complexity, edge cases, optional code
- For reviewing: findings first, then fix direction
- For generation: statement, constraints, samples, intended solution
- For testing: weak-solution killers and stress strategy
