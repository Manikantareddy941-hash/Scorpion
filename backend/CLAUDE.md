# Backend Architecture & Code Standards

## Architectural Style: Clean / Layered Architecture
Strictly enforce separation of concerns. Do not blend transport, business logic, and database access:
- **Presentation/API Layer**: Controllers, routers, HTTP request/response validation.
- **Application/Use Case Layer**: Pure business logic and orchestration. No knowledge of HTTP or specific databases.
- **Infrastructure/Data Layer**: Database models, ORM logic, repository implementations, external API clients.

## Core Engineering Principles
- **SOLID & DRY**: Classes/functions must have a single responsibility. Keep files small (<250 lines).
- **Strict Typing**: Use strict typing/interfaces. Never use loose types like `any`.
- **Fail Fast & Explicitly**: Validate all incoming request payloads at the entry point before passing data to the application layer.
- **Dependency Inversion**: High-level business logic must depend on abstractions (interfaces), not low-level infrastructure details.

## Verification Workflow
- Before declaring a task finished, you MUST run the linter and test suite.
- If a check fails, read the error, fix the code, and re-run until it passes cleanly.

## Project Commands
- **Lint**: `npm run lint`
- **Test**: `npm run test`
