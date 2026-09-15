#!/usr/bin/env python3
"""
icon — draw the application icon from source.

Day 24. electron-builder had been logging `default Electron icon is used` since
Day 21, so every desktop build shipped with the Electron logo in the dock and
the taskbar. That is the first thing a playtester sees, before the title card
and before a single ball is struck, and Block 1 of the plan starts with eight
strangers meeting this build cold.

The icon is generated rather than drawn by hand and checked in as a blob, for
the same reason `PADDLE_INERTIA` is derived rather than asserted: a binary
nobody can regenerate is a number nobody can change. Run this and every size is
rebuilt from one description.

The design constraint that decides everything: **it has to read at 16 px.** A
taskbar icon is 16 to 32 device pixels and no amount of detail at 1024 survives
that. So the rules are the poster rules — one silhouette, two colours, and
nothing whose absence at small size changes what the thing is.

Usage:
  python3 tools/icon.py            # write desktop/resources + the favicon
  python3 tools/icon.py --contact  # also write a contact sheet to look at
"""

import argparse
import base64
import io
import math
import os
import re

from PIL import Image, ImageDraw

OUT_DIR = "desktop/resources"
MASTER = 1024

# The game's own palette, so the icon and the first frame agree.
INK = (11, 18, 25, 255)        # --bg, the panel navy
BALL = (255, 182, 72, 255)     # --accent, and the ball on court
COURT = (31, 78, 121, 255)     # the court blue, for the ground
LINE = (226, 236, 244, 255)    # court paint


def rounded(size, radius, fill):
    """A rounded square, drawn oversampled so the corners are not stepped."""
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, s - 1, s - 1], radius * 4, fill=fill)
    return img.resize((size, size), Image.LANCZOS)


def draw_master():
    """
    The icon at 1024: a paddle and a ball, and nothing else.

    The first version was the ball alone with seven large holes, because the
    holes are what makes a pickleball a pickleball. Rendered and looked at, it
    was a **film reel**: seven big evenly spaced circles is the aperture
    pattern, and the resemblance was total at 256 px. The mistake is instructive
    — a real ball has forty small holes, which at icon size is a texture, and
    reproducing "holes" as countable shapes reproduces the wrong thing.

    The paddle is the better silhouette and it is unambiguous in a way the ball
    is not. It is not a tennis racket (no strings, no oval), not a ping-pong bat
    (that is round with a thin handle), and the wide flat face with the stubby
    grip is recognisable at a glance by anybody who has held one. At 16 px it
    survives as a tilted slab with a dot beside it, which is a silhouette rather
    than a smudge.
    """
    size = MASTER
    img = rounded(size, int(size * 0.22), INK)

    # Drawn oversampled and composited down: a rotated shape at 1024 has visibly
    # stepped edges, and this is the one image in the project that gets looked
    # at closely at every scale.
    s = size * 3
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # Proportioned from the real thing rather than eyeballed. A regulation
    # paddle is a 16 in body with an 11 x 8 in face, so the face is markedly
    # taller than wide and the handle is a real handle rather than a stub. The
    # first draft had it short and fat and it read as a spatula.
    face_w, face_h = s * 0.295, s * 0.405
    grip_len = s * 0.215
    cx, cy = s * 0.535, s * 0.395

    d.rounded_rectangle(
        [cx - face_w / 2, cy - face_h / 2, cx + face_w / 2, cy + face_h / 2],
        s * 0.068,
        fill=BALL,
    )
    grip_w = s * 0.105
    d.rounded_rectangle(
        [cx - grip_w / 2, cy + face_h / 2 - s * 0.02,
         cx + grip_w / 2, cy + face_h / 2 + grip_len],
        s * 0.026,
        fill=BALL,
    )
    # The edge guard, as an outline rather than a bar across the face. The first
    # draft drew a single inset line and it read as a slot or a mouth — a stripe
    # across a shape says "opening", an outline says "edge". It thins to nothing
    # below about 48 px, which is the correct way for a detail to leave.
    d.rounded_rectangle(
        [cx - face_w / 2, cy - face_h / 2, cx + face_w / 2, cy + face_h / 2],
        s * 0.068,
        outline=INK,
        width=int(s * 0.016),
    )

    # A grip wrap was tried here: three dark bands at the butt of the handle, to
    # stop the silhouette reading as a rounded slab on a stick. Rendered and
    # looked at, three horizontal bands on a narrow stem is a SCREW THREAD, and
    # the icon became a bolt. Deleted rather than tuned, which is the third time
    # this project has built something, measured it worse, and removed it.
    #
    # The lesson generalises: at icon size, repeated parallel marks are read as
    # texture-with-a-meaning long before they are read as detail, and the
    # meaning they land on is rarely the one intended.

    layer = layer.rotate(-20, resample=Image.BICUBIC, center=(cx, cy))

    # The ball, upper left, clear of the paddle and inside the frame. Cream
    # rather than amber so the two shapes separate: a same-coloured ball and
    # paddle merge into one blob at exactly the size where the icon most needs
    # to be legible.
    br = s * 0.092
    bx, by = s * 0.285, s * 0.285
    d2 = ImageDraw.Draw(layer)
    d2.ellipse([bx - br, by - br, bx + br, by + br], fill=LINE)
    # Three holes, not seven. Enough to say perforated, too few to say aperture.
    hr = br * 0.23
    for ang in (-90, 30, 150):
        a = math.radians(ang)
        hx, hy = bx + math.cos(a) * br * 0.46, by + math.sin(a) * br * 0.46
        d2.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=INK)

    layer = layer.resize((size, size), Image.LANCZOS)
    img.alpha_composite(layer)
    return img


def contact_sheet(master, sizes):
    """Every size on one strip, on two backgrounds, at actual pixels."""
    pad = 12
    width = sum(s + pad for s in sizes) + pad
    sheet = Image.new("RGBA", (width, max(sizes) * 2 + pad * 3), (128, 128, 128, 255))
    # Half the strip on white, half on near-black: a dark icon that vanishes on
    # a dark taskbar is a common and entirely avoidable mistake.
    sheet.paste((255, 255, 255, 255), [0, 0, width, max(sizes) + pad * 2])
    sheet.paste((24, 24, 24, 255), [0, max(sizes) + pad * 2, width, sheet.height])
    x = pad
    for s in sizes:
        small = master.resize((s, s), Image.LANCZOS)
        sheet.paste(small, (x, pad), small)
        sheet.paste(small, (x, max(sizes) + pad * 2 + pad), small)
        x += s + pad
    return sheet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", action="store_true")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    master = draw_master()

    # electron-builder wants one big PNG and generates the platform sets from
    # it. 512 is its documented minimum for Linux and it is happy to upscale
    # nothing, so the master is written at 1024 and the icon at 512.
    master.save(f"{OUT_DIR}/icon.png")
    print(f"{OUT_DIR}/icon.png 1024")

    # A real .ico with every size Windows actually asks for. Letting the
    # packager derive this works, but the small sizes come out sharper when
    # each is resampled from the master rather than from an intermediate.
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    master.save(
        f"{OUT_DIR}/icon.ico",
        sizes=[(s, s) for s in ico_sizes],
    )
    print(f"{OUT_DIR}/icon.ico {ico_sizes}")

    # The browser tab, inlined into index.html as a data URI.
    #
    # A `<link href="./favicon.ico">` would work in dev, in the Vite build and
    # in the desktop shell, and would 404 in the published artifact — because
    # `tools/ship.mjs` inlines the whole game into ONE html file and there is no
    # second file for the browser to fetch. That 404 was already visible in the
    # Day 22 browser harness output and went unexplained.
    #
    # A data URI is one line, needs no second request, and is the only form that
    # is correct in all four places. 32 px costs about a kilobyte.
    icon32 = master.resize((32, 32), Image.LANCZOS)
    buf = io.BytesIO()
    icon32.save(buf, format="PNG", optimize=True)
    uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    html = open("index.html", encoding="utf-8").read()
    line = f'    <link rel="icon" type="image/png" href="{uri}" />'
    if 'rel="icon"' in html:
        html = re.sub(r'^ *<link rel="icon".*$', line, html, count=1, flags=re.M)
    else:
        html = html.replace(
            '    <meta name="viewport"',
            line + "\n    <meta name=\"viewport\"",
            1,
        )
    open("index.html", "w", encoding="utf-8").write(html)
    print(f"index.html favicon inlined ({len(uri) / 1024:.1f} kB data URI)")

    if args.contact:
        sheet = contact_sheet(master, [16, 32, 48, 64, 128, 256])
        sheet.save("docs/shots/icon-sizes.png")
        print("docs/shots/icon-sizes.png")


if __name__ == "__main__":
    main()
