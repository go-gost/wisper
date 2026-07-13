#!/usr/bin/env python3
"""Generate Chrome extension icons from appicon.png.

Single source of truth: appicon.png (white ghost on solid black square) at
the repo root. Run this whenever appicon.png changes.

Uses the same ghost-isolation pipeline as gen-icons.py: crop to ghost body,
flood-fill residual black to transparent, tight crop, pad to square with
transparent margin, resize. Extension icons also get a thin black outline
around the ghost silhouette so they remain visible on light/white backgrounds
(Chrome's default toolbar and extension management pages).

Outputs (all created/overwritten, idempotent):
  extension/icons/icon16.png    browser action + extension management (16x16)
  extension/icons/icon48.png    browser action + extension management (48x48)
  extension/icons/icon128.png   extension management + CWS listing (128x128)
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "appicon.png")

EXT_ICONS_DIR = os.path.join(ROOT, "extension", "icons")

# Chrome extension icon sizes (px).
# 16px — browser action toolbar icon (default, retina at 32px implied)
# 48px — browser action retina + extension management tile
# 128px — extension management detail page + Chrome Web Store listing
EXT_ICON_SIZES = {
    16: "icon16.png",
    48: "icon48.png",
    128: "icon128.png",
}


def isolate_ghost(src: Image.Image) -> Image.Image:
    """Isolate the ghost on a transparent background.

    Two-stage pipeline (identical to gen-icons.py):
      1. Bounding box from bright (ghost-body) pixels — dark fringe and stray
         pixels are ignored, so the box is the true ghost extent.
      2. Crop to that box, then flood-fill the residual black background
         (corners + gaps between the ghost's wavy tendrils) to transparent.
         The eyes are interior black, disconnected from the border, so they
         survive.

    Returns the tight-cropped ghost on a transparent background (unsized).
    """
    img = src.convert("RGBA")
    W, H = img.size

    # Stage 1 — bbox of the bright ghost body (immune to dark fringe/strays).
    bright = img.convert("L").point(lambda v: 255 if v > 100 else 0)
    bbox = bright.getbbox() or (0, 0, W, H)
    l, t, r, b = bbox
    pad = max(4, int(max(W, H) * 0.02))  # don't clip the body's outer edge
    img = img.crop((max(0, l - pad), max(0, t - pad), min(W, r + pad), min(H, b + pad)))

    # Stage 2 — remove the residual black background by flood-filling from
    # each corner to transparent.
    cw, ch = img.size
    for corner in [(0, 0), (cw - 1, 0), (0, ch - 1), (cw - 1, ch - 1)]:
        ImageDraw.floodfill(img, corner, value=(0, 0, 0, 0), thresh=50)

    # Final tight crop to the ghost body.
    bb = img.getbbox()
    if bb:
        img = img.crop(bb)
    return img


def add_black_outline(img: Image.Image, px: int) -> Image.Image:
    """Add a thin black outline around the ghost silhouette.

    Dilates the alpha channel outward, fills the dilated-only region with black
    (semi-transparent where anti-aliased), then composites the original ghost on
    top. The result is a black keyline that defines the ghost shape against both
    light and dark backgrounds.

    Outline width scales with the target icon size so it's visible but not
    overpowering at every resolution.
    """
    alpha = img.split()[3]

    # Dilate the alpha mask to expand the ghost shape outward.
    # Filter size controls outline width: 3→1px, 5→2px.
    if px <= 16:
        filter_size = 3   # 1px — enough to be visible without overwhelming
    elif px <= 48:
        filter_size = 3   # 1px at 48px is subtle but effective
    else:
        filter_size = 5   # 2px at 128px gives proportional thickness

    dilated = alpha.filter(ImageFilter.MaxFilter(filter_size))

    # Build a black layer whose alpha is the dilated mask.
    # The original ghost will be composited on top, so black only shows through
    # in the ring between the original edge and the dilated edge.
    black_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    black_data = black_layer.load()
    dil_data = dilated.load()
    for y in range(img.height):
        for x in range(img.width):
            a = dil_data[x, y]
            if a > 0:
                black_data[x, y] = (0, 0, 0, a)

    # Composite: black outline behind the original ghost.
    return Image.alpha_composite(black_layer, img)


def make_ghost_icon(src: Image.Image, dest: str, px: int) -> None:
    """Isolate the ghost, add outline, pad to square with margin, and resize.

    The outline is added before the final margin padding so the dilated edge
    doesn't get cropped by the bbox step.
    """
    img = isolate_ghost(src)

    # Pad the ghost to a square with a transparent margin before resizing.
    # Smaller margin for tiny icons so the ghost remains visible.
    side = max(img.width, img.height)
    margin_pct = 0.03 if px <= 16 else 0.06
    margin = int(side * margin_pct)
    canvas_size = side + 2 * margin
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    canvas.paste(
        img,
        ((canvas_size - img.width) // 2, (canvas_size - img.height) // 2),
        img,
    )

    # Resize to target size first, then add the outline at final resolution.
    # This gives precise control over stroke width in device pixels.
    sized = canvas.resize((px, px), Image.Resampling.LANCZOS)
    outlined = add_black_outline(sized, px)
    outlined.save(dest, format="PNG")


def main() -> int:
    if not os.path.isfile(SRC):
        print(f"error: source logo not found at {SRC}", file=sys.stderr)
        return 1

    src = Image.open(SRC)
    if src.mode != "RGBA":
        src = src.convert("RGBA")
    print(f"source: {SRC}  {src.size[0]}x{src.size[1]} {src.mode}")

    os.makedirs(EXT_ICONS_DIR, exist_ok=True)

    for px, name in sorted(EXT_ICON_SIZES.items()):
        dest = os.path.join(EXT_ICONS_DIR, name)
        make_ghost_icon(src, dest, px)
        print(f"  wrote {os.path.relpath(dest, ROOT)} ({px}x{px}, black outline)")

    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
