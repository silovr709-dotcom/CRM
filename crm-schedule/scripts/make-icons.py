#!/usr/bin/env python3
"""Рисует иконки приложения без внешних зависимостей.

Знак — три белые полосы на индиго-градиенте: узнаётся и в 48 px на телефоне.
Запуск: python3 scripts/make-icons.py
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'
SS = 3  # супервыборка для сглаживания

TOP = (79, 70, 229)     # #4f46e5
BOTTOM = (49, 46, 129)  # #312e81
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_rect(x, y, w, h, r):
    return (x, y, x + w, y + h, r)


def inside_round_rect(px, py, rect):
    x0, y0, x1, y1, r = rect
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def render(size, padding_ratio=0.0):
    """Возвращает RGBA-байты size×size."""
    scale = size * SS
    canvas = [[(0, 0, 0, 0)] * scale for _ in range(scale)]

    pad = scale * padding_ratio
    bg = rounded_rect(pad, pad, scale - 2 * pad, scale - 2 * pad, (scale - 2 * pad) * 0.23)

    bar_x = pad + (scale - 2 * pad) * 0.22
    bar_h = (scale - 2 * pad) * 0.085
    radius = bar_h / 2
    widths = [0.56, 0.40, 0.28]
    ys = [0.31, 0.465, 0.62]
    bars = [
        rounded_rect(bar_x, pad + (scale - 2 * pad) * y, (scale - 2 * pad) * w, bar_h, radius)
        for y, w in zip(ys, widths)
    ]
    for py in range(scale):
        row = canvas[py]
        for px in range(scale):
            if not inside_round_rect(px, py, bg):
                continue
            t = (py - pad) / max(1.0, scale - 2 * pad)
            color = lerp(TOP, BOTTOM, max(0.0, min(1.0, t)))
            alpha = 255
            for index, bar in enumerate(bars):
                if inside_round_rect(px, py, bar):
                    opacity = (1.0, 0.86, 0.68)[index]
                    color = lerp(color, WHITE, opacity)
                    break
            row[px] = (*color, alpha)

    # Уменьшение с усреднением: ровные края без сглаживания по альфе.
    result = bytearray()
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    pr, pg, pb, pa = canvas[y * SS + dy][x * SS + dx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            if a == 0:
                result += bytes((0, 0, 0, 0))
            else:
                result += bytes((r // a, g // a, b // a, a // (SS * SS)))
    return bytes(result)


def write_png(path, size, rgba):
    raw = b''.join(
        b'\x00' + rgba[y * size * 4:(y + 1) * size * 4] for y in range(size)
    )
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    targets = [
        ('icon-192.png', 192, 0.0),
        ('icon-512.png', 512, 0.0),
        ('icon-512-maskable.png', 512, 0.10),
        ('apple-touch-icon.png', 180, 0.0),
        ('favicon-32.png', 32, 0.0),
    ]
    for name, size, padding in targets:
        write_png(OUT / name, size, render(size, padding))
        print('готово:', name, size)


if __name__ == '__main__':
    main()
