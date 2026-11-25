# -*- coding: utf-8 -*-
"""
把「全字庫正楷體」（TW-Kai.ttf，Unicode BMP 部分）切成許多小的 woff2 檔，
並產生對應的 @font-face（含 unicode-range）CSS，讓瀏覽器只下載名單裡實際用到的字所在的那幾片。

用法（需要 Python 3 與 `pip install fonttools brotli`）：
    python tools/build_twkai_slices.py --src <放 TW-Kai.ttf 的資料夾> --out fonts/twkai

字型來源：數位發展部「CNS11643中文標準交換碼全字庫」開放資料
    https://data.gov.tw/dataset/5961（Fonts_Kai.zip）
授權：政府資料開放授權條款-第1版（https://data.gov.tw/license）。
    切片屬於授權範圍內的「衍生物」，因此網站與本專案都必須保留顯名聲明，見 NOTICE.md。

切片規則（常用字先、罕用字後，這樣一般姓名只會載入少數幾片）：
    base : 英數字、常用標點與全形符號（一片）
    常用 : Big5 的漢字（約 13,000 字，Big5 編碼本身就依使用頻率排序），每片 150 字
    罕用 : 其餘 BMP 漢字（如「堃」「喆」「峯」），依碼位排序，每片 300 字
不含 Unicode 第 2 字面（Ext-B）以上的字；這些字會退回使用者裝置上的備用楷體。
"""
import argparse
import os
import sys
from multiprocessing import Pool

from fontTools import subset
from fontTools.ttLib import TTFont

FAMILY = "TW-Kai-Web"
COMMON_SLICE = 150
RARE_SLICE = 300


def is_cjk(c):
    return 0x4E00 <= c <= 0x9FFF or 0x3400 <= c <= 0x4DBF or 0xF900 <= c <= 0xFAFF


def big5_hanzi_in_order(cmap):
    out, seen = [], set()
    for hi in range(0xA4, 0xF9 + 1):
        for lo in list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)):
            try:
                ch = bytes([hi, lo]).decode("big5")
            except Exception:
                continue
            if len(ch) == 1:
                cp = ord(ch)
                if is_cjk(cp) and cp in cmap and cp not in seen:
                    seen.add(cp)
                    out.append(cp)
    return out


def ranges_css(cps):
    cps = sorted(cps)
    parts, i = [], 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        parts.append("U+%X" % cps[i] if i == j else "U+%X-%X" % (cps[i], cps[j]))
        i = j + 1
    return ",".join(parts)


def make_slice(job):
    src, out_path, cps = job
    opts = subset.Options()
    opts.layout_features = []          # 不需要 OpenType 排版功能
    opts.hinting = False
    opts.glyph_names = False
    opts.notdef_outline = True
    opts.name_IDs = ["*"]              # 保留 name 表（含版權與授權字串）
    opts.drop_tables += ["DSIG", "GSUB", "GPOS", "GDEF", "BASE", "JSTF", "kern", "vhea", "vmtx", "VORG"]
    opts.flavor = "woff2"
    font = TTFont(src)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=cps)
    sub.subset(font)
    font.flavor = "woff2"
    font.save(out_path)
    return out_path, os.path.getsize(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="放 TW-Kai.ttf 的資料夾")
    ap.add_argument("--out", required=True, help="輸出資料夾（例如 fonts/twkai）")
    ap.add_argument("--version", default="20261028", help="資料集版本，只用在 CSS 註解")
    args = ap.parse_args()

    ttf = os.path.join(args.src, "TW-Kai.ttf")
    cmap = TTFont(ttf, lazy=True).getBestCmap()
    os.makedirs(args.out, exist_ok=True)
    for f in os.listdir(args.out):
        if f.endswith(".woff2") or f == "twkai.css":
            os.remove(os.path.join(args.out, f))

    base = [c for c in cmap if (0x20 <= c <= 0x7E) or (0xA0 <= c <= 0xFF) or (0x2000 <= c <= 0x206F)
            or (0x3000 <= c <= 0x303F) or (0xFF00 <= c <= 0xFFEF)]
    common = big5_hanzi_in_order(cmap)
    common_set = set(common)
    rare = sorted(c for c in cmap if is_cjk(c) and c not in common_set)

    slices = [("base", base)]
    for i in range(0, len(common), COMMON_SLICE):
        slices.append(("c", common[i:i + COMMON_SLICE]))
    for i in range(0, len(rare), RARE_SLICE):
        slices.append(("r", rare[i:i + RARE_SLICE]))

    jobs, meta = [], []
    for n, (kind, cps) in enumerate(slices):
        name = "%s%03d.woff2" % (kind, n)
        jobs.append((ttf, os.path.join(args.out, name), cps))
        meta.append((name, cps))

    total = 0
    with Pool(min(4, os.cpu_count() or 2)) as pool:
        for k, (path, size) in enumerate(pool.imap(make_slice, jobs), 1):
            total += size
            if k % 20 == 0 or k == len(jobs):
                print("  %d/%d slices, %.1f MB so far" % (k, len(jobs), total / 1048576.0), flush=True)

    css = ['/* 全字庫正楷體（網頁切片版）。數位發展部 2026 CNS11643中文標準交換碼全字庫 版本 %s。' % args.version,
           '   此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出：https://data.gov.tw/license',
           '   本檔由 tools/build_twkai_slices.py 自動產生，請勿手動修改。 */']
    for name, cps in meta:
        css.append('@font-face{font-family:"%s";font-style:normal;font-weight:400;font-display:swap;'
                   'src:url(%s) format("woff2");unicode-range:%s}' % (FAMILY, name, ranges_css(cps)))
    with open(os.path.join(args.out, "twkai.css"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(css) + "\n")

    print("完成：%d 片，woff2 合計 %.2f MB，CSS %d KB" % (
        len(meta), total / 1048576.0, os.path.getsize(os.path.join(args.out, "twkai.css")) // 1024))
    print("常用 %d 字、罕用 %d 字、基礎 %d 字" % (len(common), len(rare), len(base)))


if __name__ == "__main__":
    sys.exit(main())
