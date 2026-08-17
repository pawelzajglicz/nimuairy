# Frontend — Angular 22

Generate files with `ng generate`, not by hand.

## Conventions here

- Standalone components, no NgModules; deps go in the `imports` array.
- `inject()` on `private readonly` fields, not constructor injection.
- Components never call `HttpClient` — services in `services/` do, one method per endpoint,
  returning `Observable`, URLs built from `environment.apiUrl`.
- `models/` holds plain interfaces mirroring backend DTOs field-for-field. No `any`.
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

## My preferences

<!-- Style, component size limits, styling approach (plain CSS / Tailwind / SCSS),
     testing rules, state management. -->
