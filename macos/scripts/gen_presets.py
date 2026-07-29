#!/usr/bin/env python3
"""Generate original WorkBuddy Dream Skin preset backgrounds (2560x1440).
All art is procedurally generated — no copyrighted or third-party imagery."""
import math, random, os
from PIL import Image, ImageDraw, ImageFilter

W, H = 2560, 1440
OUT = os.path.join(os.path.dirname(__file__), "..", "presets")
random.seed(20260720)

def lerp(a, b, t): return tuple(int(a[i] + (b[i]-a[i])*t) for i in range(3))

def vgrad(c1, c2, bias=0.5):
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / (H-1)
        t = t*t*(3-2*t)
        col = lerp(c1, c2, t)
        for x in range(W):
            px[x, y] = col
    return img

def glow(img, cx, cy, radius, color, alpha=0.5):
    layer = Image.new("RGB", (W, H), (0,0,0))
    d = ImageDraw.Draw(layer)
    steps = 24
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(alpha*255 * (1 - i/steps) ** 1.4)
        d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=color)
        # blend via compositing
        mask = Image.new("L", (W, H), 0)
        md = ImageDraw.Draw(mask)
        md.ellipse([cx-r, cy-r, cx+r, cy+r], fill=a)
        img.paste(layer, (0,0), mask)
        layer = Image.new("RGB", (W, H), (0,0,0))
        d = ImageDraw.Draw(layer)
    return img

def soft_noise(img, amount=6):
    px = img.load()
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            n = random.randint(-amount, amount)
            r,g,b = px[x,y]
            px[x,y] = (max(0,min(255,r+n)), max(0,min(255,g+n)), max(0,min(255,b+n)))
    return img

def make(name, top, bottom, glows):
    img = vgrad(top, bottom)
    for (cx, cy, rad, col, al) in glows:
        img = glow(img, cx, cy, rad, col, al)
    img = img.filter(ImageFilter.GaussianBlur(40))
    img = soft_noise(img, 5)
    path = os.path.join(OUT, name, "background.jpg")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "JPEG", quality=88)
    print("wrote", path)

# 1) Aurora Dusk — calm left, teal/purple aurora on the right
make("preset-aurora-dusk",
     (12, 16, 28), (26, 22, 46),
     [(W*0.72, H*0.42, 900, (40, 180, 150), 0.42),
      (W*0.82, H*0.70, 700, (90, 120, 220), 0.34),
      (W*0.55, H*0.20, 600, (70, 200, 200), 0.22)])

# 2) Midnight Bloom — dark navy, rose/magenta bloom bias right
make("preset-midnight-bloom",
     (10, 12, 24), (22, 14, 34),
     [(W*0.78, H*0.55, 820, (210, 70, 150), 0.40),
      (W*0.88, H*0.30, 620, (140, 60, 200), 0.32),
      (W*0.60, H*0.78, 520, (230, 110, 170), 0.20)])

# 3) Ember Zen — warm dark, amber/ember glow
make("preset-ember-zen",
     (18, 14, 12), (34, 22, 16),
     [(W*0.76, H*0.50, 860, (220, 130, 50), 0.38),
      (W*0.86, H*0.74, 600, (200, 90, 40), 0.30),
      (W*0.58, H*0.24, 520, (240, 180, 90), 0.18)])
print("done")
