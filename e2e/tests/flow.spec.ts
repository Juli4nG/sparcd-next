import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { AwsClient } from 'aws4fetch';
import { VIDEOS, VIDEO_LOCATION, addVideos, makeFolder, type Folder } from './photos';
import { person } from './person';

// One person, one tab, start to finish: each step builds on the one before.
test.describe.configure({ mode: 'serial' });

const SITE = { id: 'owl-canyon', name: 'Owl Canyon' };
/** With uploads slowed to 2.5 s a file and six photos in flight, 24 photos take about 10 s: time enough for a time left. */
const PHOTOS = 24;

let page: Page;
let folder: Folder;
let withVideos: Folder;
let cardHref: string;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  // Species pictures come from an outside host; the letter stands in for them.
  await page.context().route(/^https:\/\/arizona\.box\.com\//, (route) => route.abort());
  folder = await makeFolder(page, SITE.id, PHOTOS, 10);
  withVideos = await makeFolder(page, SITE.id, 2, 20);
  addVideos(withVideos);
});

test.afterAll(async () => {
  await page?.close();
  for (const f of [folder, withVideos]) if (f) rmSync(dirname(f.dir), { recursive: true, force: true });
});

const signIn = async () => {
  const { code, password } = person();
  await page.getByRole('textbox', { name: 'Login name' }).fill(code);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Connect' }).click();
};

async function chooseFolder(chosen = folder, found = `${PHOTOS} photos found`) {
  await page.goto('/upload/#send');
  await page.locator('input[aria-label="Folder of photos"]').setInputFiles(chosen.dir);
  await expect(page.getByTestId('found')).toHaveText(found);
  await page.getByRole('button', { name: 'Next' }).click();
}

/** Site and date as the folder name gives them, then Finish. */
async function answerQuestions(chosen = folder) {
  await expect(page.getByRole('heading', { name: 'Where was the camera?' })).toBeVisible();
  await expect(page.getByTestId('folder')).toContainText(chosen.name);
  const site = page.getByRole('list', { name: 'Sites' }).getByRole('button').first();
  await expect(site).toContainText(SITE.name);
  await expect(site).toHaveClass(/bg-mark/);
  await site.click();

  await expect(page.getByRole('heading', { name: 'When were these photos collected?' })).toBeVisible();
  const fromName = page.getByRole('button', { name: /^From the folder name/ });
  const day = chosen.date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
  await expect(fromName).toContainText(day);
  await expect(fromName).toHaveClass(/bg-mark/);
  await fromName.click();

  await expect(page.getByRole('heading', { name: 'Anything to add?' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();
}

/** The big photo has loaded and the tag screen takes answers. */
async function photoShown(n: number) {
  const img = page.getByRole('img', { name: `Photo ${n}`, exact: true });
  await expect(img).toHaveClass(/opacity-100/);
  await expect(img).toHaveJSProperty('complete', true);
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  // Answers count only once the photo has settled on screen (SETTLE_MS in tag/Simple.tsx).
  await expect(page.getByRole('region', { name: 'Photo' })).toHaveAttribute('data-shown', 'true');
}

const saved = () => expect(page.locator('[data-save-status]')).toHaveText('Saved ✓');

test('signs in on the Uploader', async () => {
  await page.goto('/upload/');
  await signIn();
  await expect(page.getByRole('link', { name: 'Upload photos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
});

test('uploads a folder: site and date from its name, speed and time left, then done', async () => {
  // Slow each photo file just enough for the pace line to settle on a speed and a time left.
  await page.route(/\/Media\//, async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await new Promise((r) => setTimeout(r, 2500));
    await route.fallback();
  });
  await chooseFolder();
  await answerQuestions();

  await expect(page.getByRole('heading', { name: 'Uploading your photos' })).toBeVisible();
  await expect(page.getByTestId('sent-count')).toContainText(`of ${PHOTOS} uploaded`);
  await expect(page.getByTestId('pace')).toContainText(/\d+\.\d MB per second/, { timeout: 20_000 });
  await expect(page.getByTestId('pace')).toContainText(/ · (Less than a minute|About .+) left/, { timeout: 20_000 });

  await expect(page.getByTestId('saved')).toHaveText(`All ${PHOTOS} photos are uploaded`, { timeout: 60_000 });
  await expect(page.getByText(/were already uploaded before/)).toHaveCount(0);
  const tagNow = page.getByRole('link', { name: 'Tag them now' });
  cardHref = (await tagNow.getAttribute('href'))!;
  expect(cardHref).toMatch(new RegExp(`^/tag/#card=${SITE.id}_\\d{4}-\\d{2}-\\d{2}$`));
  await page.unrouteAll({ behavior: 'wait' });
});

test('history shows its loading line, then lists the upload', async () => {
  // deployments.csv waits until the loading line has been seen.
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route(/\/deployments\.csv(\?|$)/, async (route) => {
    await released;
    await route.fallback();
  });
  await page.goto('/upload/');
  const uploads = page.getByTestId('uploads');
  await expect(uploads.locator('summary')).toContainText('Loading…');
  release();

  await expect(uploads.locator('summary')).toHaveText(/Your uploads \(1\)/);
  await expect(uploads.locator('summary')).not.toContainText('Loading…');
  await uploads.locator('summary').click();
  const row = uploads.getByRole('row').nth(1);
  await expect(row.getByRole('link')).toContainText(SITE.name);
  await expect(row.getByRole('link')).toHaveAttribute('href', cardHref);
  await expect(row.getByRole('cell').nth(1)).toHaveText(String(PHOTOS));
  await expect(row.getByRole('cell').nth(2)).toHaveText('0');
  await page.unrouteAll({ behavior: 'wait' });
});

test('uploading the same folder again says the photos were already uploaded', async () => {
  await chooseFolder();
  await answerQuestions();
  await expect(page.getByTestId('saved')).toHaveText(`All ${PHOTOS} photos are uploaded`, { timeout: 30_000 });
  await expect(page.getByText(`${PHOTOS} photos were already uploaded before.`)).toBeVisible();
});

test('uploads videos with the photos: a still for each, the video type, and no location in the stored video', async () => {
  await chooseFolder(withVideos, '2 photos and 2 videos found');
  await answerQuestions(withVideos);
  await expect(page.getByTestId('saved')).toHaveText('All 2 photos and 2 videos are uploaded', { timeout: 30_000 });
  await expect(page.getByText(/left out|too big/)).toHaveCount(0);

  // Straight to storage, as the person, to see what was stored.
  const { code, password } = person();
  const aws = new AwsClient({ accessKeyId: code, secretAccessKey: password, service: 's3', region: 'us-east-1' });
  const bucket = `http://localhost:8080/sparcd-next-${code}`;
  const get = async (key: string) => {
    const res = await aws.fetch(`${bucket}/${key}`, { headers: { 'x-amz-content-sha256': EMPTY_SHA } });
    expect(res.status, key).toBe(200);
    return Buffer.from(await res.arrayBuffer());
  };
  const media = (await get('media.csv')).toString('utf8');
  const views: Record<string, [number, number]> = {};
  for (const name of VIDEOS) {
    const card = readFileSync(join(withVideos.dir, name));
    const id = createHash('sha256').update(card).digest('hex');
    expect(media).toMatch(new RegExp(`^${id},.*,${name},video/mp4,`, 'm'));
    const original = await get(`Media/${id}/${name}`);
    expect(original.length).toBe(card.length);
    expect(original.includes(VIDEO_LOCATION)).toBe(false);
    await get(`Media/${id}/thumb.jpg`);
    views[name] = jpegSize(await get(`Media/${id}/view.jpg`));
  }
  expect(readFileSync(join(withVideos.dir, VIDEOS[0])).includes(VIDEO_LOCATION)).toBe(true);
  // The VP9 video's still is its own 320 × 240 frame; the H.264 one gets the 1600 × 900 placeholder.
  expect(views).toEqual({ [VIDEOS[0]]: [320, 240], [VIDEOS[1]]: [1600, 900] });
});

test('the Tagger opens with no second sign-in', async () => {
  await page.goto('/tag/');
  await expect(page.getByRole('heading', { name: 'Photos to tag' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Login name' })).toHaveCount(0);
});

test('tags a photo, and the tag is still there after a reload', async () => {
  await page.goto(cardHref);
  await photoShown(1);
  await page.getByRole('button', { name: 'Something else…' }).click();
  await page.getByLabel('Search species').fill('Bobcat');
  await page.getByRole('list', { name: 'Species' }).getByRole('button', { name: 'Bobcat' }).click();
  await expect(page.getByTestId('receipt')).toContainText('Bobcat on photo 1');
  await saved();
  await expect(page.getByTestId('progress')).toContainText(`1 of ${PHOTOS} photos tagged`);

  await page.reload();
  await expect(page.getByTestId('progress')).toContainText(`1 of ${PHOTOS} photos tagged`);
  await page.getByRole('button', { name: 'Photo 1, tagged' }).click();
  await photoShown(1);
  await expect(page.getByRole('button', { name: 'Take Bobcat off this photo' })).toBeVisible();
});

test('a big photo that fails to load offers Try again, which loads it', async () => {
  let failing = true;
  const views: string[] = [];
  await page.route(/\/Media\/[0-9a-f]{64}\/view\.jpg/, (route) => {
    views.push(route.request().url());
    return failing ? route.abort('connectionfailed') : route.fallback();
  });
  await page.goto(cardHref);
  await page.reload();
  // The first untagged photo is photo 2.
  await expect(page.getByText(`Photo 2 of ${PHOTOS}`)).toBeVisible();
  await expect(page.getByText("This photo didn't load. Check your internet connection.")).toBeVisible();

  failing = false;
  const before = views.length;
  await page.getByRole('button', { name: 'Try again' }).click();
  await photoShown(2);
  expect(views.length).toBeGreaterThan(before);

  await page.getByRole('button', { name: 'Nothing in this photo' }).click();
  await expect(page.getByTestId('receipt')).toContainText('Nothing in this photo on photo 2');
  await saved();
  await expect(page.getByTestId('progress')).toContainText(`2 of ${PHOTOS} photos tagged`);
  await page.unrouteAll({ behavior: 'wait' });
});

test('old /simple/ and /classic/ paths go to the new apps', async () => {
  await page.goto('/simple/upload/');
  await expect(page).toHaveURL('/upload/');
  await page.goto('/classic/tag/');
  await expect(page).toHaveURL('/tag/');
});

test('signs out, in every open tab', async () => {
  await page.goto('/upload/');
  await expect(page.getByRole('link', { name: 'Upload photos' })).toBeVisible();
  // A tab opened from this one starts with a copy of its sign-in.
  const [other] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => void window.open('/tag/'))]);
  await expect(other.getByRole('heading', { name: 'Photos to tag' })).toBeVisible();
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('textbox', { name: 'Login name' })).toBeVisible();
  await expect(other.getByRole('textbox', { name: 'Login name' })).toBeVisible();
  await other.reload();
  await expect(other.getByRole('textbox', { name: 'Login name' })).toBeVisible();
  await other.close();
  await page.goto('/tag/');
  await expect(page.getByRole('textbox', { name: 'Login name' })).toBeVisible();
});

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Width and height from a JPEG's frame header. */
function jpegSize(jpeg: Buffer): [number, number] {
  for (let i = 2; i < jpeg.length; ) {
    const marker = jpeg[i + 1];
    if (marker >= 0xc0 && marker <= 0xc2) return [jpeg.readUInt16BE(i + 7), jpeg.readUInt16BE(i + 5)];
    i += 2 + jpeg.readUInt16BE(i + 2);
  }
  throw new Error('no frame header');
}
