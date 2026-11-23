import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import preset from './tailwind.preset';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const ownSrc = fileURLToPath(new URL('src', import.meta.url));
const chipFiles = ['ConnectionChip.tsx', 'BrandSwitcher.tsx'];
const shared = [
  ...Object.keys(preset.theme.fontSize),
  ...Object.keys(preset.theme.extend.colors),
  ...'left center right justify start end wrap nowrap balance pretty ellipsis clip current transparent inherit white black'.split(' '),
];

/** Every break of the checked rules in docs/next/LOOK.md under `srcDir`, one `file:line  class  reason` each.
 *  `appColors` are the colour tokens the app's own Tailwind config adds to the preset. */
export function lookViolations(srcDir: string, appColors: string[] = []): string[] {
  const allowed = new Set([...shared, ...appColors]);
  const found: string[] = [];
  for (const name of readdirSync(srcDir, { recursive: true, encoding: 'utf8' })) {
    // A worker has no DOM: its colours are pixels painted into stored images, out of the tokens' reach.
    if (!/\.tsx?$/.test(name) || name.endsWith('.worker.ts')) continue;
    const path = join(srcDir, name);
    const text = readFileSync(path, 'utf8');
    const kind = name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
    const report = (at: number, cls: string, reason: string) =>
      found.push(`${relative(repo, path).replaceAll('\\', '/')}:${sf.getLineAndCharacterOfPosition(at).line + 1}  ${cls}  ${reason}`);

    const checkLiteral = (start: number, literal: string) => {
      for (const m of literal.matchAll(/#(?:[0-9a-f]{8}|[0-9a-f]{6})\b/gi)) report(start + m.index, m[0], 'hex colour, use a token');
      for (const m of literal.matchAll(/[^\s'"`${}]+/g)) {
        // Drop variants like `max-sm:` or `[@media(...)]:`, but not colons inside brackets.
        const utility = m[0].split(/:(?![^[]*\])/).pop()!.replace(/^!/, '');
        const at = start + m.index;
        if (utility.startsWith('[font-size:')) report(at, m[0], 'arbitrary font size, use the type scale');
        if (!utility.startsWith('text-')) continue;
        const value = utility.slice('text-'.length);
        const size = value.split('/')[0];
        if (value.startsWith('[')) report(at, m[0], 'arbitrary value, use the type scale');
        else if (!allowed.has(size)) report(at, m[0], 'not a scale size, colour token or text utility');
        else if (size === 'chip' && !chipFiles.includes(relative(ownSrc, path))) report(at, m[0], `allowed only in ${chipFiles.join(' and ')}`);
      }
    };

    // Classes live in string and template literals, so prose in comments never counts.
    const visit = (node: ts.Node) => {
      const literal = () => text.slice(node.getStart(sf), node.end);
      if (ts.isStringLiteral(node) || ts.isTemplateLiteral(node)) {
        const tokens = literal().split(/[\s'"`${}]+/);
        if (tokens.some((t) => t.endsWith('text-kicker')) && !tokens.includes('uppercase'))
          report(node.getStart(sf), 'text-kicker', 'needs uppercase in the same string');
      }
      if (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node)) checkLiteral(node.getStart(sf), literal());
      node.forEachChild(visit);
    };
    visit(sf);
  }
  return found;
}
