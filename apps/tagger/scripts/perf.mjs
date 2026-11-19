// How the grid feels on a big card: open it, scroll top to bottom with the
// wheel while recording frame times, and time one keypress tag.
//
//   node scripts/perf.mjs <shots folder>   (SEED_LOGIN, SEED_PASSWORD; APP as in verify.mjs)
import { join } from 'node:path';
import { chromium } from 'playwright';

const [shots] = process.argv.slice(2);
const app = process.env.APP ?? 'http://localhost:5190/tag/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(app);
await page.getByLabel('Login name').fill(process.env.SEED_LOGIN);
await page.getByLabel('Password').fill(process.env.SEED_PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
const row = page.getByTestId('card-row').filter({ hasText: '5,000 photos' });
await row.waitFor();
await page.screenshot({ path: join(shots, '13-cards-two.png') });

const opened = Date.now();
await row.getByRole('link').click();
await page.locator('[data-testid="photo-tile"]').first().waitFor();
console.log(`- 5,000-photo card open in ${Date.now() - opened} ms; tiles mounted: ${await page.locator('[data-testid="photo-tile"]').count()}`);

await page.evaluate(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => {
    window.__frames.push(t - last);
    last = t;
    if (window.__frames.length < 100000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.getByTestId('photo-grid').hover();
const started = Date.now();
for (let i = 0; i < 400; i++) {
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(16);
}
const scrolled = await page.getByTestId('photo-grid').evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight }));
const frames = (await page.evaluate(() => window.__frames)).slice(2).sort((a, b) => a - b);
const pct = (p) => frames[Math.floor(frames.length * p)].toFixed(1);
console.log(
  `- scrolled ${scrolled.top}/${scrolled.height} px in ${Date.now() - started} ms; frames ${frames.length}, median ${pct(0.5)} ms, p95 ${pct(0.95)} ms, max ${frames.at(-1).toFixed(1)} ms, over 50 ms: ${frames.filter((f) => f > 50).length}; tiles mounted: ${await page.locator('[data-testid="photo-tile"]').count()}`,
);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(shots, '14-5000-photos-scrolled.png') });

const last = page.locator('[data-testid="photo-tile"]').last();
await last.click();
const index = await last.getAttribute('data-index');
const ms = await page.evaluate(
  (i) =>
    new Promise((resolve) => {
      const tile = () => document.querySelector(`[data-index="${i}"]`);
      const t0 = performance.now();
      const watch = new MutationObserver(() => {
        if (tile()?.dataset.tagState === 'tagged') {
          watch.disconnect();
          resolve(performance.now() - t0);
        }
      });
      watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-tag-state'] });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true }));
    }),
  index,
);
console.log(`- keypress to tag on photo ${Number(index) + 1}: ${ms.toFixed(1)} ms`);
await page.locator('[data-save-status="saved"]').waitFor({ timeout: 30_000 });
await page.keyboard.press('Control+z');
await page.locator('[data-save-status="saved"]').waitFor({ timeout: 30_000 });
await browser.close();
