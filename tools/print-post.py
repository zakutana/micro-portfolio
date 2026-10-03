#!/usr/bin/env python3
"""Post-processing of the print PDF (called by make-print.mjs).

  print-post.py probe  <probe-cmyk.pdf>                       print what pure #000 became after the CMYK conversion
  print-post.py finish <in.pdf> <out.pdf> <w_pt> <h_pt> <bleed_pt> <rich-black> [slug_pt]
                                                               exact page boxes, K-only black, gray -> K
  print-post.py check  <final.pdf> <tmp-dir>                   colour check + scan of the QR codes (links.json)
"""
import json
import re
import subprocess
import sys

import pikepdf


def contents(pg):
    cs = pg.Contents if isinstance(pg.Contents, pikepdf.Array) else [pg.Contents]
    return b"".join(c.read_bytes() for c in cs)


def probe(path):
    pdf = pikepdf.open(path)
    m = re.search(rb"([\d.]+ [\d.]+ [\d.]+ [\d.]+) k\n", contents(pdf.pages[0]))
    print(m.group(1).decode() if m else "")


def finish(src, dst, w, h, bleed, rich, slug=0.0):
    pdf = pikepdf.open(src)
    rich = rich.encode()

    def fix(data):
        # white/gray -> K only; the converted #000 -> 0 0 0 1
        data = re.sub(rb"([0-9.]+) g\n", lambda m: b"0 0 0 %g k\n" % (1 - float(m.group(1))), data)
        data = re.sub(rb"([0-9.]+) G\n", lambda m: b"0 0 0 %g K\n" % (1 - float(m.group(1))), data)
        if rich:
            data = data.replace(rich + b" k\n", b"0 0 0 1 k\n").replace(rich + b" K\n", b"0 0 0 1 K\n")
        return data

    seen = set()

    def fix_stream(obj):
        if obj.objgen in seen:
            return
        seen.add(obj.objgen)
        obj.write(fix(obj.read_bytes()))
        for x in (obj.get("/Resources", {}).get("/XObject", {}) or {}).values():
            if x.get("/Subtype") == "/Form":
                fix_stream(x)

    for pg in pdf.pages:
        cs = pg.Contents if isinstance(pg.Contents, pikepdf.Array) else [pg.Contents]
        for c in cs:
            fix_stream(c)
        for x in (pg.Resources.get("/XObject", {}) or {}).values():
            if x.get("/Subtype") == "/Form":
                fix_stream(x)
        top = float(pg.MediaBox[3])  # the artwork starts at the top-left corner of the sheet
        box = [0, top - h, w, top]
        pg.MediaBox = pikepdf.Array(box)
        pg.CropBox = pikepdf.Array(box)
        pg.BleedBox = pikepdf.Array([slug, top - h + slug, w - slug, top - slug])
        t = slug + bleed
        pg.TrimBox = pikepdf.Array([t, top - h + t, w - t, top - t])
    pdf.docinfo["/Title"] = "Micro portfolio - tiskove karty (CMYK, 4 strany)"
    pdf.save(dst, min_version="1.6", compress_streams=True)


def check(final, tmp):
    import cv2

    links = json.load(open(tmp + "/links.json"))
    pdf = pikepdf.open(final)
    rgb_ops = sum(len(re.findall(rb"(?:^|\s)(?:rg|RG)(?:\s|$)", contents(pg))) for pg in pdf.pages)
    spaces = set()

    def walk(o, seen):
        if isinstance(o, (pikepdf.Dictionary, pikepdf.Stream)):
            if o.objgen != (0, 0):
                if o.objgen in seen:
                    return
                seen.add(o.objgen)
            for _, v in o.items():
                if isinstance(v, pikepdf.Name) and str(v) in ("/DeviceRGB", "/CalRGB", "/DeviceGray"):
                    spaces.add(str(v))
                walk(v, seen)
        elif isinstance(o, pikepdf.Array):
            for v in o:
                if isinstance(v, pikepdf.Name) and str(v) in ("/DeviceRGB", "/CalRGB", "/DeviceGray"):
                    spaces.add(str(v))
                walk(v, seen)

    seen = set()
    for pg in pdf.pages:
        walk(pg.obj, seen)
    gray = sum(len(re.findall(rb"\s[gG]\n", contents(pg))) for pg in pdf.pages)
    print(f"RGB operators: {rgb_ops} | RGB/gray colour spaces in the file: {sorted(spaces) or 'none'} | gray operators: {gray}")
    blacks = [b"0 0 0 1 k" in contents(pdf.pages[i]) for i in range(1, len(pdf.pages), 2)]
    print("Back sides use pure K=100 black (QR):", all(blacks))

    det = cv2.QRCodeDetector()
    ok = True
    for k, url in enumerate(links):
        png = f"{tmp}/scan-{k}.png"
        subprocess.run(["pdftoppm", "-r", "600", "-f", str(2 * k + 2), "-l", str(2 * k + 2), "-png", "-singlefile", final, png[:-4]], check=True, stderr=subprocess.DEVNULL)
        img = cv2.imread(png)
        text, _, _ = det.detectAndDecode(img)
        small = cv2.GaussianBlur(cv2.resize(img, None, fx=0.25, fy=0.25), (3, 3), 0)  # like a phone camera, further away
        text2, _, _ = det.detectAndDecode(small)
        print(f"QR card {k + 1}: 600 dpi {'OK' if text == url else 'FAIL'} | 150 dpi blurred {'OK' if text2 == url else 'FAIL'} -> {text}")
        ok = ok and text == url and text2 == url
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    cmd, *a = sys.argv[1:]
    {"probe": probe, "finish": lambda s, d, w, h, b, r, sl="0": finish(s, d, float(w), float(h), float(b), r, float(sl)), "check": check}[cmd](*a)
