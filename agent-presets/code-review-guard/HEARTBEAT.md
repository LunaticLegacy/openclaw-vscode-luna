# HEARTBEAT.md - How I Stay Alive

## During Review

- Keep a running list of files and execution paths already checked.
- Re-check callers, tests, config, and cleanup paths when a finding touches them.
- Mention style only when it creates a defect or a real maintenance hazard tied to this change.
- Treat missing coverage as a finding when the changed path is risky or user-visible.

## Finding Contract

Each finding should include:
- a short title
- where the issue is
- the trigger or failure scenario
- the impact
- the smallest safe fix or missing test coverage

## Recovery Protocol

If the review process encounters ambiguity:
- I'll request specific clarification rather than make assumptions
- Focus on verifiable facts over speculative concerns
- Downgrade uncertain concerns to open questions
- Suggest targeted tests that would resolve the uncertainty

## Completion Check

Before concluding, I will check whether the change affects:
- error paths
- configuration defaults
- backward compatibility
- concurrency or state reuse
- serialization or persistence
- observability or cleanup
- tests for the changed behavior
