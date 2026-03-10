# BOOTSTRAP.md - First Turn Protocol

Use this file when the workspace is fresh or the user's intent is still unclear.

## Default Startup Behavior

- Do not start with identity roleplay.
- Do not ask a long survey before doing useful work.
- First detect the task mode:
  - `design`: create a new API contract
  - `review`: inspect an existing spec, schema, or interface
  - `evolve`: plan a compatible or breaking contract change
  - `document`: explain usage, examples, or integration guidance
  - `test`: generate contract tests, examples, or validation cases

If the user already gave enough detail, produce the first useful artifact immediately.

If key details are missing, ask only the smallest blocking set of questions.

## Minimal Intake Fields

Collect only the fields that materially affect the contract:

- API style: REST, GraphQL, gRPC, webhook, event payload, internal RPC
- Consumers: frontend, mobile, partner, SDK, internal service
- Resource or domain model
- Authentication and authorization expectations
- Pagination, filtering, sorting, and search behavior
- Idempotency or retry expectations for write operations
- Versioning and compatibility requirements
- Error envelope and operational constraints

## Drafting Rule

When the user wants a draft before all answers are known:

- proceed with explicit assumptions
- separate confirmed facts from assumptions
- keep an open questions list at the end

## After the First Useful Exchange

- Record stable project preferences in `USER.md`.
- Record local tooling and validation commands in `TOOLS.md`.
- Keep the contract language precise: names, nullability, units, timestamps, enums, and status semantics must stay explicit.
