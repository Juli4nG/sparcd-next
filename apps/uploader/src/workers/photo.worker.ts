import exifr from 'exifr';
import { mp4Time, stripMp4 } from '../send/mp4';
import { isVideo } from '../send/scan';
import { stripJpeg } from '../send/stripJpeg';

export type ReadResult = {
  sha256: string;
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
  make?: string;
  model?: string;
};

export type Derived = {
  thumb: ArrayBuffer;
  thumbSha256: string;
  view: ArrayBuffer;
  viewSha256: string;
  /** The file as stored: the card's file without its camera data. */
  original: ArrayBuffer;
  originalSha256: string;
};

/** `frame` is a video's still, drawn on the main thread; a video without one gets a placeholder. */
export type WorkerRequest = { kind: 'read'; file: File } | { kind: 'derive'; file: File; frame?: ImageBitmap };
export type WorkerResponse = { ok: true; value: ReadResult | Derived } | { ok: false; error: string; name: string };

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (bytes: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', bytes));

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

async function read(file: File): Promise<ReadResult> {
  if (isVideo(file.name)) {
    const bytes = await file.arrayBuffer();
    return { sha256: await sha256(bytes), dateTimeOriginal: mp4Time(new Uint8Array(bytes)) };
  }
  const [hash, tags] = await Promise.all([
    file.arrayBuffer().then(sha256),
    exifr
      .parse(file, { pick: ['DateTimeOriginal', 'OffsetTimeOriginal', 'Make', 'Model'], reviveValues: false })
      .catch(() => undefined),
  ]);
  return {
    sha256: hash,
    dateTimeOriginal: text(tags?.DateTimeOriginal),
    offsetTimeOriginal: text(tags?.OffsetTimeOriginal),
    make: text(tags?.Make),
    model: text(tags?.Model),
  };
}

function scaled(source: CanvasImageSource, w: number, h: number, longSide: number): OffscreenCanvas {
  const scale = Math.min(1, longSide / Math.max(w, h));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function jpeg(canvas: OffscreenCanvas, quality: number): Promise<[ArrayBuffer, string]> {
  const bytes = await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer();
  return [bytes, await sha256(bytes)];
}

/** A video the browser can't decode: the paper colour with a play triangle. */
function placeholder(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(1600, 900);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4ecd8';
  ctx.fillRect(0, 0, 1600, 900);
  ctx.fillStyle = '#6b6555';
  ctx.beginPath();
  ctx.moveTo(690, 300);
  ctx.lineTo(690, 600);
  ctx.lineTo(950, 450);
  ctx.closePath();
  ctx.fill();
  return canvas;
}

async function derive(file: File, frame?: ImageBitmap): Promise<Derived> {
  const video = isVideo(file.name);
  const bitmap = video ? frame : await createImageBitmap(file, { imageOrientation: 'from-image' });
  let view: OffscreenCanvas;
  try {
    view = bitmap ? scaled(bitmap, bitmap.width, bitmap.height, 1600) : placeholder();
  } finally {
    bitmap?.close();
  }
  const thumb = scaled(view, view.width, view.height, 320);
  const bytes = await file.arrayBuffer();
  const original = (video ? stripMp4(bytes) : stripJpeg(bytes)).buffer;
  const [[viewBytes, viewSha256], [thumbBytes, thumbSha256], originalSha256] = await Promise.all([
    jpeg(view, 0.82),
    jpeg(thumb, 0.75),
    sha256(original),
  ]);
  return { thumb: thumbBytes, thumbSha256, view: viewBytes, viewSha256, original, originalSha256 };
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    if (e.data.kind === 'read') post({ ok: true, value: await read(e.data.file) });
    else {
      const d = await derive(e.data.file, e.data.frame);
      post({ ok: true, value: d }, [d.thumb, d.view, d.original]);
    }
  } catch (err) {
    post({ ok: false, error: err instanceof Error ? err.message : String(err), name: err instanceof Error ? err.name : 'Error' });
  }
};
