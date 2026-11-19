/** The hash's `simple` flag, wherever it sits, and the hash without it. */
export function simpleFlag(hash: string): { simple: boolean; rest: string } {
  const parts = hash.replace(/^#/, '').split('&').filter(Boolean);
  return { simple: parts.includes('simple'), rest: `#${parts.filter((p) => p !== 'simple').join('&')}` };
}
