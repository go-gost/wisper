#!/usr/bin/env python3
"""Generate Android launcher and notification icons from appicon.png.

Source of truth: appicon.png (white ghost on solid black square) at repo root.

Outputs:
  Adaptive icon foreground (drawable) — real ghost silhouette on transparent,
  density variants at 108dp:
    res/drawable-mdpi/ic_launcher_foreground.png      (108x108)
    res/drawable-hdpi/ic_launcher_foreground.png      (162x162)
    res/drawable-xhdpi/ic_launcher_foreground.png     (216x216)
    res/drawable-xxhdpi/ic_launcher_foreground.png    (324x324)
    res/drawable-xxxhdpi/ic_launcher_foreground.png   (432x432)

  Launcher fallback (mipmap) — ghost on #1A1A2E brand background:
    res/mipmap-mdpi/ic_launcher.png      (48x48)
    res/mipmap-hdpi/ic_launcher.png      (72x72)
    res/mipmap-xhdpi/ic_launcher.png     (96x96)
    res/mipmap-xxhdpi/ic_launcher.png    (144x144)
    res/mipmap-xxxhdpi/ic_launcher.png   (192x192)

  Notification (drawable) — white ghost silhouette with punched-out eyes:
    res/drawable-mdpi/ic_notification.png     (24x24)
    res/drawable-hdpi/ic_notification.png     (36x36)
    res/drawable-xhdpi/ic_notification.png    (48x48)
    res/drawable-xxhdpi/ic_notification.png   (72x72)
    res/drawable-xxxhdpi/ic_notification.png  (96x96)

The hand-drawn ic_launcher_foreground.xml vector is removed — the adaptive icon
now uses the real ghost extracted from appicon.png.
"""

import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "appicon.png")
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")

BRAND_BG = (26, 26, 46)  # #1A1A2E

# Adaptive icon foreground: 108dp at each density bucket.
# The inner 72dp is the safe zone — we fit the ghost there.
FOREGROUND_SIZES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}

# Launcher mipmap sizes (px at each density bucket) — fallback for API < 26.
LAUNCHER_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

# Notification icon sizes (px at each density bucket).
# Android docs: 24dp × 24dp at mdpi baseline.
NOTIFICATION_SIZES = {
    "mdpi": 24,
    "hdpi": 36,
    "xhdpi": 48,
    "xxhdpi": 72,
    "xxxhdpi": 96,
}


def isolate_ghost(img: Image.Image) -> Image.Image:
    """Crop to the ghost body and flood-fill black background → transparent.

    Same pipeline as gen-icons.py: bright-pixel bbox → crop → corner flood-fill
    to transparency → tight crop.
    """
    img = img.convert("RGBA")
    W, H = img.size

    # Bbox from bright (ghost-body) pixels — ignores dark fringe.
    bright = img.convert("L").point(lambda v: 255 if v > 100 else 0)
    bbox = bright.getbbox() or (0, 0, W, H)
    l, t, r, b = bbox
    pad = max(4, int(max(W, H) * 0.02))
    img = img.crop((max(0, l - pad), max(0, t - pad), min(W, r + pad), min(H, b + pad)))

    # Corners → transparent
    cw, ch = img.size
    for corner in [(0, 0), (cw - 1, 0), (0, ch - 1), (cw - 1, ch - 1)]:
        ImageDraw.floodfill(img, corner, value=(0, 0, 0, 0), thresh=50)

    # Final tight crop
    bb = img.getbbox()
    if bb:
        img = img.crop(bb)
    return img


def make_foreground(ghost: Image.Image, px: int) -> Image.Image:
    """Place the isolated ghost onto a transparent canvas at `px`×`px`.

    The ghost is scaled to fit within the 72dp safe zone (66.67% of the 108dp
    viewport) so it won't be clipped by circular / squircles masks.
    """
    safe_zone = int(px * 0.50)  # 54dp → generous margin for circular masks
    margin = (px - safe_zone) // 2

    # Create transparent canvas
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))

    # Scale ghost to fit within safe zone
    ghost_w, ghost_h = ghost.size
    scale = safe_zone / max(ghost_w, ghost_h)
    new_w = int(ghost_w * scale)
    new_h = int(ghost_h * scale)
    ghost_scaled = ghost.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Center on canvas
    ox = (px - new_w) // 2
    oy = (px - new_h) // 2
    canvas.paste(ghost_scaled, (ox, oy), ghost_scaled)
    return canvas


def make_launcher_icon(ghost: Image.Image, px: int) -> Image.Image:
    """Place the isolated ghost onto the brand background at `px`×`px`."""
    # Pad ghost to square with 15% margin (adaptive icon safe zone)
    side = max(ghost.width, ghost.height)
    margin = int(side * 0.15)
    canvas_size = side + 2 * margin

    # Create brand-background canvas
    canvas = Image.new("RGBA", (canvas_size, canvas_size), BRAND_BG + (255,))
    canvas.paste(
        ghost,
        ((canvas_size - ghost.width) // 2, (canvas_size - ghost.height) // 2),
        ghost,
    )
    return canvas.resize((px, px), Image.Resampling.LANCZOS)


def make_notification_icon(ghost: Image.Image, px: int) -> Image.Image:
    """Create a white silhouette with transparent eye holes.

    Android tints the notification icon, so it must be white-on-transparent.
    Dark pixels (eyes) are punched out to transparent to keep the ghost
    recognisable as more than a white blob.
    """
    pixels = list(ghost.get_flattened_data())
    new_data = []
    for r, g, b, a in pixels:
        if a == 0:
            # Already transparent background
            new_data.append((0, 0, 0, 0))
        elif r + g + b < 200:
            # Dark pixel (eye / interior detail) — punch out to transparent
            new_data.append((0, 0, 0, 0))
        else:
            # Ghost body — turn white, preserving edge anti-aliasing alpha
            new_data.append((255, 255, 255, a))
    white_ghost = Image.new("RGBA", ghost.size)
    white_ghost.putdata(new_data)

    # Pad to square with ~8% transparent margin so it doesn't touch edges.
    side = max(white_ghost.width, white_ghost.height)
    margin = int(side * 0.08)
    canvas_size = side + 2 * margin
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    canvas.paste(
        white_ghost,
        ((canvas_size - white_ghost.width) // 2, (canvas_size - white_ghost.height) // 2),
        white_ghost,
    )
    return canvas.resize((px, px), Image.Resampling.LANCZOS)


def main() -> int:
    if not os.path.isfile(SRC):
        print(f"error: source appicon not found at {SRC}", file=sys.stderr)
        return 1

    src = Image.open(SRC)
    if src.mode != "RGBA":
        src = src.convert("RGBA")
    print(f"source: {SRC}  {src.size[0]}x{src.size[1]} {src.mode}")

    ghost = isolate_ghost(src)

    # --- Adaptive icon foreground drawables (API 26+) ---
    for density, px in FOREGROUND_SIZES.items():
        dest_dir = os.path.join(RES, f"drawable-{density}")
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, "ic_launcher_foreground.png")
        make_foreground(ghost, px).save(dest, format="PNG")
        print(f"  fgnd    {density:6s}  {px:3d}x{px:<3d}  → {os.path.relpath(dest, ROOT)}")

    # --- Remove hand-drawn vector foreground so PNG takes precedence ---
    vector_fg = os.path.join(RES, "drawable", "ic_launcher_foreground.xml")
    if os.path.isfile(vector_fg):
        os.remove(vector_fg)
        print(f"  removed {os.path.relpath(vector_fg, ROOT)} (replaced by real ghost PNG)")

    # --- Launcher mipmap icons (fallback for API < 26) ---
    for density, px in LAUNCHER_SIZES.items():
        dest_dir = os.path.join(RES, f"mipmap-{density}")
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, "ic_launcher.png")
        make_launcher_icon(ghost, px).save(dest, format="PNG")
        print(f"  launcher {density:6s}  {px:3d}x{px:<3d}  → {os.path.relpath(dest, ROOT)}")

    # --- Launcher mipmap round icons (same image) ---
    for density, px in LAUNCHER_SIZES.items():
        dest_dir = os.path.join(RES, f"mipmap-{density}")
        dest = os.path.join(dest_dir, "ic_launcher_round.png")
        make_launcher_icon(ghost, px).save(dest, format="PNG")
        print(f"  launcher {density:6s}  {px:3d}x{px:<3d}  → {os.path.relpath(dest, ROOT)} (round)")

    # --- Notification icons ---
    for density, px in NOTIFICATION_SIZES.items():
        dest_dir = os.path.join(RES, f"drawable-{density}")
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, "ic_notification.png")
        make_notification_icon(ghost, px).save(dest, format="PNG")
        print(f"  notify  {density:6s}  {px:3d}x{px:<3d}  → {os.path.relpath(dest, ROOT)}")

    # Clean up the old non-density notification icon so it doesn't shadow the
    # new density-specific ones.
    old_notify = os.path.join(RES, "drawable", "ic_notification.png")
    if os.path.isfile(old_notify):
        os.remove(old_notify)
        print(f"  removed old {os.path.relpath(old_notify, ROOT)}")

    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
