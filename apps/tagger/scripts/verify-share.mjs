// End-to-end check of sharing: the owner sends a card with the Uploader, tags
// two photos (one Human), and shares it; the recipient opens the link in
// another browser, signs in, tags 10 photos, reloads, and sees the card under
// "Shared with you". Downloads both packages for frictionless.
//
//   node scripts/verify-share.mjs <shots folder> <packages folder>
// Reads OWNER_LOGIN, OWNER_PASSWORD, RECIPIENT_LOGIN, RECIPIENT_PASSWORD, UPLOAD_CARD;
// ORIGIN defaults to http://localhost:8080.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { AwsClient } from 'aws4fetch';

const [shots, packages] = process.argv.slice(2);
const origin = process.env.ORIGIN ?? 'http://localhost:8080';
const { OWNER_LOGIN: owner, OWNER_PASSWORD: ownerPw, RECIPIENT_LOGIN: recipient, RECIPIENT_PASSWORD: recipientPw, UPLOAD_CARD: card } = process.env;
await mkdir(shots, { recursive: true });
const step = (msg) => console.log(`- ${msg}`);
const browser = await chromium.launch();
const errors = [];

async function open() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });
const tile = (page, i) => page.locator(`[data-testid="photo-tile"][data-index="${i}"]`);
const label = async (page, i) => (await tile(page, i).getAttribute('aria-label')).replace(/^[^:]+: /, '');
const saved = (page) => page.locator('[data-save-status="saved"]').waitFor({ timeout: 30_000 });
const signIn = async (page, login, password) => {
  await page.getByLabel('Login name').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
};

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
async function download(login, password) {
  const aws = new AwsClient({ accessKeyId: login, secretAccessKey: password, service: 's3', region: 'us-east-1' });
  const dir = join(packages, login);
  await mkdir(dir, { recursive: true });
  const files = {};
  for (const file of ['datapackage.json', 'deployments.csv', 'media.csv', 'observations.csv']) {
    const res = await aws.fetch(`${origin}/sparcd-next-${login}/${file}`, { headers: { 'x-amz-content-sha256': EMPTY_SHA256 } });
    if (!res.ok) throw new Error(`${login} ${file}: ${res.status}`);
    files[file] = await res.text();
    await writeFile(join(dir, file), files[file]);
  }
  return files;
}

// Owner: send the card, tag two photos, share it.
const o = await open();
await o.goto(`${origin}/upload/`);
await signIn(o, owner, ownerPw);
await o.getByRole('button', { name: 'Juniper Draw' }).click();
await o.getByRole('button', { name: 'Next' }).click();
await o.getByRole('button', { name: 'Next' }).click();
await o.locator('input[type=file]').setInputFiles(card);
await o.getByText(/200 photos found/).waitFor({ timeout: 60_000 });
await o.getByRole('button', { name: 'Send photos' }).click();
await o.getByRole('heading', { name: /photos are saved/ }).waitFor({ timeout: 200_000 });
await o.getByRole('button', { name: 'Tag these photos' }).click();
await tile(o, 0).waitFor();
await tile(o, 0).click();
await o.keyboard.press('h');
await o.keyboard.press('y');
await saved(o);
step(`owner tagged photo 0 as ${await label(o, 0)} and photo 1 as ${await label(o, 1)}`);
await o.goto(`${origin}/tag/`);
await o.getByRole('button', { name: 'Share for tagging' }).first().click();
const linkBox = o.getByLabel('Link to send');
await linkBox.waitFor({ timeout: 30_000 });
await o.getByRole('button', { name: 'Copy link' }).click();
await o.getByRole('button', { name: 'Copied' }).waitFor();
const link = await o.evaluate(() => navigator.clipboard.readText());
if (link !== (await linkBox.inputValue())) throw new Error('the copied link differs from the one shown');
await shot(o, '01-owner-share-dialog');
step(`share link copied: ${link.slice(0, 60)}…`);
const ownerBefore = await download(owner, ownerPw);

// The Human photo must not be in the share.
const shareUrl = decodeURIComponent(new URL(link).hash.replace('#share=', ''));
const dp = await (await fetch(shareUrl)).json();
const shareMedia = await (await fetch(dp.resources.find((r) => r.name === 'media').path)).text();
const humanIds = ownerBefore['observations.csv'].split('\n').map((l) => l.split(',')).filter((c) => c[7] === 'human').map((c) => c[2]);
if (humanIds.length !== 1) throw new Error(`expected one human row, got ${humanIds.length}`);
if (shareMedia.includes(humanIds[0])) throw new Error('the Human photo is in the share');
step(`share has ${shareMedia.trim().split('\n').length - 1} photos; the Human-tagged photo ${humanIds[0].slice(0, 12)}… is not among them`);

// Recipient: open the link, sign in, tag 10 photos, reload.
const r = await open();
await r.goto(link);
await r.getByLabel('Login name').waitFor();
await signIn(r, recipient, recipientPw);
await tile(r, 0).waitFor();
if (!r.url().includes('#share=')) throw new Error('signing in lost the link');
await r.waitForFunction(() => [...document.querySelectorAll('[data-testid="photo-tile"] img')].filter((i) => i.complete && i.naturalWidth).length >= 8);
await tile(r, 0).click();
const keys = ['y', 'l', 'e', 'b', 'o', 'd', 'f', 'q', 'm', 'i'];
for (const k of keys) await r.keyboard.press(k);
await saved(r);
await shot(r, '02-recipient-tagging');
const before = await Promise.all(keys.map((_, i) => label(r, i)));
await r.reload();
await tile(r, 0).waitFor();
const after = await Promise.all(keys.map((_, i) => label(r, i)));
if (before.join() !== after.join() || after.includes('Not tagged yet')) throw new Error(`tags changed on reload: ${before} → ${after}`);
step(`recipient tagged 10 photos and they stayed after reload: ${after.join(', ')}`);
await r.keyboard.press('Enter');
await r.getByRole('dialog', { name: 'Large photo' }).waitFor();
await r.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] img')].some((i) => i.complete && i.naturalWidth > 320));
await shot(r, '03-recipient-large-photo');
await r.keyboard.press('Escape');

await r.goto(`${origin}/tag/`);
await r.getByTestId('shared-row').waitFor();
await shot(r, '04-shared-with-you');
step(`shared with you: ${(await r.getByTestId('shared-row').innerText()).replace(/\n/g, ' | ')}`);

// A broken link, and a remembered one that has run out.
const broken = new URL(shareUrl);
broken.searchParams.set('X-Amz-Signature', '0'.repeat(64));
await r.goto(`${origin}/tag/#share=${encodeURIComponent(broken.href)}`);
const brokenMessage = "This link doesn't work any more. Ask the person who sent it for a new one.";
await r.getByText(brokenMessage).waitFor();
await shot(r, '05-broken-link');
await r.evaluate(() => {
  const links = JSON.parse(localStorage.getItem('sparcd-next.tagger.shareLinks'));
  for (const id in links) links[id] = links[id].replace(/X-Amz-Date=\d{8}/, 'X-Amz-Date=20260101');
  localStorage.setItem('sparcd-next.tagger.shareLinks', JSON.stringify(links));
});
await r.goto(`${origin}/tag/`);
await r.getByTestId('shared-row').getByText(brokenMessage).waitFor();
await shot(r, '06-shared-with-you-expired');
step('the broken link and the expired saved link both show the broken-link message');

const recipientFiles = await download(recipient, recipientPw);
const ownerAfter = await download(owner, ownerPw);
if (ownerAfter['observations.csv'] !== ownerBefore['observations.csv']) throw new Error("the owner's tags changed");
step(`owner's observations.csv is unchanged (${ownerAfter['observations.csv'].trim().split('\n').length - 1} rows)`);
const count = (t) => t.trim().split('\n').length - 1;
step(`recipient package: ${count(recipientFiles['deployments.csv'])} card rows, ${count(recipientFiles['media.csv'])} photo rows, ${count(recipientFiles['observations.csv'])} tags`);
if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
await browser.close();
