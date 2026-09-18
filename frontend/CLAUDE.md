# Frontend — Angular 22

Generate files with `ng generate`, not by hand.

## Conventions here

- Standalone components, no NgModules; deps go in the `imports` array.
- `inject()` on `private readonly` fields, not constructor injection.
- Components should not call `HttpClient` directly. Prefer the generated Orval API client for API access; feature-specific services may wrap generated clients when that provides a clear application-level boundary.
- `models/` holds application models. Generated OpenAPI request/response models live under `api/generated/model/` and must not be duplicated manually. Battle domain models may live separately from API models when their responsibilities differ. No `any`.
- Templates use `@if` / `@for` (with `track`), not `*ngIf` / `*ngFor`.
- `pages/` = routed components.

## Recommendations

- Signals for state: `signal()`, `computed()`, `input()`/`output()` over decorators.
- Use SignalStore for battle state management where appropriate.
- `OnPush` once a component is signal-based.
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
- The backend currently provides the initial `BattleState`.
- Battle state used by the Angular battle feature is managed with SignalStore.
- `BattleStore` should own the battle state and request lifecycle needed by the feature, while keeping gameplay rules in `BattleEngine`.
- For the demo battle route, provide `BattleStore` at the `BattleDemoPage` feature boundary rather than as a root singleton. This keeps one store instance scoped to the battle screen and makes the same state available to child components and future UI around the board.
- Do not add multiplayer communication yet.
- Do not introduce NgRx or another state-management library for the battle system unless explicitly requested.
- Prefer immutable state transitions.
- Keep the battle domain model independent from HTTP, Angular, and SignalStore.

### M2 battle board

M2 is a read-only rendering milestone. Its intended component structure is:

```
BattleDemoPage
    |
    v
BattleBoard
    |
    +-- BoardGrid
    |     +-- CellComponent × 231
    |
    +-- EntityLayer
          +-- Wall visuals
          +-- Orb visuals
          +-- Unit visuals
```

- Use one CSS Grid as the board coordinate system.
- `CellComponent` represents one terrain cell. 231 cells are intentionally acceptable for the M2 board; do not introduce a more complex rendering technology for premature performance reasons.
- Entity visuals are rendered in a layer over the same board rectangle and use the same coordinate mapping as cells.
- The domain coordinate system remains Cartesian with `(0,0)` at bottom-left. Screen/CSS row mapping is a presentation concern.
- Render object geometry from `position` as the anchor plus `footprint` as relative offsets. Do not assume that an entity occupies one cell.
- Keep terrain, structures, objectives, and units conceptually distinct even though M2 may use a simple shared entity layer for their DOM rendering.
- M2 does not implement selection, movement, combat, turns, or other gameplay actions.

## API client

The Angular API client is generated using Orval from the OpenAPI contract.

Generated code must not be edited manually.

Use the generated API types and clients instead of creating duplicate request/response models.

Keep generated API code separate from application/domain code.

## My preferences
