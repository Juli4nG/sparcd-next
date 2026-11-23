import { byteBudget } from './budget';

const NO_FRAME_MS = 10_000;
/** Two videos decoding at once keep the main thread free for the progress screen. */
const twoAtATime = byteBudget(2);

/**
 * A still from about a second in (half way through a shorter video), or
 * undefined when the browser can't decode it in time. A worker can't decode
 * video, so this runs on the main thread; the worker scales and encodes it.
 */
export const stillFrame = (file: File): Promise<ImageBitmap | undefined> => twoAtATime(1, () => grab(file));

function grab(file: File): Promise<ImageBitmap | undefined> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  let settled = false;
  return new Promise<ImageBitmap | undefined>((resolve) => {
    const done = (frame?: ImageBitmap) => {
      // A frame that arrives after the time is up is not used.
      if (settled) return void frame?.close();
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = video.onseeked = video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(frame);
    };
    const timer = setTimeout(done, NO_FRAME_MS);
    video.onerror = () => done();
    video.onloadedmetadata = () => {
      video.currentTime = Number.isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0;
    };
    video.onseeked = () => createImageBitmap(video).then(done, () => done());
    video.src = url;
  });
}
