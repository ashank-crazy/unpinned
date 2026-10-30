"""Draws the app icons and the small preview pictures for the example buttons.

Requires Pillow:  python3 -m pip install pillow
Run from the project folder after make_samples.py:  python3 scripts/make_assets.py
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
ACCENT = (11, 95, 117)
WHITE = (255, 255, 255)


def draw_mark(size: int, scale: float, rounded: bool) -> Image.Image:
    """The pin-with-a-slash mark, drawn large and scaled down for smooth edges."""
    big = size * 4
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if rounded:
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=big * 0.28, fill=ACCENT)
    else:
        draw.rectangle((0, 0, big, big), fill=ACCENT)

    unit = big / 32 * scale
    offset = big / 2 - 16 * unit

    def point(x: float, y: float) -> tuple[float, float]:
        return (offset + x * unit, offset + y * unit)

    # The pin: a circle of radius 6.5 around (16, 13.5) narrowing to a tip at (16, 25.5).
    # Walk the arc over the top, between the two points where the sides leave the circle.
    cx, cy, r, tip = 16, 13.5, 6.5, 25.5
    side = math.acos(r / (tip - cy))
    start = math.pi / 2 + side
    sweep = 2 * math.pi - 2 * side
    pin = [point(cx + r * math.cos(start + sweep * i / 120), cy + r * math.sin(start + sweep * i / 120)) for i in range(121)]
    pin.append(point(16, tip))
    draw.polygon(pin, fill=WHITE)
    hole = 2.6 * unit
    x, y = point(cx, cy)
    draw.ellipse((x - hole, y - hole, x + hole, y + hole), fill=ACCENT)

    # The slash, with a gap cut around it so it reads against the pin.
    width = round(2.4 * unit)
    ends = [point(7, 7), point(25, 25)]
    draw.line(ends, fill=ACCENT, width=round(5.2 * unit))
    draw.line(ends, fill=WHITE, width=width)
    for end in ends:
        half = width / 2
        draw.ellipse((end[0] - half, end[1] - half, end[0] + half, end[1] + half), fill=WHITE)
    return image.resize((size, size), Image.LANCZOS)


def make_icons() -> None:
    icons = PUBLIC / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    draw_mark(192, 1.0, True).save(icons / "icon-192.png", optimize=True)
    draw_mark(512, 1.0, True).save(icons / "icon-512.png", optimize=True)
    # Maskable icons fill the square; launchers cut their own shape, so keep the mark in the middle 70%.
    draw_mark(512, 0.7, False).save(icons / "icon-maskable-512.png", optimize=True)
    apple = draw_mark(180, 0.86, False).convert("RGB")
    apple.save(icons / "apple-touch-icon.png", optimize=True)


def make_thumbs() -> None:
    thumbs = PUBLIC / "samples" / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)
    for name, top in (("desk-for-sale.jpg", False), ("boarding-pass.png", True), ("order-receipt.png", True)):
        picture = Image.open(PUBLIC / "samples" / name).convert("RGB")
        # Tall screenshots show their top; photos show their middle.
        thumb = ImageOps.fit(picture, (480, 360), Image.LANCZOS, centering=(0.5, 0.0 if top else 0.5))
        # Saved without any metadata.
        thumb.save(thumbs / (Path(name).stem + ".jpg"), quality=82, optimize=True, progressive=True)


if __name__ == "__main__":
    make_icons()
    make_thumbs()
    print("Wrote icons and example previews.")
