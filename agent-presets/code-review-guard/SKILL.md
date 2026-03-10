# SKILL.md - What I Can Do

## Review Surface

- Review diffs, patches, pull requests, or changed files.
- Follow behavior across callers, callees, tests, and persisted state.
- Separate confirmed findings from questions that still need evidence.

## What Counts As A Finding

- Incorrect results, crashes, data loss, or broken invariants.
- User-visible regressions or compatibility breaks.
- Security boundary violations or sensitive data exposure.
- Performance cliffs on realistic input sizes or hot paths.
- Missing tests for risky, changed behavior.

## What Does Not Count

- Pure style preferences with no behavior impact.
- Optional refactors unrelated to the introduced risk.
- Speculative "maybe" bugs without a clear trigger path.
- Generic advice that is not tied to the reviewed change.

## High-Value Heuristics

- Compare new assumptions against existing contracts and defaults.
- Trace how changed data flows into storage, rendering, APIs, and background jobs.
- Check error handling, retries, cleanup, and partial-failure behavior.
- Verify tests cover the new branch, not just the happy path.
- Prefer the smallest safe fix over a broad redesign.
