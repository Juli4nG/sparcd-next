import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

const pad = (n: number) => String(n).padStart(2, '0');

/** An APP1 segment holding only Exif DateTimeOriginal ("YYYY:MM:DD HH:MM:SS"), big-endian. */
function exifSegment(dateTimeOriginal: string): Buffer {
  const tiff = Buffer.alloc(64);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  // IFD0 at 8: one entry, the pointer to the Exif IFD at 26.
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x8769, 10);
  tiff.writeUInt16BE(4, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt32BE(26, 18);
  tiff.writeUInt32BE(0, 22);
  // Exif IFD at 26: DateTimeOriginal, 20 ASCII bytes at 44.
  tiff.writeUInt16BE(1, 26);
  tiff.writeUInt16BE(0x9003, 28);
  tiff.writeUInt16BE(2, 30);
  tiff.writeUInt32BE(20, 32);
  tiff.writeUInt32BE(44, 36);
  tiff.writeUInt32BE(0, 40);
  tiff.write(`${dateTimeOriginal}\0`, 44, 'latin1');
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Puts the APP1 segment right after JFIF's APP0, where cameras put it. */
function withExif(jpeg: Buffer, dateTimeOriginal: string): Buffer {
  const at = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + jpeg.readUInt16BE(4) : 2;
  return Buffer.concat([jpeg.subarray(0, at), exifSegment(dateTimeOriginal), jpeg.subarray(at)]);
}

export type Folder = { dir: string; name: string; count: number; date: Date };

/**
 * Two small trail-camera-like videos, made with ffmpeg: VID_0001.MP4 is VP9,
 * which Playwright's Chromium decodes, with a zero location tag and a
 * creation time; VID_0002.MP4 is H.264, which it can't, with no time.
 */
export const VIDEOS = ['VID_0001.MP4', 'VID_0002.MP4'];
export const VIDEO_LOCATION = '+00.0000+000.0000/';

export function addVideos(folder: Folder): void {
  for (const name of VIDEOS) copyFileSync(join(import.meta.dirname, '..', 'fixtures', name), join(folder.dir, name));
}

/**
 * A card folder named the way field volunteers name them, "<site>_MM.DD.YY_<count>.images",
 * of small distinct JPEGs drawn in Chromium, each with a DateTimeOriginal on the day before.
 */
export async function makeFolder(page: Page, site: string, count: number, daysAgo: number): Promise<Folder> {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  const name = `${site}_${pad(date.getMonth() + 1)}.${pad(date.getDate())}.${String(date.getFullYear()).slice(2)}_${count}.images`;
  const dir = join(mkdtempSync(join(tmpdir(), 'sparcd-e2e-')), name);
  mkdirSync(dir);

  const jpegs: string[] = await page.evaluate(async (n) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const canvas = new OffscreenCanvas(800, 600);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `hsl(${(i * 360) / n} 45% 40%)`;
      ctx.fillRect(0, 0, 800, 600);
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = `hsl(${Math.random() * 360} 50% ${30 + Math.random() * 40}%)`;
        ctx.fillRect(Math.random() * 800, Math.random() * 600, 20 + Math.random() * 120, 20 + Math.random() * 120);
      }
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 96px sans-serif';
      ctx.fillText(`IMG ${i + 1}`, 60, 320);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer());
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      out.push(btoa(s));
    }
    return out;
  }, count);

  const shot = new Date(date.getTime() - 86_400_000);
  jpegs.forEach((b64, i) => {
    const t = new Date(shot.getFullYear(), shot.getMonth(), shot.getDate(), 6, i * 3, 0);
    const stamp = `${t.getFullYear()}:${pad(t.getMonth() + 1)}:${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:00`;
    writeFileSync(join(dir, `IMG_${String(i + 1).padStart(4, '0')}.JPG`), withExif(Buffer.from(b64, 'base64'), stamp));
  });
  return { dir, name, count, date };
}
