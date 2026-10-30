#!/usr/bin/env python3
"""生成扩展图标（无第三方依赖，纯 zlib 写 PNG）。

设计：深墨底圆角方块 + 米白书页 + 赭石书签，
保证 16px 下仍能辨认出「一本书」，而不是模糊色块。
"""
import zlib, struct, os

SS = 4  # 超采样倍数，先画 512 再缩小


def rounded_rect(px, w, h, x0, y0, x1, y1, r, color):
    for y in range(max(0, y0), min(h, y1)):
        for x in range(max(0, x0), min(w, x1)):
            # 判断到圆角圆心的距离
            cx = x + 0.5
            cy = y + 0.5
            dx = 0.0
            dy = 0.0
            if cx < x0 + r:
                dx = x0 + r - cx
            elif cx > x1 - r:
                dx = cx - (x1 - r)
            if cy < y0 + r:
                dy = y0 + r - cy
            elif cy > y1 - r:
                dy = cy - (y1 - r)
            if dx * dx + dy * dy <= r * r:
                px[y][x] = color


def render(size):
    S = size * SS
    px = [[(0, 0, 0, 0) for _ in range(S)] for _ in range(S)]

    pad = int(S * 0.03)
    rounded_rect(px, S, S, pad, pad, S - pad, S - pad, int(S * 0.22),
                 (30, 28, 25, 255))

    # 书：居中的米白竖长方形
    bw = int(S * 0.44)
    bh = int(S * 0.56)
    bx0 = (S - bw) // 2
    by0 = int(S * 0.22)
    rounded_rect(px, S, S, bx0, by0, bx0 + bw, by0 + bh, int(S * 0.035),
                 (247, 242, 231, 255))

    # 书页横线（文字意象）
    line_color = (30, 28, 25, 70)
    lx0 = bx0 + int(bw * 0.16)
    lx1 = bx0 + bw - int(bw * 0.16)
    for i in range(3):
        ly = by0 + int(bh * (0.30 + 0.16 * i))
        th = max(1, int(S * 0.012))
        rounded_rect(px, S, S, lx0, ly, lx1, ly + th, th // 2, line_color)

    # 赭石书签：顶部右侧垂下的小缎带，带下沿缺口
    rw = int(bw * 0.20)
    rh = int(bh * 0.34)
    rx0 = bx0 + bw - int(bw * 0.30)
    rounded_rect(px, S, S, rx0, by0, rx0 + rw, by0 + rh, int(S * 0.012),
                 (180, 103, 74, 255))
    # 缎带缺口
    notch = int(rh * 0.22)
    for y in range(by0 + rh - notch, by0 + rh):
        rel = (y - (by0 + rh - notch)) / max(1, notch)
        half = int(rw * 0.5 * rel)
        cut0 = (rx0 + rw // 2) - half
        for x in range(cut0, cut0 + half * 2):
            if 0 <= x < S:
                px[y][x] = (30, 28, 25, 255)

    # 缩小
    out = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    p = px[y * SS + dy][x * SS + dx]
                    r += p[0] * p[3]
                    g += p[1] * p[3]
                    b += p[2] * p[3]
                    a += p[3]
            if a == 0:
                out[y][x] = (0, 0, 0, 0)
            else:
                out[y][x] = (r // a, g // a, b // a, a // (SS * SS))
    return out


def write_png(path, pixels):
    size = len(pixels)
    raw = b''
    for row in pixels:
        raw += b'\x00' + b''.join(struct.pack('BBBB', *p) for p in row)
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


base = os.path.dirname(os.path.abspath(__file__))
for s in (16, 48, 128):
    write_png(os.path.join(base, 'icon%d.png' % s), render(s))
    print('wrote icon%d.png' % s)
