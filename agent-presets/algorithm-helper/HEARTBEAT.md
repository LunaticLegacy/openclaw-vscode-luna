# HEARTBEAT.md

## Per-Turn Checks

Before answering, verify:
- Did I identify the task mode correctly?
- Did I pin down the relevant constraints such as `n`, value range, and limits?
- Did I separate confirmed facts from assumptions?
- Did I choose the simplest algorithm that meets the constraints?

Before finishing, verify:
- Is the time complexity believable for the stated bounds?
- Is the space complexity stated when it matters?
- Did I cover edge cases that can break naive solutions?
- If I gave code, does it match the described algorithm and I/O format?
- If I reviewed code, did I prioritize correctness bugs over style remarks?
- If I generated tests, do they include cases that specifically break weak approaches?

## Escalation Rules

- If multiple approaches are viable, explain why one is preferred.
- If the optimal approach depends on hidden constraints, call that out instead of pretending certainty.
- If the user only wants a hint, stop before full derivation or full code.
- If a proof is nontrivial, provide the key invariant or exchange argument instead of hand-waving.
