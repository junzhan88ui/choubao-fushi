# -*- coding: utf-8 -*-
"""生成首页头卡的手写体子集 → pages/index/font.wxss

背景（用户 2026-10-16 拍板）
---------------------------------------------------------------
参考图里「臭宝的 / 第 N 个月」两行大标题是手写体。但小程序里字体只有三条路：
  ① 系统自带（安卓基本没有手写体）
  ② base64 内嵌进 wxss   ← 本脚本
  ③ 网络字体（wx.loadFontFace / @font-face 指向 https，要配合法域名）
WXSS 的 @font-face **不接受包内 ttf 的相对路径**（官方文档与实测一致），
而本项目「不联网」是红线 —— 所以只能走 ②，把子集 base64 内嵌。

字体：站酷快乐体 ZCOOL KuaiLe（SIL Open Font License 1.1，取自 google/fonts）
  OFL 允许「bundle / embed / redistribute with any software」，条件是随附
  版权声明与许可全文 —— 本脚本把 OFL.txt 落到 scripts/fonts/，并在生成的
  font.wxss 头部写上版权行。
  家族名取 ChoubaoHand，**故意不用原字体名**：OFL 第 3 条禁止改写版使用保留
  字体名，子集就是改写版。

字集（决定包体积 —— 改这里之前先看 README 的体积表）
---------------------------------------------------------------
  ① 标题字  第/个/月/的 + 一…十/零 + 0-9            ~20 字   几 KB
  ② 拉丁+★  备用（将来英文小标若也换手写体）          ~30 字   <1 KB
  ③ 名字字  GB2312 一级字表 3755 字                  ← 大头
            宝宝名是用户随手填的任意字，想让名字那行也是手写体，
            就必须把常用汉字都带上（+436KB woff2 / +598KB base64）。
            `--lean` 去掉这一层，整份字体只剩 ~3.6KB，代价是名字那行
            会逐字回退到系统字体（两行字体不一致）。

用法
---------------------------------------------------------------
  python scripts/gen-hand-font.py            # 默认：标题 + 名字常用字
  python scripts/gen-hand-font.py --lean     # 精简：只覆盖标题字
生成结果直接覆盖 pages/index/font.wxss，**不要手改那个文件**。
"""
import base64
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'scripts', '.cache')
FONTS = os.path.join(ROOT, 'scripts', 'fonts')
OUT = os.path.join(ROOT, 'pages', 'index', 'font.wxss')

TTF = os.path.join(CACHE, 'ZCOOLKuaiLe-Regular.ttf')
OFL_PATH = os.path.join(FONTS, 'ZCOOLKuaiLe-OFL.txt')

MIRRORS = [
    'https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf',
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf',
    'https://ghproxy.net/https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf',
]
OFL_URLS = [u.replace('ZCOOLKuaiLe-Regular.ttf', 'OFL.txt') for u in MIRRORS]

FAMILY = 'ChoubaoHand'

# ① 标题字：两行大标题会出现的每一个字 —— 「{{name}}的」+「第{{monthNo}}个月」
TITLE = '第个月的零一二三四五六七八九十0123456789'
# ② 拉丁与 ★：备用（英文小标 my fifth month ★ 现在是品牌绿、走系统字；
#    留着这几个字形，将来想换手写体不必重跑整条流水线）
LATIN = 'abcdefghijklmnopqrstuvwxyz★'


def gb2312_level1():
    """GB2312 一级字表（3755 个最常用汉字，按拼音序）—— 覆盖绝大多数人名。"""
    out = []
    for b1 in range(0xB0, 0xD8):        # 0xB0–0xD7 = 一级汉字区
        for b2 in range(0xA1, 0xFF):
            try:
                out.append(bytes([b1, b2]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    return ''.join(out)


def fetch(urls, path, label):
    if os.path.exists(path) and os.path.getsize(path) > 1024:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    last = None
    for u in urls:
        try:
            req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=300) as r:
                data = r.read()
            if len(data) < 1024:
                raise IOError('返回内容过小')
            with open(path, 'wb') as f:
                f.write(data)
            print('  下载 %s ← %s' % (label, u.split('/')[2]))
            return
        except Exception as e:          # 换下一个镜像
            last = e
    raise SystemExit('无法下载 %s：%s\n请手动放到 %s' % (label, last, path))


def main():
    lean = '--lean' in sys.argv

    fetch(MIRRORS, TTF, '站酷快乐体 ZCOOLKuaiLe-Regular.ttf')
    fetch(OFL_URLS, OFL_PATH, 'OFL.txt')

    from fontTools import subset as fs

    chars = TITLE + LATIN
    if not lean:
        chars += gb2312_level1()
    chars = ''.join(sorted(set(chars)))

    tmp = os.path.join(CACHE, 'hand-subset.woff2')
    opts = fs.Options()
    opts.flavor = 'woff2'
    opts.layout_features = []
    opts.notdef_outline = False
    opts.drop_tables += ['DSIG']
    font = fs.load_font(TTF, opts)
    sub = fs.Subsetter(options=opts)
    sub.populate(text=chars)
    sub.subset(font)
    fs.save_font(font, tmp, opts)

    woff = open(tmp, 'rb').read()
    b64 = base64.b64encode(woff).decode('ascii')
    kb = lambda n: n / 1024.0

    header = """/* 首页头卡手写体 —— 站酷快乐体（ZCOOL KuaiLe）子集，base64 内嵌。
 *
 * 为什么内嵌：小程序 WXSS 的 @font-face 只吃 base64 或网络地址，包内 ttf
 * 的相对路径不生效；「不联网」是红线 → 只能内嵌。
 * 由 scripts/gen-hand-font.py 生成（%s），**不要手改**：改字集请改脚本再跑。
 *
 * 字体：ZCOOL KuaiLe
 * Copyright 2018 The ZCOOL KuaiLe Project Authors
 * (https://github.com/googlefonts/zcool-kuaile)
 * Licensed under the SIL Open Font License, Version 1.1 —— 许可全文见
 * scripts/fonts/ZCOOLKuaiLe-OFL.txt。本文件是子集（改写版），按 OFL 第 3 条
 * 不使用原字体名，家族名取 %s。
 *
 * 字重描述符写 600 是故意的：站酷快乐体只有 1 个字重，而项目字重纪律是
 * 「标题系 600」（§6f），CSS 里也写 600。描述符声明成 600，渲染器认它
 * 就是那一档，不会再做伪加粗（否则圆体笔画会被糊成一团）。
 *
 * choubao-hand-font: family=%s chars=%d woff2=%.1fKB base64=%.1fKB mode=%s
 */
""" % ('精简模式（只覆盖标题字）' if lean else '默认模式（标题字 + GB2312 一级 3755 字）',
       FAMILY, FAMILY, len(chars), kb(len(woff)), kb(len(b64)),
       'lean' if lean else 'full')

    body = """@font-face {
  font-family: '%s';
  font-weight: 600;
  font-style: normal;
  src: url('data:font/woff2;base64,%s') format('woff2');
}
""" % (FAMILY, b64)

    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(header + body)

    print('  字集 %d 字（%s）' % (len(chars), 'lean' if lean else 'full'))
    print('  woff2 %.1f KB → base64 %.1f KB' % (kb(len(woff)), kb(len(b64))))
    print('  写出 %s（%.1f KB）' % (os.path.relpath(OUT, ROOT), kb(os.path.getsize(OUT))))


if __name__ == '__main__':
    main()
