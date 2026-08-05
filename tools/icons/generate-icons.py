#!/usr/bin/env python3
"""
Genera les icones de la PWA des del gradient de marca de Plou.

Es guarda perquè les icones siguin reproduïbles i no un binari caigut del cel. No hi ha
dependències: escriu el PNG a mà. Per regenerar-les:

    python3 tools/icons/generate-icons.py
"""

import struct
import zlib

# --gradient-brand de packages/design-system/plou/tokens/colors.css, a 135 graus.
STOPS = [(0.00, (0x6E, 0xA8, 0xFF)), (0.55, (0xFF, 0x9D, 0x4D)), (1.00, (0xFF, 0x6F, 0xA0))]
OUT = 'apps/web/public/icons'


def color_at(t):
    for i in range(len(STOPS) - 1):
        a, ca = STOPS[i]
        b, cb = STOPS[i + 1]
        if a <= t <= b:
            k = 0 if b == a else (t - a) / (b - a)
            return tuple(round(ca[j] + (cb[j] - ca[j]) * k) for j in range(3))
    return STOPS[-1][1]


def png(size, path):
    rows = []
    r = size / 2 - 0.5
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            t = ((x / (size - 1)) + (y / (size - 1))) / 2
            cr, cg, cb = color_at(t)
            d = ((x - r) ** 2 + (y - r) ** 2) ** 0.5
            alpha = 255 if d <= r * 0.98 else (0 if d > r else round(255 * (r - d) / (r * 0.02)))
            row += bytes((cr, cg, cb, alpha))
        rows.append(bytes(row))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))

    open(path, 'wb').write(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
        + chunk(b'IEND', b'')
    )


if __name__ == '__main__':
    for size in (192, 512):
        png(size, f'{OUT}/icon-{size}.png')
        print(f'{OUT}/icon-{size}.png')
