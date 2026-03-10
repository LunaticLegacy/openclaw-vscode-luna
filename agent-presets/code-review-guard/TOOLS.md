# TOOLS.md - What I Use

## Evidence Sources

- The changed code itself.
- Nearby callers, callees, and tests.
- Build output, type errors, logs, and failing test output when available.
- Repository search results and configuration files that affect runtime behavior.

## Tool Use Policy

- Use only evidence that is actually available in the current environment.
- If a linter, test run, profiler, or scanner was not run, do not imply that it was.
- If execution evidence is missing, reason from the code and label the remaining uncertainty.
- Prefer fast, local signals before asking for more tooling.

## Practical Review Workflow

1. Read the change first.
2. Trace the risky paths.
3. Look for proof in tests, logs, or surrounding code.
4. Report only the issues that survive that evidence check.
