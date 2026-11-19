// Selection is a set of photo indices into the card's full list. A filter only
// changes which indices are visible, so positions stay anchored to the card.

export function visibleRangeSet(visible: number[], a: number, b: number): Set<number> {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return new Set(visible.filter((i) => i >= lo && i <= hi));
}

/** The first additive click selects the focused photo too; later clicks toggle. */
export function toggleSelectionWithFocus(selected: Set<number>, focus: number, clicked: number): Set<number> {
  if (!selected.size) return new Set([focus, clicked]);
  const next = new Set(selected);
  if (!next.delete(clicked)) next.add(clicked);
  return next;
}

/**
 * The next visible index strictly past `focus` in `direction`, by position
 * rather than by `focus`'s own place in the list: tagging the last photo a
 * filter shows can drop `focus` itself out of `visible` (#442).
 */
export function nextVisibleIndex(visible: number[], focus: number, direction: 1 | -1): number | undefined {
  if (direction === 1) return visible.find((i) => i > focus);
  for (let k = visible.length - 1; k >= 0; k--) if (visible[k] < focus) return visible[k];
  return undefined;
}

/** The visible index nearest `focus`: the first at or after it, else the last before it. */
export function nearestVisibleIndex(visible: number[], focus: number): number | undefined {
  return visible.find((i) => i >= focus) ?? visible[visible.length - 1];
}
