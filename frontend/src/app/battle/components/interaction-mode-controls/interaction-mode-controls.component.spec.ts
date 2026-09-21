import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { InteractionMode } from '../../interaction-mode';
import { InteractionModeControlsComponent } from './interaction-mode-controls.component';

function render(mode: InteractionMode) {
  const fixture = TestBed.createComponent(InteractionModeControlsComponent);
  fixture.componentRef.setInput('mode', mode);
  fixture.detectChanges();
  return fixture;
}

function button(
  fixture: ReturnType<typeof render>,
  mode: InteractionMode,
): HTMLButtonElement {
  return fixture.nativeElement.querySelector(`[data-mode="${mode}"]`);
}

describe('InteractionModeControlsComponent', () => {
  it('renders MOVE and ATTACK as native buttons, so they are keyboard operable by construction', () => {
    const fixture = render(InteractionMode.MOVE);

    const move = button(fixture, InteractionMode.MOVE);
    const attack = button(fixture, InteractionMode.ATTACK);
    expect(move.tagName).toBe('BUTTON');
    expect(attack.tagName).toBe('BUTTON');
    expect(move.type).toBe('button');
    expect(attack.type).toBe('button');
  });

  it('marks the current mode with aria-pressed', () => {
    const fixture = render(InteractionMode.MOVE);
    expect(
      button(fixture, InteractionMode.MOVE).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      button(fixture, InteractionMode.ATTACK).getAttribute('aria-pressed'),
    ).toBe('false');

    fixture.componentRef.setInput('mode', InteractionMode.ATTACK);
    fixture.detectChanges();
    expect(
      button(fixture, InteractionMode.MOVE).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      button(fixture, InteractionMode.ATTACK).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('emits the clicked mode without changing its own state', () => {
    const fixture = render(InteractionMode.MOVE);
    const emitted: InteractionMode[] = [];
    fixture.componentInstance.modeChange.subscribe((mode) =>
      emitted.push(mode),
    );

    button(fixture, InteractionMode.ATTACK).click();
    button(fixture, InteractionMode.MOVE).click();

    expect(emitted).toEqual([InteractionMode.ATTACK, InteractionMode.MOVE]);
    expect(
      button(fixture, InteractionMode.MOVE).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
