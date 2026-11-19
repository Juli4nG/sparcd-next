// End-to-end check against a running dev server and a seeded no-gate MinIO:
// sign in, open the card, tag 23 photos by keyboard and mouse, wait for
// "Saved", reload, compare, and download the package for frictionless.
//
//   node scripts/verify.mjs <shots folder> <package folder>
// Reads SEED_ENDPOINT, SEED_LOGIN, SEED_PASSWORD; APP defaults to http://localhost:5190/tag/.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { AwsClient } from 'aws4fetch';

const [shots, packageDir] = process.argv.slice(2);
const app = process.env.APP ?? 'http://localhost:5190/tag/';
const { SEED_ENDPOINT: endpoint, SEED_LOGIN: login, SEED_PASSWORD: password } = process.env;
const bucket = `sparcd-next-${login}`;
await mkdir(shots, { recursive: true });
await mkdir(packageDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const step = (msg) => console.log(`- ${msg}`);
const tile = (i) => page.locator(`[data-testid="photo-tile"][data-index="${i}"]`);
const press = (...keys) => keys.reduce((p, k) => p.then(() => page.keyboard.press(k)), Promise.resolve());
const tap = async (modifier) => {
  await page.keyboard.down(modifier);
  await page.keyboard.up(modifier);
};

await page.goto(app);
await page.getByLabel('Login name').waitFor();
await shot('01-sign-in');
await page.getByLabel('Login name').fill(login);
await page.getByLabel('Password').fill('not-the-password');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByText("That login name or password didn't work").waitFor();
await shot('02-sign-in-wrong-password');
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByTestId('card-row').first().waitFor();
await shot('03-cards');
step(`cards: ${await page.getByTestId('card-row').first().innerText()}`.replace(/\n/g, ' | '));

await page.getByRole('link', { name: 'Tag these photos' }).first().click();
await tile(0).waitFor();
await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="photo-tile"] img')].filter((i) => i.complete && i.naturalWidth).length >= 8);
await shot('04-grid');

// Keys for Ghost (Shift) and a rabbit (Control), set the way a volunteer would.
const search = page.getByLabel('Search species');
for (const [name, modifier] of [['Ghost', 'Shift'], ['Rabbit (Desert Cottontail)', 'Control']]) {
  await search.fill(name);
  const row = page.getByTestId('species-panel').locator('div.group').filter({ hasText: name }).first();
  await row.getByRole('button', { name: /set key|change key/ }).click();
  await tap(modifier);
  await row.locator('kbd', { hasText: modifier }).waitFor();
}
await search.fill('');
await shot('05-keys-set');

await tile(0).click();
await press('y'); // 0 Coyote
await press('l'); // 1 Bobcat
await press('3', 'j'); // 2 Javelina ×3
await tap('Shift'); // 3 Ghost → Nothing in this photo
await tap('Control'); // 4 Rabbit
await press('Space');
await page.keyboard.type('puma');
await press('Enter'); // 5 Puma, the top search result (#627)
await search.fill('');
await page.getByRole('button', { name: 'Nothing in this photo', exact: true }).click(); // 6
await press('h'); // 7 Human
await press('e', 'b', 'o'); // 8 Badger, 9 Bear, 10 Coatimundi
await press('c'); // 11 Cow, then undone
await press('Control+z');
if ((await tile(11).getAttribute('data-tag-state')) !== 'untagged') throw new Error('Undo did not remove the tag');
await tile(11).click();
await press('d'); // 11 Domestic Dog
await press('f'); // 12 Fox
await press('2', 'p'); // 13 Puma ×2
await press('q', 'm', 'w'); // 14 Horse, 15 Deer (Mule), 16 Deer (White-Tailed)
await tile(18).click({ modifiers: ['Control'] }); // choose 17 and 18
await press('s'); // 17, 18 Squirrel
await press('u'); // 19 Turkey
await press('Enter'); // large view of 20
await page.getByRole('dialog', { name: 'Large photo' }).waitFor();
await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] img')].some((i) => i.complete && i.naturalWidth > 320));
await shot('06-large-photo');
await press('i'); // 20 Bird
await press('v'); // 21 Rock Squirrel
await press('y', 'y'); // 22 Coyote, then 23 Coyote… undo the second
await press('Control+z');
await page.waitForTimeout(300);
await shot('07-large-photo-tagged');
await press('Escape');
await page.getByRole('dialog', { name: 'Large photo' }).waitFor({ state: 'detached' });

await page.locator('[data-save-status="saved"]').waitFor({ timeout: 30_000 });
await shot('08-saved');
await page.getByRole('button', { name: /^Not tagged yet/ }).click();
await shot('09-not-tagged-yet');
await page.getByRole('button', { name: /^Tagged/ }).click();
await shot('10-tagged');
await page.getByRole('button', { name: /^All photos/ }).click();

async function labels() {
  const grid = page.getByTestId('photo-grid');
  const seen = {};
  for (let y = 0; y < 2000; y += 300) {
    await grid.evaluate((el, top) => (el.scrollTop = top), y);
    await page.waitForTimeout(100);
    for (const el of await page.locator('[data-testid="photo-tile"]').all()) {
      const i = Number(await el.getAttribute('data-index'));
      if (i <= 23) seen[i] = (await el.getAttribute('aria-label')).replace(/^[^:]+: /, '');
    }
  }
  await grid.evaluate((el) => (el.scrollTop = 0));
  return seen;
}
const before = await labels();
const expected = {
  0: 'Coyote', 1: 'Bobcat', 2: 'Javelina ×3', 3: 'Nothing in this photo', 4: 'Rabbit (Desert Cottontail)', 5: 'Puma',
  6: 'Nothing in this photo', 7: 'Human', 8: 'Badger', 9: 'Bear', 10: 'Coatimundi', 11: 'Domestic Dog', 12: 'Fox',
  13: 'Puma ×2', 14: 'Horse', 15: 'Deer (Mule)', 16: 'Deer (White-Tailed)', 17: 'Squirrel', 18: 'Squirrel', 19: 'Turkey',
  20: 'Bird', 21: 'Rock Squirrel', 22: 'Coyote', 23: 'Not tagged yet',
};
const diff = (got) => Object.entries(expected).filter(([i, label]) => got[i] !== label).map(([i, label]) => `${i}: want ${label}, got ${got[i]}`);
if (diff(before).length) throw new Error(`before reload:\n${diff(before).join('\n')}`);
step('23 photos tagged as planned; Undo worked twice');

await page.reload();
await tile(0).waitFor();
const after = await labels();
if (diff(after).length) throw new Error(`after reload:\n${diff(after).join('\n')}`);
step(`after reload the same 23 tags are there (${await page.getByRole('button', { name: /^Tagged/ }).innerText()})`);
await shot('11-after-reload');

await page.goto(app);
await page.getByTestId('card-row').first().waitFor();
await shot('12-cards-after');
step(`cards: ${await page.getByTestId('card-row').first().innerText()}`.replace(/\n/g, ' | '));

const aws = new AwsClient({ accessKeyId: login, secretAccessKey: password, service: 's3', region: 'us-east-1' });
for (const file of ['datapackage.json', 'deployments.csv', 'media.csv', 'observations.csv']) {
  const res = await aws.fetch(`${endpoint}/${bucket}/${file}`);
  await writeFile(join(packageDir, file), await res.text());
}
step(`package files downloaded to ${packageDir}`);
if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
await browser.close();
