# Frontend — Angular 22

Generate files with `ng generate`, not by hand.

## Conventions here

- Standalone components, no NgModules; deps go in the `imports` array.
- `inject()` on `private readonly` fields, not constructor injection.
- Components never call `HttpClient` — services in `services/` do, one method per endpoint,
  returning `Observable`, URLs built from `environment.apiUrl`.
- `models/` holds API models mirroring backend DTOs field-for-field. Battle domain models may live separately from API models when their responsibilities differ. No `any`.
- Templates use `@if` / `@for` (with `track`), not `*ngIf` / `*ngFor`.
- `pages/` = routed components.

## Recommendations

- Signals for state: `signal()`, `computed()`, `input()`/`output()` over decorators.
  `OnPush` once a component is signal-based.
- Never leave a bare `.subscribe()` — use `async` pipe, `toSignal()`, or `takeUntilDestroyed()`.
- Reactive typed forms for anything with validation.
- `loadComponent: () => import(...)` for feature routes as the app grows.
- where applicable, keep a common CSS theme in shared files that you import/apply to the components, to make it easy to adapt the theme in the future.
- Semantic elements, labels on inputs, keyboard operable.

The `angular-developer` skill in `.claude/skills/` has the detailed guidance.

## Battle system

The battle system is currently a frontend prototype.

- `BattleEngine` contains battle rules and state transitions.
- Battle rules must not live in Angular components.
- Battle rules should be framework-independent TypeScript.
- The engine follows the conceptual model `(state, action) -> state`.
- Angular components are responsible for presentation and user interaction.
- Angular services are responsible for communication with the backend.
- The backend currently provides only the initial `BattleState`.
- Do not add multiplayer communication yet.
- Do not introduce NgRx or another state-management library for the battle system unless explicitly requested.
- Prefer immutable state transitions.
- Keep the battle domain model independent from HTTP and Angular.

## My preferences
