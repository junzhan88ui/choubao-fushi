#!/usr/bin/env python3
"""Generate data/who-growth.js from the official WHO expanded tables.

WHO Child Growth Standards (2006), LMS by day:
  wfa  - weight-for-age          0-60 months
  lhfa - length/height-for-age   0-60 months
  hcfa - head-circumference-for-age 0-60 months
both sexes. Downsampled to whole months (day = month * 30.4375, linear
interpolation on the daily grid) so the mini-program bundle stays small.

Source files are downloaded from cdn.who.int (cached in scripts/.cache, so
re-runs are offline). Stdlib only - xlsx is a zip of XML, parsed by hand.

Usage:  python3 scripts/gen-who-growth.py
"""
import os
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

BASE = ("https://cdn.who.int/media/docs/default-source/child-growth/"
        "child-growth-standards/indicators")

# indicator -> url path template
SOURCES = {
    "wfa": "weight-for-age/expanded-tables/wfa-{sex}-zscore-expanded-tables.xlsx",
    "lhfa": "length-height-for-age/expandable-tables/lhfa-{sex}-zscore-expanded-tables.xlsx",
    "hcfa": "head-circumference-for-age/expanded-tables/hcfa-{sex}-zscore-expanded-tables.xlsx",
}

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "..", "data", "who-growth.js")
DAYS_PER_MONTH = 30.4375
MONTHS = 60

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def fetch(indicator, sex):
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, "%s_%s.xlsx" % (indicator, sex))
    if not os.path.exists(path):
        url = "%s/%s" % (BASE, SOURCES[indicator].format(sex=sex))
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = resp.read()
        with open(path, "wb") as fh:
            fh.write(body)
        print("  downloaded %s_%s (%d bytes)" % (indicator, sex, len(body)))
    return path


def col_index(ref):
    """'AB12' -> 27 (0-based column letters)."""
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - ord("A") + 1)
        else:
            break
    return n - 1


def read_sheet(path):
    """Return (header, rows) with rows = list of dict {colletter/idx: value}."""
    with zipfile.ZipFile(path) as z:
        # shared strings (header text)
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(NS + "si"):
                shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
        sheet_name = "xl/worksheets/sheet1.xml"
        if sheet_name not in z.namelist():
            sheet_name = [n for n in z.namelist()
                          if n.startswith("xl/worksheets/")][0]
        root = ET.fromstring(z.read(sheet_name))
        out = []
        for row in root.iter(NS + "row"):
            cells = {}
            for c in row.findall(NS + "c"):
                ref = c.get("r", "")
                idx = col_index(ref) if ref else len(cells)
                t = c.get("t")
                v = c.find(NS + "v")
                if t == "s" and v is not None:
                    val = shared[int(v.text)]
                elif t == "inlineStr":
                    is_el = c.find(NS + "is")
                    val = "".join(x.text or "" for x in is_el.iter(NS + "t")) \
                        if is_el is not None else None
                elif v is not None:
                    try:
                        val = float(v.text)
                    except (TypeError, ValueError):
                        val = v.text
                else:
                    val = None
                cells[idx] = val
            if cells:
                out.append(cells)
    return out


def parse(path):
    """-> (xs, L, M, S) lists, xs strictly ascending."""
    rows = read_sheet(path)
    # header = first row where any cell is a string
    header_i = None
    header = {}
    for i, r in enumerate(rows[:10]):
        strs = {k: str(v).strip() for k, v in r.items()
                if isinstance(v, str) and str(v).strip()}
        if len(strs) >= 3:
            header_i = i
            header = strs
            break
    if header_i is None:
        raise RuntimeError("no header row in %s" % path)

    def find_col(*preds):
        for k, name in header.items():
            low = name.lower()
            for p in preds:
                if p(low):
                    return k
        return None

    x_col = find_col(lambda s: s.startswith("day") or s.startswith("age"),
                     lambda s: s in ("x", "months"))
    l_col = find_col(lambda s: s == "l" or s.startswith("l ("))
    m_col = find_col(lambda s: s == "m" or s.startswith("m ("))
    s_col = find_col(lambda s: s == "s" or s.startswith("s ("))
    if None in (x_col, l_col, m_col, s_col):
        raise RuntimeError("columns not found in %s: header=%r"
                           % (path, header))

    xs, L, M, S = [], [], [], []
    for r in rows[header_i + 1:]:
        if x_col not in r or not isinstance(r.get(x_col), float):
            continue
        if not all(isinstance(r.get(c), float) for c in (l_col, m_col, s_col)):
            continue
        xs.append(r[x_col])
        L.append(r[l_col])
        M.append(r[m_col])
        S.append(r[s_col])
    if len(xs) < 100:
        raise RuntimeError("too few data rows in %s (%d)" % (path, len(xs)))
    return xs, L, M, S


def interp(xs, ys, x):
    """Linear interpolation, clamped to range."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    # binary search
    lo, hi = 0, len(xs) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xs[mid] <= x:
            lo = mid
        else:
            hi = mid
    x0, x1 = xs[lo], xs[hi]
    if x1 == x0:
        return ys[lo]
    t = (x - x0) / (x1 - x0)
    return ys[lo] + t * (ys[hi] - ys[lo])


def fmt(v):
    """Compact but exact-enough number (6 decimal places, trailing zeros cut)."""
    s = "%.6f" % v
    s = s.rstrip("0").rstrip(".")
    return s if s not in ("", "-") else "0"


def main():
    print("fetching official WHO expanded tables ...")
    tables = {}
    for ind in SOURCES:
        tables[ind] = {}
        for sex in ("boys", "girls"):
            xs, L, M, S = parse(fetch(ind, sex))
            tables[ind][sex] = (xs, L, M, S)
            print("  %-4s %-5s rows=%d x=[%s..%s]"
                  % (ind, sex, len(xs), xs[0], xs[-1]))

    lines = []
    lines.append("/**")
    lines.append(" * WHO Child Growth Standards (2006) LMS 参数表（v3.0 成长曲线）")
    lines.append(" *")
    lines.append(" * 由 scripts/gen-who-growth.py 从 WHO 官方 CDN 展开表直接生成，")
    lines.append(" * 请勿手改数据（改口径只改脚本再重新生成）。")
    lines.append(" *  - 来源: https://cdn.who.int/media/docs/default-source/child-growth/")
    lines.append(" *         child-growth-standards/indicators/ (zscore expanded tables)")
    lines.append(" *  - 指标: wfa 体重/年龄、lhfa 身长(高)/年龄、hcfa 头围/年龄")
    lines.append(" *  - 粒度: 男/女两套，月龄 0–60 逐月；表内点 = 日龄 m*30.4375 处")
    lines.append(" *    （逐日官方表上线性插值），与 utils/growth.js 的")
    lines.append(" *    ageDays/30.4375 月龄换算同一口径，端点不漂。")
    lines.append(" *")
    lines.append(" * 每个月龄是 [L, M, S] 三元组：z = ((x/M)^L - 1)/(L*S)，L=0 时用 ln。")
    lines.append(" *")
    lines.append(" * 只做记录与展示，不做营养评估。")
    lines.append(" */")
    lines.append("")
    lines.append("module.exports = {")

    meta = []
    for ind, title in (("wfa", "weight-for-age 体重/年龄"),
                       ("lhfa", "length-height-for-age 身长(高)/年龄"),
                       ("hcfa", "head-circumference-for-age 头围/年龄")):
        lines.append("  // ---- %s ----" % title)
        lines.append("  %s: {" % ind)
        for sex, key in (("boys", "male"), ("girls", "female")):
            xs, L, M, S = tables[ind][sex]
            lines.append("    %s: [" % key)
            pts = []
            for m in range(MONTHS + 1):
                day = m * DAYS_PER_MONTH
                l = interp(xs, L, day)
                mm = interp(xs, M, day)
                s = interp(xs, S, day)
                pts.append("[%s,%s,%s]" % (fmt(l), fmt(mm), fmt(s)))
            for i in range(0, len(pts), 6):
                lines.append("      " + ",".join(pts[i:i + 6]) + ",")
            lines.append("    ],")
            meta.append("%s.%s" % (ind, key))
        lines.append("  },")
    lines.append("}")
    lines.append("")

    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    size = os.path.getsize(OUT) // 1024
    print("wrote data/who-growth.js (%d KB, tables: %d)"
          % (size, len(meta)))

    # sanity printouts used as _validate anchors (values straight from WHO):
    checks = [
        ("wfa", "boys", 0, "birth weight median boys"),
        ("wfa", "boys", 183, "~6m weight median boys"),
        ("wfa", "boys", 365, "~12m weight median boys"),
        ("wfa", "girls", 365, "~12m weight median girls"),
        ("lhfa", "boys", 365, "~12m length median boys"),
        ("lhfa", "boys", 0, "birth length median boys"),
        ("hcfa", "boys", 0, "birth head circ median boys"),
        ("hcfa", "girls", 0, "birth head circ median girls"),
        ("wfa", "boys", 1826, "~60m weight median boys"),
    ]
    print("anchors (from downloaded official tables):")
    for ind, sex, day, note in checks:
        xs, L, M, S = tables[ind][sex]
        print("  %-28s day=%-4d M=%s" % (note, day, fmt(interp(xs, M, day))))


if __name__ == "__main__":
    main()
