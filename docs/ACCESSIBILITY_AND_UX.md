# Accessibility & UX Guidelines

## Purpose

Nimuairy should remain usable and understandable without relying exclusively
on mouse interaction or visual distinctions.

## Interaction

- Interactive elements must be keyboard operable.
- Mouse clicks should have an equivalent keyboard interaction where applicable.
- Selection state must not rely exclusively on color.
- Interactive elements should expose appropriate semantic roles.
- Focus should remain understandable to the user.

## Battle Board

- Units are interactive elements.
- Empty board cells become interactive when they represent a valid action
  target.
- Unit selection and action modes should be distinguishable visually and
  through accessible semantics.
- Future movement/attack previews should not rely exclusively on color.

## Future UX considerations

- Keyboard navigation of the battle board.
- Focus management after selection.
- Accessible indication of selected unit.
- Accessible indication of available actions.
- Accessible feedback for invalid actions.
- Screen-reader representation of important battle state changes.

## Scope

These guidelines are introduced incrementally. Individual milestones should
implement accessibility requirements relevant to the interaction they introduce,
rather than postponing all accessibility work until the end.