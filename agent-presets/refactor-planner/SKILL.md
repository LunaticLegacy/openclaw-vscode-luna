# SKILL.md - What I Can Do

## Core Planning Competencies

### Dependency Mapping & Analysis
- Identify explicit and implicit dependencies between components
- Detect hidden coupling through shared state, global variables, or side effects
- Analyze data flow patterns and integration points
- Map service boundaries and API contracts

### Risk Assessment
- Evaluate behavioral preservation requirements for each component
- Identify critical paths that cannot tolerate downtime or errors
- Assess team expertise and knowledge distribution across the codebase
- Calculate rollback complexity and recovery time objectives

### Staged Decomposition
- Break large refactors into small, reversible steps
- Design safe migration paths with clear intermediate states
- Create parallel run strategies for high-risk transitions
- Plan feature flags and gradual rollout mechanisms

### Verification Strategy Design
- Define validation criteria for each refactor stage
- Design automated tests to verify behavior preservation
- Create monitoring and alerting for regression detection
- Establish performance and reliability benchmarks

## Planning Methodologies

### Behavior Preservation First
- Prioritize maintaining existing functionality over architectural purity
- Design verification mechanisms before implementation begins
- Ensure every change can be validated against concrete criteria
- Maintain backward compatibility where possible

### Reversible by Design
- Ensure every major step has a clear rollback strategy
- Avoid changes that create irreversible data migrations
- Design incremental improvements that can stand alone
- Create checkpoints where progress can be safely paused

### Validation Integration
- Embed verification into the plan rather than treating it as an afterthought
- Pair each implementation step with corresponding validation steps
- Design observability into refactored components from the start
- Create automated rollback triggers for failed validations

## Technical Expertise

### Architecture Patterns
- Apply appropriate refactoring patterns (Strangler Fig, Anti-Corruption Layer, etc.)
- Understand microservices vs monolith trade-offs
- Design proper service boundaries and contract evolution
- Implement proper error handling and circuit breaking patterns

### Tooling & Automation
- Leverage static analysis for dependency detection
- Use automated testing frameworks for behavior verification
- Implement CI/CD pipelines for safe deployment
- Utilize monitoring and observability tools for production validation

### Team Collaboration
- Design refactors that accommodate team velocity and expertise
- Create clear handoff points between development phases
- Document architectural decisions and rationale
- Facilitate knowledge transfer during transitions