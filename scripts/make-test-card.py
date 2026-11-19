"""Make a synthetic SD card: unique 12 MP JPEGs under DCIM/100RECNX/.

Usage: uv run --with pillow scripts/make-test-card.py <card-folder> [count=5000]


20 base images are encoded once; each output file splices a unique EXIF APP1
(DateTimeOriginal in 1-minute steps, Make/Model) and a unique COM segment after
SOI, so every SHA-256 differs without re-encoding. Every 100th file gets no
EXIF at all (only the unique comment) to exercise the no-camera-time path.
"""
import io
import os
import random
import struct
import sys
import time
from datetime import datetime, timedelta

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(sys.argv[1], 'DCIM', '100RECNX')
COUNT = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
W, H = 4000, 3000
random.seed(int(os.environ.get('CARD_SEED', '650')))


def base_image(i):
    scale = random.choice([36, 40, 44, 48])
    q = random.choice([80, 82, 84])
    sw, sh = W // scale, H // scale
    small = Image.frombytes('RGB', (sw, sh), random.randbytes(sw * sh * 3))
    img = small.resize((W, H), Image.BICUBIC)
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default()
    for name in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf'):
        try:
            font = ImageFont.truetype(name, 420)
            break
        except OSError:
            pass
    d.rectangle([150, 150, 1700, 750], fill=(20, 20, 20))
    d.text((220, 200), f'B{i:02d}', fill=(240, 240, 240), font=font)
    b = io.BytesIO()
    img.save(b, 'JPEG', quality=q)
    return b.getvalue()


def segment(marker, payload):
    return marker + struct.pack('>H', len(payload) + 2) + payload


def exif_bytes(dt):
    ex = Image.Exif()
    ex[0x010F] = 'RECONYX'
    ex[0x0110] = 'HyperFire 2'
    ex[0x0132] = dt.strftime('%Y:%m:%d %H:%M:%S')
    sub = ex.get_ifd(0x8769)
    sub[0x9003] = dt.strftime('%Y:%m:%d %H:%M:%S')
    sub[0x9004] = dt.strftime('%Y:%m:%d %H:%M:%S')
    return ex.tobytes()


def main():
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    bases = [base_image(i) for i in range(20)]
    print(f'bases done {time.time() - t0:.1f}s sizes(MB)={[round(len(b) / 1e6, 2) for b in bases]}', flush=True)
    start = datetime(2026, 4, 1, 6, 0, 0)
    total = 0
    for n in range(1, COUNT + 1):
        base = bases[(n * 7) % 20]
        assert base[:2] == b'\xff\xd8'
        parts = [b'\xff\xd8']
        if n % 100 != 0:
            exif = exif_bytes(start + timedelta(minutes=n - 1))
            parts.append(segment(b'\xff\xe1', exif))
        parts.append(segment(b'\xff\xfe', f'test card file {n:05d} {random.getrandbits(64):016x}'.encode()))
        parts.append(base[2:])
        data = b''.join(parts)
        with open(os.path.join(OUT, f'IMG_{n:04d}.JPG'), 'wb') as f:
            f.write(data)
        total += len(data)
        if n % 500 == 0:
            print(f'{n} files {total / 1e9:.2f} GB {time.time() - t0:.1f}s', flush=True)
    print(f'DONE {COUNT} files total={total / 1e9:.3f} GB mean={total / COUNT / 1e6:.3f} MB {time.time() - t0:.1f}s', flush=True)


main()
