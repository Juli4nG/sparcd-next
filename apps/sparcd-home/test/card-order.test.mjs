import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const homePage = fileURLToPath(new URL('../index.html', import.meta.url));

test('lists a card each for sending and tagging photos', async () => {
  const html = await readFile(homePage, 'utf8');
  const tools = html.match(/<nav class="deck" aria-label="Tools">([\s\S]*?)<\/nav>/)?.[1];

  assert.ok(tools, 'expected the Tools navigation');
  assert.deepEqual(
    [...tools.matchAll(/<a class="card reveal" href="([^"]+)">([\s\S]*?)<\/a>/g)].map(([, href, card]) => ({
      href,
      heading: card.match(/<h2>([^<]+)<\/h2>/)?.[1],
    })),
    [
      { href: '/upload/', heading: 'Send photos' },
      { href: '/tag/', heading: 'Tag photos' },
    ],
  );
});
