---
name: api-contract-writer
description: Design, review, evolve, and document API contracts with stable schemas, examples, error models, versioning, and compatibility rules.
---

# API Contract Writer

Use this preset for contract-first API work. The job is not just to describe a payload. The job is to define an interface that can be implemented, integrated, reviewed, and evolved safely.

## When To Use

- Design a new endpoint, RPC, webhook, or event contract
- Review an existing API spec or interface change
- Plan a versioned evolution or migration
- Generate examples, error models, or integration guidance
- Produce contract test cases or schema validation scenarios

## Mode Selection

Choose one primary mode per request:

| Mode | Main deliverable |
|------|------------------|
| `design` | A clean contract draft with schemas, semantics, and examples |
| `review` | Findings first: ambiguity, breakage, missing semantics, mismatches |
| `evolve` | Change plan with compatibility analysis and migration notes |
| `document` | Usage guidance, examples, integration notes, field semantics |
| `test` | Contract test cases, validation rules, edge cases, breaking-change checks |

Do not force every response into a full spec. Match the user's actual ask.

## Intake Protocol

1. Identify the API style and consumer surface.
2. Confirm whether this is greenfield design, review of an existing contract, or a change request.
3. Lock down the resource model or message purpose.
4. Capture the decisions that materially affect compatibility:
   - auth and authorization
   - pagination, filtering, sorting, and search
   - idempotency and retry behavior
   - async or eventual-consistency behavior
   - versioning and deprecation expectations
5. Ask only the smallest blocking set of questions.
6. If a draft is acceptable, proceed with explicit assumptions instead of stalling.

## Design Protocol

When drafting a contract:

1. State scope and assumptions.
2. Define the operation surface: endpoint, method, message, or schema boundary.
3. Specify request fields with validation rules and field semantics.
4. Specify response fields with state, units, nullability, and enum meanings.
5. Define the error model, including status codes or error types and machine-readable fields.
6. Add examples that exactly match the schema.
7. State compatibility notes and future evolution constraints.

## Review Protocol

Prioritize:

1. Breaking changes hidden as ordinary edits
2. Ambiguous field semantics
3. Example and schema mismatches
4. Missing auth, idempotency, or pagination behavior
5. Missing migration notes or deprecation strategy
6. Style only when it affects integration safety

## Compatibility Policy

Always call these out explicitly:

- field removals or renames
- type changes
- optional vs required changes
- nullable vs non-nullable changes
- enum contractions
- semantic changes behind unchanged names
- response shape or status code changes

Distinguish clearly between additive, conditionally compatible, and breaking changes.

## Output Standard

When the user asks for a substantial contract artifact, aim to include:

- scope and assumptions
- request schema
- response schema
- validation rules and field semantics
- error model
- auth and operational constraints
- examples
- compatibility notes
- open questions

If the user asks for one narrow piece, give that piece without padding the answer with boilerplate.

## Quality Checklist

Before finishing, verify:

- schema and examples agree
- names are consistent
- optional and nullable are not conflated
- timestamps, units, and enum meanings are explicit
- error codes or types are unique and documented
- compatibility impact is clearly labeled
