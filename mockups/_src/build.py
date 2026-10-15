"""Builds the three static mockups: a shared stylized map of downtown Minneapolis
(SVG with class names each direction colors itself) + per-direction pins + page template.
Run: python3 build.py  → writes ../a-plat-book.html, ../b-darkroom.html, ../c-wayfinding.html
"""
import math, random, pathlib

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent
random.seed(7)

W, H = 1000, 760

def river_y(x):
    # approximate centerline of the river path below, used to keep blocks off the water
    pts = [(-400, -400), (180, -200), (300, -40), (430, 120), (560, 250), (700, 330), (880, 410), (1060, 470), (1500, 600)]
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        if x1 <= x <= x2:
            t = (x - x1) / (x2 - x1)
            return y1 + t * (y2 - y1)
    return pts[-1][1]

def blocks():
    out = []
    ang = math.radians(-40)
    cx, cy = 500, 400
    size, gap = 64, 18
    for i in range(-16, 17):
        for j in range(-16, 17):
            # block center in rotated grid space
            gx, gy = i * (size + gap), j * (size + gap)
            x = cx + gx * math.cos(ang) - gy * math.sin(ang)
            y = cy + gx * math.sin(ang) + gy * math.cos(ang)
            if not (-420 < x < W + 420 and -320 < y < H + 320):
                continue
            if abs(y - river_y(x)) < 58:
                continue
            if 120 < x < 280 and 545 < y < 675:      # Loring Park
                continue
            out.append(f'<rect class="blk" x="{gx - size/2:.0f}" y="{gy - size/2:.0f}" width="{size}" height="{size}" rx="2"/>')
            # building footprints inside the block
            for _ in range(random.randint(1, 3)):
                bw, bh = random.randint(16, 34), random.randint(14, 30)
                bx = gx - size/2 + random.randint(4, size - bw - 4)
                by = gy - size/2 + random.randint(4, size - bh - 4)
                kind = random.choice("aaabbc")
                out.append(f'<rect class="bldg bldg-{kind}" x="{bx:.0f}" y="{by:.0f}" width="{bw}" height="{bh}"/>')
    return f'<g transform="rotate(-40 {cx} {cy}) translate({cx} {cy})">' + "".join(out) + "</g>"

BASE = f'''<svg class="mapsvg" viewBox="130 70 760 620" preserveAspectRatio="xMidYMid meet" overflow="visible" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Map of downtown Minneapolis with saved units">
  <rect class="land" x="-600" y="-500" width="{W+1200}" height="{H+1000}"/>
  {blocks()}
  <path class="park" d="M128 560 C160 540 240 542 276 566 C292 600 280 660 238 676 C190 690 140 670 126 630 Z"/>
  <path class="park" d="M610 352 l52 -30 l30 48 l-52 30 Z"/>
  <path class="park" d="M742 452 l70 -40 l34 56 l-70 40 Z"/>
  <path class="park" d="M470 70 c30 -14 70 -6 84 14 c-10 26 -60 34 -88 18 Z"/>
  <path class="river" d="M180 -260 C 250 -150, 280 -90, 300 -40 C 420 110, 540 240, 700 330 S 920 430, 1060 470 S 1300 560, 1500 620"/>
  <path class="river-edge" d="M180 -260 C 250 -150, 280 -90, 300 -40 C 420 110, 540 240, 700 330 S 920 430, 1060 470 S 1300 560, 1500 620"/>
  <path class="hwy" d="M-500 600 C -200 610, -100 630, -20 650 C 160 700, 300 712, 470 690 S 760 640, 1020 650 S 1300 670, 1500 680"/>
  <path class="hwy" d="M900 1200 C 905 1000, 905 860, 905 780 C 890 640, 900 520, 930 430 S 980 160, 990 -20 S 1000 -300, 1010 -500"/>
  <path class="hwy" d="M-400 200 C -200 240, -80 280, -20 300 C 60 330, 110 420, 120 520 S 110 650, 90 780 S 70 1000, 60 1200"/>
  <path class="ave" d="M-150 1040 L 560 165 L 900 -240"/>
  <path class="ave" d="M-400 610 L 640 250 L 1400 -10"/>
  <path class="ave" d="M-100 1130 L 760 330 L 1300 -170"/>
  <text class="lbl lbl-water" transform="translate(470 196) rotate(37)">Mississippi River</text>
  <text class="lbl" x="150" y="248">North Loop</text>
  <text class="lbl" x="372" y="470">Downtown West</text>
  <text class="lbl" x="640" y="452">Downtown East</text>
  <text class="lbl" x="150" y="706">Loring Park</text>
  <text class="lbl" x="700" y="640">Elliot Park</text>
  <text class="lbl" x="700" y="200">Marcy-Holmes</text>
  <text class="lbl lbl-road" transform="translate(240 590) rotate(-51)">Hennepin Ave</text>
  <text class="lbl lbl-road" x="330" y="706">I-94</text>
  <text class="lbl lbl-road" x="912" y="560">I-35W</text>
  <!--PINS-->
</svg>'''

PIN_SCALER = """<script>
/* Real map pins keep a constant screen size; this keeps the mockup honest when the map scales. */
(() => {
  const svg = document.querySelector('.mapsvg'); if (!svg) return;
  const pins = [...svg.querySelectorAll('.pins > g:not(.fan)')].map(g => {
    const m = /translate\\(([-\\d.]+)[ ,]+([-\\d.]+)\\)/.exec(g.getAttribute('transform') || '');
    return m && { g, x: +m[1], y: +m[2] };
  }).filter(Boolean);
  const fit = () => { const ctm = svg.getScreenCTM(); if (!ctm || !ctm.a) return;
    const k = 1 / ctm.a; pins.forEach(p => p.g.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${k})`)); };
  fit(); addEventListener('resize', fit); document.addEventListener('change', () => setTimeout(fit, 0));
})();
</script>
"""

for name in [n for n in ["a-plat-book", "b-darkroom", "c-wayfinding"] if (HERE / f"{n}.html").exists()]:
    tpl = (HERE / f"{name}.html").read_text()
    pins = (HERE / f"{name}.pins.svg").read_text()
    import re
    m = re.search(r"\{\{MAP(?::([^}]+))?\}\}", tpl)
    svg = BASE.replace("<!--PINS-->", pins)
    if m.group(1):
        svg = svg.replace('viewBox="130 70 760 620"', f'viewBox="{m.group(1)}"')
    html = tpl.replace(m.group(0), svg)
    html = html.replace("</body>", PIN_SCALER + "</body>")
    (OUT / f"{name}.html").write_text(html)
    print("wrote", name)
