import { describe, expect, it, vi } from 'vitest';
import type { Species } from '@sparcd/bucket';
import { speciesTag } from '../src/data/tags';
import { resolveKeys } from '../src/lib/keys';
import { StandaloneModifierGesture } from '../src/lib/standaloneModifier';
import { applySpeciesBinding, handleKey, type KeyAction, type KeyContext } from '../src/tag/keyboard';

const sp = (name: string, scientificName: string, keyBinding: string | null, observationType: Species['observationType'] = 'animal'): Species => ({
  name,
  scientificName,
  speciesIconURL: '',
  keyBinding,
  observationType,
});
const coyote = sp('Coyote', 'Canis latrans', 'Y');
const bobcat = sp('Bobcat', 'Lynx rufus', 'L');
const ghost = sp('Ghost', 'Casper', 'Shift', 'blank');

function context(over: Partial<KeyContext> = {}): KeyContext {
  const resolved = resolveKeys([coyote, bobcat, ghost], {});
  const keyMap = new Map<string, KeyAction>([...resolved.byKey].map(([k, species]) => [k, { kind: 'species', species }]));
  return {
    view: 'grid',
    hasTarget: true,
    selectedCount: 0,
    keyMap,
    capturingFor: null,
    countPrefix: '',
    search: '',
    displayed: [],
    searchInput: null,
    modalOpen: false,
    targetHas: () => false,
    setCountPrefix: vi.fn(),
    captureKey: vi.fn(),
    stopCapture: vi.fn(),
    apply: vi.fn(),
    increment: vi.fn(),
    move: vi.fn(),
    clearSelection: vi.fn(),
    selectBurst: vi.fn(),
    openFocus: vi.fn(),
    closeFocus: vi.fn(),
    openCheatsheet: vi.fn(),
    undo: vi.fn(),
    saveNow: vi.fn(),
    ...over,
  };
}

const key = (k: string, extra: Record<string, unknown> = {}) =>
  ({ key: k, code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, target: null, preventDefault: vi.fn(), ...extra }) as unknown as KeyboardEvent;

describe('species keys', () => {
  it('a bound letter adds one of that species, either case', () => {
    const s = context();
    handleKey(key('y'), s);
    handleKey(key('L', { shiftKey: true }), s);
    expect(s.increment).toHaveBeenNthCalledWith(1, speciesTag(coyote));
    expect(s.increment).toHaveBeenNthCalledWith(2, speciesTag(bobcat));
  });

  it('does nothing without a photo to tag; Ctrl and Alt combinations stay with the browser', () => {
    const s = context({ hasTarget: false });
    handleKey(key('y'), s);
    const t = context();
    handleKey(key('y', { ctrlKey: true }), t);
    handleKey(key('y', { altKey: true }), t);
    expect(s.increment).not.toHaveBeenCalled();
    expect(t.increment).not.toHaveBeenCalled();
  });

  it('a typed count goes on a new species; a key two species share does nothing', () => {
    const s = context({ countPrefix: '3' });
    expect(applySpeciesBinding(s, 'y')).toBe(true);
    expect(s.apply).toHaveBeenCalledWith({ ...speciesTag(coyote), count: 3 });
    expect(s.setCountPrefix).toHaveBeenCalledWith('');

    const shared = context({ keyMap: new Map([['y', { kind: 'conflict' }]]) });
    handleKey(key('y'), shared);
    expect(shared.increment).not.toHaveBeenCalled();
    expect(shared.apply).not.toHaveBeenCalled();
  });

  it('digits build the count; Escape drops it before closing anything', () => {
    const s = context({ countPrefix: '1', view: 'focus' });
    handleKey(key('2'), s);
    expect(s.setCountPrefix).toHaveBeenCalledWith('12');
    handleKey(key('Escape'), s);
    expect(s.setCountPrefix).toHaveBeenLastCalledWith('');
    expect(s.closeFocus).not.toHaveBeenCalled();
  });
});

describe('choosing', () => {
  it('Ctrl+A chooses the burst; Shift+Space does nothing', () => {
    const s = context();
    handleKey(key('a', { ctrlKey: true }), s);
    expect(s.selectBurst).toHaveBeenCalled();
    const shiftSpace = key(' ', { shiftKey: true });
    handleKey(shiftSpace, s);
    expect(shiftSpace.preventDefault).toHaveBeenCalled();
    expect(s.increment).not.toHaveBeenCalled();
    expect(s.apply).not.toHaveBeenCalled();
  });

  it('species keys still work after clicking a checkbox', () => {
    const checkbox = { tagName: 'INPUT', type: 'checkbox' } as unknown as HTMLInputElement;
    const s = context();
    handleKey(key('y', { target: checkbox }), s);
    expect(s.increment).toHaveBeenCalledWith(speciesTag(coyote));
  });

  it('typing in a field stops "Set key" instead of binding the letter', () => {
    const input = { tagName: 'INPUT' } as unknown as HTMLInputElement;
    const s = context({ capturingFor: 'Canis latrans' });
    handleKey(key('q', { target: input }), s);
    expect(s.stopCapture).toHaveBeenCalled();
    expect(s.captureKey).not.toHaveBeenCalled();
  });
});

describe('#627 Enter in the species search', () => {
  const input = { tagName: 'INPUT', blur: vi.fn() } as unknown as HTMLInputElement;

  it('adds the top displayed result, add-only', () => {
    const s = context({ search: 'cat', displayed: [bobcat, coyote], searchInput: input });
    handleKey(key('Enter', { target: input }), s);
    expect(s.apply).toHaveBeenCalledWith(speciesTag(bobcat));
    expect(s.increment).not.toHaveBeenCalled();
    expect(input.blur).toHaveBeenCalled();
  });

  it('does nothing for a blank search or no results', () => {
    for (const over of [{ search: '  ', displayed: [coyote] }, { search: 'zebra', displayed: [] }]) {
      const s = context({ ...over, searchInput: input });
      handleKey(key('Enter', { target: input }), s);
      expect(s.apply).not.toHaveBeenCalled();
    }
  });

  it('letters type into the search instead of tagging', () => {
    const s = context({ searchInput: input });
    handleKey(key('y', { target: input }), s);
    expect(s.increment).not.toHaveBeenCalled();
  });
});

describe('#628 standalone Shift and Control', () => {
  type G = StandaloneModifierGesture<object>;
  const press = (g: G, ctx: object, k: string, extra: Record<string, unknown> = {}) => g.keyDown(key(k, { code: `${k}Left`, ...extra }), ctx);
  const release = (g: G, ctx: object, k: string, extra: Record<string, unknown> = {}) => g.keyUp(key(k, { code: `${k}Left`, ...extra }), ctx);

  it('a lone tap tags on release, once, and Ghost ignores a typed count', () => {
    const g = new StandaloneModifierGesture<object>();
    const ctx = {};
    press(g, ctx, 'Shift', { shiftKey: true });
    const s = context({ countPrefix: '4' });
    handleKey(key('Shift', { shiftKey: true }), s);
    expect(s.increment).not.toHaveBeenCalled();
    expect(release(g, ctx, 'Shift')).toBe('Shift');
    applySpeciesBinding(s, 'Shift');
    expect(s.increment).toHaveBeenCalledWith(speciesTag(ghost));
    expect(s.apply).not.toHaveBeenCalled();
  });

  it('a combination, a click or a change of photo cancels the tap', () => {
    const g = new StandaloneModifierGesture<object>();
    const ctx = {};
    press(g, ctx, 'Shift', { shiftKey: true });
    g.keyDown(key('A', { code: 'KeyA', shiftKey: true }), ctx);
    g.keyUp(key('A', { code: 'KeyA', shiftKey: true }), ctx);
    expect(release(g, ctx, 'Shift')).toBeNull();

    press(g, ctx, 'Control', { ctrlKey: true });
    g.pointerDown(1);
    g.pointerUp(1);
    expect(release(g, ctx, 'Control')).toBeNull();

    press(g, ctx, 'Shift', { shiftKey: true });
    g.observe({});
    expect(release(g, ctx, 'Shift')).toBeNull();
  });
});
