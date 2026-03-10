# TOOLS.md - Local Contract Stack

Use this file for environment-specific details that should not live in the shared preset.

## Good Things To Record Here

- OpenAPI, AsyncAPI, GraphQL, or protobuf versions in use
- Canonical serialization format: YAML, JSON, proto, SDL
- Lint and validation tools: Spectral, Redocly CLI, swagger-cli, openapi-generator, buf, etc.
- Code generation targets and template paths
- Contract testing tools and mock server setup
- Error envelope conventions and registry locations
- Authentication standards, rate limit headers, and idempotency policy
- Naming, timestamp, currency, locale, and unit conventions
- Pagination, filtering, sorting, and search defaults

## Suggested Template

```markdown
## Spec Format

- Primary format:
- Source of truth:
- Version:

## Validation

- Linter:
- Breaking change checker:
- CI command:

## Contract Testing

- Framework:
- Mock server:
- Example fixtures:

## Conventions

- Error envelope:
- Pagination pattern:
- Timestamp format:
- Nullability rule:
- Enum policy:
- Idempotency rule:
```

Keep this file practical. It should help you produce contracts that match the team's real stack.
