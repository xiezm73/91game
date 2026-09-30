#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把「照片」目录里的人像抠图统一成游戏素材（BigNaiWa 专用）。
与 normalize_assets.py 的区别：
  · 针对人像：白底/灰底自动抠底，白衣服尽量保留（区域生长 + 饱和度闸门）
  · 全身照自动裁成胸像（高宽比 > 1.35 的图，取顶部 头+肩 区域）
  · 暗边改成中性深灰（人像皮肤上不会显脏）
  · 去噪阈值放宽容，避免把人像肢体当噪点丢掉
输出：assets/fruits/NN-<tier>.png
用法：python tools/process_portraits.py
"""
import os
import numpy as np
from PIL import Image, ImageFilter
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("na", os.path.join(HERE, "normalize_assets.py"))
na = importlib.util.module_from_spec(spec)
spec.loader.exec_module(na)

PHOTOS = r"D:\乱七八糟暂停站\照片"
OUT = os.path.join(HERE, "..", "assets", "fruits")
SIZE = 512
FILL = 0.92
TARGET = int(round(SIZE * FILL))

TIERS = ["grape", "cherry", "orange", "lemon", "kiwi",
         "tomato", "peach", "pineapple", "coconut", "halfmelon", "watermelon"]

# 每张图的抠底参数（按实际背景情况调整）
#   white  = 白底，tol 10，sat 闸门 0.10
#   2 号是灰底 + 红色主体，tol 放宽到 25
CFG = {
    1:  dict(tol=10, sat_max=0.10),
    2:  dict(tol=25, sat_max=0.10),
    3:  dict(tol=10, sat_max=0.10),
    4:  dict(tol=10, sat_max=0.10),
    5:  dict(tol=10, sat_max=0.10),
    6:  dict(tol=10, sat_max=0.10),
    7:  dict(tol=10, sat_max=0.10),
    8:  dict(tol=10, sat_max=0.10),
    9:  dict(tol=10, sat_max=0.10),
    10: dict(tol=10, sat_max=0.10),
    11: dict(tol=10, sat_max=0.10),
}

# 需要裁成胸像的图（高宽比 > 1.35 自动裁，这里强制标记全身照）
BUST = {1, 11}


def find_photo(i):
    for f in os.listdir(PHOTOS):
        stem = f[:-4] if f.lower().endswith(".png") else f
        if stem.strip() == str(i):
            return os.path.join(PHOTOS, f)
    raise RuntimeError("缺少第 %d 张照片" % i)


def gentle_subject_mask(alpha):
    """去噪（人像版）：只丢掉极小的碎块（< 0.3% 最大块），保留肢体"""
    m = alpha > 0.5
    lab, areas = na.label(m)
    if len(areas) > 1:
        big = areas[1:].max()
        keep = areas >= max(64, big * 0.003)
        keep[0] = False
        if keep.sum() >= 1:
            m = keep[lab]
    # 填掉主体内部的小孔（< 0.4% 画面）
    bgm = ~m
    lab2, areas2 = na.label(bgm)
    if len(areas2) > 1:
        limit = m.size * 0.004
        hole = (areas2 < limit) & (areas2 > 0)
        hole[0] = False
        border = set(np.unique(np.concatenate([lab2[0, :], lab2[-1, :], lab2[:, 0], lab2[:, -1]])))
        for t in border:
            if t < len(hole):
                hole[t] = False
        m = m | hole[lab2]
    return m


def neutral_rim(canvas, rim_px=7, alpha=0.4, color=(70, 68, 66)):
    """与 normalize 相同，但暗边用中性灰、更淡，人像皮肤不发脏"""
    a = np.asarray(canvas).astype(np.float32)[:, :, 3] / 255.0
    m = a > 0.5
    d = m.copy()
    dirs = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))
    for _ in range(rim_px):
        e = d.copy()
        for dy, dx in dirs:
            e |= na.sh(d, dy, dx)
        d = e
    rim = np.asarray(Image.fromarray((d * 255).astype(np.uint8))
                     .filter(ImageFilter.GaussianBlur(rim_px * 0.6))).astype(np.float32) / 255.0
    rim = np.clip(rim * alpha, 0, 1)
    layer = np.zeros((canvas.size[1], canvas.size[0], 4), np.uint8)
    layer[:, :, 0] = color[0]
    layer[:, :, 1] = color[1]
    layer[:, :, 2] = color[2]
    layer[:, :, 3] = (rim * 255).astype(np.uint8)
    return Image.alpha_composite(Image.fromarray(layer, "RGBA"), canvas)


def process(i):
    path = find_photo(i)
    im = Image.open(path).convert("RGBA")
    arr = np.asarray(im).astype(np.float32)
    rgb = arr[:, :, :3].astype(np.uint8)

    bg = na.region_grow_bg(rgb, **CFG[i])
    fg = ~bg
    m = gentle_subject_mask(fg)

    # 羽化 1~2 px
    a = np.asarray(Image.fromarray((m * 255).astype(np.uint8))
                   .filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255.0
    a[a < 0.06] = 0.0
    if a.max() <= 0:
        raise RuntimeError("第 %d 张抠底失败：整幅图都透明了" % i)

    out = arr.copy()
    out[:, :, 3] = np.clip(a * 255, 0, 255)
    im2 = Image.fromarray(out.astype(np.uint8), "RGBA")

    # 主体 bbox
    solid = np.asarray(im2)[:, :, 3] > 12
    ys, xs = np.nonzero(solid)
    if len(xs) == 0:
        raise RuntimeError("第 %d 张找不到主体" % i)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    ar = bh / bw

    # 全身照 → 裁成胸像（取顶部 头+肩，宽度为基准，高度约 1.15 倍宽）
    mode = "胸像裁切" if (i in BUST or ar > 1.35) else "原构图"
    if i in BUST or ar > 1.35:
        crop_h = int(round(bw * 1.15))
        y1 = min(y0 + crop_h, y1)
        bh = y1 - y0 + 1

    subject = im2.crop((x0, y0, x1 + 1, y1 + 1))
    sw, shh = subject.size
    k = TARGET / max(sw, shh)
    nw, nh = max(1, int(round(sw * k))), max(1, int(round(shh * k)))
    subject = subject.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(subject, ((SIZE - nw) // 2, (SIZE - nh) // 2), subject)
    canvas = neutral_rim(canvas)

    name = "%02d-%s.png" % (i, TIERS[i - 1])
    dst = os.path.join(OUT, name)
    os.makedirs(OUT, exist_ok=True)
    canvas.save(dst, "PNG", optimize=True)

    px = np.asarray(canvas).astype(np.float32)
    s2 = px[:, :, 3] > 200
    mean = px[:, :, :3][s2].mean(axis=0) if s2.any() else np.array([200., 200., 200.])
    hexc = "#%02x%02x%02x" % tuple(int(v) for v in mean)
    print("%-9s %-6s -> %-22s 主体 %3dx%-3d(裁后%dx%d)  %s  实体 %.1f%%"
          % (os.path.basename(path), mode, name, bw, bh, nw, nh, hexc, s2.mean() * 100))
    return hexc


def make_preview():
    """生成 11 张成品图在奶油色棋盘上的预览，方便肉眼检查"""
    board = Image.new("RGB", (SIZE * 6, SIZE * 2), (246, 228, 198))
    for i in range(1, 12):
        p = os.path.join(OUT, "%02d-%s.png" % (i, TIERS[i - 1]))
        im = Image.open(p).convert("RGBA")
        c, r = (i - 1) % 6, (i - 1) // 6
        board.paste(im, (c * SIZE, r * SIZE), im)
    dst = os.path.join(OUT, "_preview_sprites.png")
    board.save(dst)
    print("\n预览图：%s" % dst)


def main():
    print("画布 %dx%d  主体占长边 %.0f%%\n" % (SIZE, SIZE, FILL * 100))
    colors = [process(i) for i in range(1, 12)]
    print("\n各级主体平均色（可写进 game.js FRUITS 的 pc1/pc2 粒子颜色）:")
    for i, c in enumerate(colors):
        print("  tier %2d  %-10s %s" % (i, TIERS[i], c))
    make_preview()


if __name__ == "__main__":
    main()
