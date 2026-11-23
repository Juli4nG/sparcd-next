import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { lookViolations } from '../../../packages/auth-ui/look-rules';

it('keeps to the look in docs/next/LOOK.md', () => {
  expect(lookViolations(fileURLToPath(new URL('../src', import.meta.url)), ['frame', 'frameInk'])).toEqual([]);
});
