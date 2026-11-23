import { describe, expect, it } from 'vitest';
import { mediaTypeOf, scanDrop, scanFileList } from '../src/send/scan';

const NAMES = ['IMG_1.JPG', 'img_2.jpeg', 'VID_1.MP4', 'clip.mov', 'CLIP.Mov', 'notes.txt', 'VID_2.AVI', 'movie.mp4.part'];
const KEPT = ['IMG_1.JPG', 'img_2.jpeg', 'VID_1.MP4', 'clip.mov', 'CLIP.Mov'];

/** Just enough of the File and Directory Entries API for a folder of files. */
function folder(name: string, files: string[]) {
  const fileEntry = (n: string) => ({ isFile: true, isDirectory: false, name: n, fullPath: `/${name}/${n}`, file: (ok: (f: File) => void) => ok(new File([n], n)) });
  let given = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    createReader: () => ({
      readEntries: (ok: (batch: unknown[]) => void) => {
        const batch = given ? [] : files.map(fileEntry);
        given = true;
        ok(batch);
      },
    }),
  };
}

describe('scan', () => {
  it('keeps JPEG photos and MP4 and MOV videos in any case from a chosen folder', () => {
    const found = scanFileList(NAMES.map((n) => new File([n], n)));
    expect(found.map((c) => c.path)).toEqual(KEPT);
  });

  it('keeps the same files from a dropped folder, with their paths', async () => {
    const items = [{ webkitGetAsEntry: () => folder('CARD', NAMES) }] as unknown as DataTransferItemList;
    const found = await scanDrop(items);
    expect(found.map((c) => c.path)).toEqual(KEPT.map((n) => `CARD/${n}`));
  });

  it('names each kind of file by its content type', () => {
    expect(['A.JPG', 'B.jpeg', 'C.MP4', 'D.mov'].map(mediaTypeOf)).toEqual(['image/jpeg', 'image/jpeg', 'video/mp4', 'video/quicktime']);
  });
});
