#!/usr/bin/env python3
"""Fail when a README screenshot is a blank window (regression guard for the
blank `screenshot-quick-open.png` incident).

Every docs/screenshot-*.png is a mock window: titlebar plus content. The script
crops the content area inside the window frame and requires real variance, so a
failed headless render (blank white panel) fails CI instead of shipping.

Requires Pillow (`python3 -m pip install pillow`).
"""

import glob
import sys
from pathlib import Path

from PIL import Image, ImageStat

MIN_STDDEV = 4.0
CONTENT_INSET = (60, 160, 60, 40)  # left, top, right, bottom


def check(path: Path) -> tuple[bool, float]:
    image = Image.open(path).convert('RGB')
    width, height = image.size
    if height <= CONTENT_INSET[1] + CONTENT_INSET[3] or width <= CONTENT_INSET[0] + CONTENT_INSET[2]:
        return False, 0.0
    crop = image.crop((CONTENT_INSET[0], CONTENT_INSET[1], width - CONTENT_INSET[2], height - CONTENT_INSET[3]))
    stddev = ImageStat.Stat(crop).stddev
    return max(stddev) >= MIN_STDDEV, round(max(stddev), 2)


def main() -> int:
    files = sorted(glob.glob('docs/screenshot-*.png'))
    if not files:
        print('screenshot check: no docs/screenshot-*.png found')
        return 1
    failures = 0
    for name in files:
        image = Image.open(name)
        if image.height < 300:
            print(f'screenshot check: skip  (partial strip) {name}')
            continue
        ok, score = check(Path(name))
        status = 'ok' if ok else 'BLANK'
        print(f'screenshot check: {status:5s} stddev={score:5.2f} {name}')
        if not ok:
            failures += 1
    if failures:
        print(f'screenshot check: {failures} blank screenshot(s)')
        return 1
    print(f'screenshot check: {len(files)} screenshots look rendered')
    return 0


if __name__ == '__main__':
    sys.exit(main())
