# Browser test: quiz colours must keep >= 4.5:1 contrast in light and dark mode.
# Renders the demo site (cosmo / darkly pair), gets one question wrong and then
# right, and checks text colour vs. its effective background for the option,
# per-option explanation, feedback and feedback note.
# Run: uv run --with playwright==1.58.0 python tests/dark-mode.test.py
import functools, http.server, pathlib, subprocess, sys, threading
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
subprocess.run(["quarto", "render", "index.qmd"], cwd=root, check=True, capture_output=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory=str(root / "_site"))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_port}/index.html"

# Effective colour: walk up to the first opaque background, composite via canvas
# (canvas normalises any CSS colour, incl. color-mix()).
JS = """(sel) => {
  const box = document.querySelector('.puzzle-box');
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const g = cv.getContext('2d', {willReadFrequently: true});
  const rgba = (c) => { g.clearRect(0,0,1,1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0,0,1,1); return [...g.getImageData(0,0,1,1).data]; };
  const lum = ([r,g,b]) => { const f = (v) => { v/=255; return v<=.03928 ? v/12.92 : ((v+.055)/1.055)**2.4 }; return .2126*f(r)+.7152*f(g)+.0722*f(b); };
  const eff = (el) => { const layers = [];
    for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3]) layers.push(c); if (c[3] === 255) break; }
    let bg = [255,255,255];
    for (const c of layers.reverse()) bg = bg.map((v,i) => Math.round(c[i]*c[3]/255 + v*(1-c[3]/255)));
    return bg; };
  const ratio = (x, y) => { const [a,b] = [lum(x), lum(y)].sort((p,q)=>q-p); return (a+.05)/(b+.05); };
  const page = eff(document.body);
  const out = [];
  for (const el of box.querySelectorAll(sel)) {
    if (!el.offsetParent || !el.textContent.trim()) continue;
    const bg = eff(el);
    const cs = getComputedStyle(el);
    const fg = rgba(cs.color).slice(0,3);
    const state = el.matches('.correct, .wrong');
    out.push({sel, text: el.textContent.trim().slice(0,30), ratio: ratio(fg, bg), pageratio: state ? ratio(bg, page) : 1, disabled: el.disabled || cs.pointerEvents === 'none'});
  }
  return out;
}"""
SELS = [".quiz-option", ".quiz-option-explanation", ".quiz-option-note", ".quiz-feedback", ".quiz-feedback-note", ".quiz-progress", ".quiz-submit"]

fails = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ("light", "dark"):
        page = b.new_context(color_scheme=mode, viewport={"width": 900, "height": 1000}).new_page()
        page.goto(url)
        cls = page.evaluate("document.body.className")
        assert f"quarto-{mode}" in cls, (mode, cls)
        box = page.locator(".puzzle-box").first
        box.get_by_text("3", exact=True).first.click()        # wrong
        box.locator(".quiz-submit").first.click()
        page.wait_for_timeout(300)
        res = []
        def grab(tag):
            for s in SELS:
                for r in page.evaluate(f"({JS})", s):
                    r["state"] = tag; r["mode"] = mode; res.append(r)
        grab("wrong")
        page.wait_for_timeout(5500)                            # lockout
        box.get_by_text("4", exact=True).first.click()         # right
        box.locator(".quiz-submit").first.click()
        page.wait_for_timeout(500)
        grab("right")
        page.screenshot(path=f"/private/tmp/claude-501/quizkit-{mode}.png", clip=page.locator(".scenario-block").first.bounding_box())
        for r in res:
            # disabled controls are exempt from WCAG contrast
            # answer-state fills must blend into the page (a light pastel on a dark page is out)
            ok = (r["ratio"] >= 4.5 or r["disabled"]) and r["pageratio"] <= 3
            print(f"{mode:5} {r['state']:5} {r['sel']:26} {r['ratio']:5.2f} fill/page {r['pageratio']:4.2f} {'ok' if ok else 'FAIL'}  {r['text']!r}")
            if not ok: fails.append(r)
    b.close()
sys.exit(f"{len(fails)} contrast failures" if fails else 0)
