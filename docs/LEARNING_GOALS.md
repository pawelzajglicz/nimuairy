# Learning Goals

Nimuairy is not only a software project but also a learning project.

The goal is to build a working application while using the project as a practical environment for learning modern software development practices, AI-assisted coding, and current technologies used in the project.

## 1. AI-Assisted Software Development

A major goal of the project is to learn how to effectively use AI tools to support software development.

This includes:

- Claude and AI coding agents
- Claude Code / IDE-integrated agents
- MCP and tool integrations
- AI-assisted code analysis and implementation
- AI-assisted refactoring
- AI-assisted debugging
- AI-assisted testing and code review
- Understanding when to use AI and when to solve a problem manually

The goal is not to maximize the amount of AI-generated code.

The goal is to learn how to collaborate effectively with AI while keeping the developer responsible for architectural decisions, correctness, maintainability, and final code quality.

### Preferred AI workflow

For non-trivial tasks, use the following workflow:

1. **Analyze** – understand the current code and requirements.
2. **Plan** – propose a small, concrete implementation plan.
3. **Review** – discuss and approve the plan before implementation.
4. **Implement** – make the changes.
5. **Test** – verify the implementation.
6. **Review** – inspect the resulting code and discuss important decisions.

Prefer small milestones over large, autonomous implementations.

AI should explain important architectural or technological decisions when they are relevant to the learning goals.

## 2. Modern Angular

The project is used to learn current Angular development practices and APIs.

Areas of interest include:

- modern standalone Angular applications
- signals and modern reactive APIs
- SignalStore and signal-based state management
- `httpResource` and modern HTTP patterns
- Angular routing
- dependency injection with `inject()`
- modern template syntax such as `@if` and `@for`
- change detection and `OnPush`
- Angular tooling and CLI
- Angular ESLint
- Angular testing
- Angular performance considerations
- integration with OpenAPI-generated API clients
- current Angular architecture and recommended practices
- provider scopes and hierarchical dependency injection for feature state

SignalStore is an intentional learning topic in the battle system. It should be introduced where it provides a useful state-management boundary, even when a smaller feature could technically work without a dedicated store.

When implementing new Angular functionality, prefer current, documented Angular approaches over patterns kept only for backward compatibility, unless there is a specific reason to use the older approach.

When a newer Angular API or pattern is introduced, briefly explain what it provides and why it is relevant.

## 3. Modern Java

The backend is also a practical environment for learning current Java development.

Areas of interest include:

- modern Java language features
- records
- sealed classes and interfaces
- pattern matching
- immutable data
- functional programming where appropriate
- modern collection APIs
- clean domain modelling
- type-safe representations of domain concepts
- writing simple, testable, framework-independent domain logic

The project should prefer modern Java features when they improve clarity, correctness, or maintainability.

Do not introduce language features only because they are new. Their use should have a clear benefit in the context of the project.

## 4. Modern Spring Boot

The project is used to learn current Spring Boot development practices.

Areas of interest include:

- Spring Boot configuration
- REST APIs
- Spring Web
- Spring Security
- validation
- dependency injection
- Spring Data JPA
- database migrations with Liquibase
- application testing
- API documentation with OpenAPI
- separation between API, application/service, and domain concerns
- keeping domain logic independent from Spring where practical

The project should use Spring Boot features where they provide clear value, while avoiding unnecessary framework coupling in core domain logic.

## 5. API Design and Tooling

The project is also used to learn modern API-first development.

The API contract should be treated as an important boundary between frontend and backend.

Areas of interest include:

- REST API design
- OpenAPI
- Springdoc
- generated TypeScript/Angular API clients
- Orval
- API contract consistency
- request and response DTOs
- validation and error handling
- versioning and compatibility

Generated API code should not be manually modified.

## 6. Software Architecture

The project should be used to practice designing software that can evolve without unnecessary rewrites.

Important principles include:

- clear separation of responsibilities
- domain logic independent from UI concerns
- domain logic independent from persistence where practical
- explicit models and contracts
- small, composable components
- avoiding premature abstraction
- keeping current requirements separate from future requirements
- designing for future server-authoritative multiplayer without implementing unnecessary complexity prematurely
- using feature-scoped state where the lifetime of state belongs to a feature rather than the whole application

Architecture should evolve incrementally as the application grows.

## 7. Testing and Verification

Testing is part of the learning process, not only a final quality gate.

The project should provide opportunities to learn:

- unit testing
- integration testing
- frontend testing
- backend testing
- API testing
- testing domain logic independently from frameworks
- CI-based verification
- reviewing AI-generated code through tests

Tests should be added when they provide meaningful confidence or support a learning goal.

Do not add tests purely to increase test count.

## 8. Developer Tooling and CI

The project should also be used to learn modern development tooling, including:

- Git and GitHub
- GitHub Actions
- npm
- Maven
- ESLint
- Prettier
- OpenAPI tooling
- MCP
- IDE-integrated AI agents

Tooling should remain understandable and reproducible for another developer cloning the repository.

Local-only configuration should not contain machine-specific paths or secrets in the repository.

## 9. Learning Over Premature Optimization

The primary purpose of the project is learning through a real, evolving application.

When several technically valid solutions exist, prefer the solution that:

1. fits the current requirements,
2. is reasonably simple,
3. demonstrates a useful modern concept,
4. can be understood and maintained,
5. provides an opportunity to learn something relevant.

Avoid introducing additional infrastructure, abstractions, or technologies solely because they might be useful in a hypothetical future version.

## 10. Role of AI in the Project

AI is a development assistant, not the owner of the project.

The developer remains responsible for:

- requirements
- architectural decisions
- accepting or rejecting proposed solutions
- understanding important code
- reviewing changes
- verifying correctness
- deciding when complexity is justified

AI should help improve the developer's understanding and productivity rather than replace understanding.

The project should therefore favor explanations, small iterations, explicit decisions, and reviewable changes over large opaque implementations.
