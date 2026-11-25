"""Run with python tests/e2e.py (requires Playwright and Chrome on Windows)."""
import argparse
import json
import math
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "e2e"


def verify(browser):
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, color_scheme="light")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_default_timeout(5000)
    page.goto((ROOT / "index.html").as_uri())
    el = page.locator
    prices = el('[data-key="price"]')
    weights = el('[data-key="allocation"]')
    results = []

    def metric(selector, expected):
        raw = el(selector).get_attribute("data-value")
        assert raw is not None and math.isclose(float(raw), expected, rel_tol=1e-12, abs_tol=1e-9), (selector, raw, expected)
        return float(raw)

    def scenario(name, direction, single, average, profit, difference):
        assert direction in el("#direction").inner_text()
        metrics = {key: metric("#" + key, expected) for key, expected in [
            ("single-profit", single), ("avg-b", average), ("profit-b", profit), ("difference", difference)
        ]}
        metric("#improvement", difference / single * 100)
        notional = float(el("#notional").get_attribute("data-value"))
        metric("#points", difference / notional * 100)
        results.append({"scenario": name, "observed": metrics})

    def allocations():
        return [float(field.input_value()) for field in weights.all()]

    def blocked():
        for selector in ["#avg-b", "#profit-b", "#difference", "#improvement", "#points"]:
            assert el(selector).inner_text() == "—", selector
        assert el("#compare-note").is_visible()
        assert el("#chart-b").evaluate("bar => bar.offsetWidth") == 0

    def quick(preset):
        el(f'.tools [data-preset="{preset}"]').click()

    blue, green, red = "rgb(138, 180, 255)", "rgb(105, 214, 160)", "rgb(255, 133, 141)"

    def text_color(selector):
        return el(selector).evaluate("element => getComputedStyle(element).color")

    assert page.title() == "TP Calculator" and el("html").get_attribute("lang") == "en"
    assert el("h1").inner_text() == "TP Calculator"
    page.evaluate("document.fonts.ready")
    assert page.evaluate("Array.from(document.fonts).some(f => f.family === 'Geist' && f.status === 'loaded')")
    for preference in ["dark", "light"]:
        page.emulate_media(color_scheme=preference)
        assert el("html").evaluate("el => getComputedStyle(el).backgroundColor") == "rgb(23, 23, 23)"
        assert el("#add").evaluate("el => getComputedStyle(el).backgroundColor") == blue
        assert el("#entry").evaluate("el => getComputedStyle(el).fontFamily.split(',')[0]") == "Geist"
    results.append({"scenario": "Local Geist font and Carbon palette under both system color preferences"})
    assert el(".intro img").evaluate("img => img.complete && img.naturalWidth > 0")
    assert el('link[rel="icon"]').get_attribute("href") == el(".intro img").get_attribute("src")
    assert el("input:not([type=range])").evaluate_all("fields => fields.every(f => f.value === '')")
    assert el(".tools [aria-pressed=true]").count() == 0
    assert not el(".error:visible").count() and not el("#results").is_visible()
    assert not el("[data-asset]").count() and not el("select").count()
    assert page.get_by_role("heading", name="Compare allocation presets").is_visible()
    assert el("#preset-rows tr:visible").count() == 7
    assert el("#preset-rows tr:first-child th").inner_text() == "Current split"
    assert el("#preset-rows .current td").first.inner_text() == "— / — / —"
    page.screenshot(path=ARTIFACTS / "initial.png", full_page=True)
    results.append({"scenario": "Blank first visit, English interface, matching page logo and favicon"})

    splits = {"equal": [33.34, 33.33, 33.33], "front": [50, 30, 20], "back": [20, 30, 50],
              "conservative": [70, 20, 10], "aggressive": [10, 20, 70], "balanced": [25, 50, 25]}
    for key, expected in splits.items():
        quick(key)
        assert allocations() == expected
        selected = el('.tools [aria-pressed=true]')
        assert selected.get_attribute("data-preset") == key
        assert selected.evaluate("el => getComputedStyle(el).borderTopColor") == blue
        assert selected.evaluate("el => getComputedStyle(el).backgroundColor") != el('.tools [aria-pressed=false]').first.evaluate("el => getComputedStyle(el).backgroundColor")
        caption = el(f'.tools [data-preset="{key}"] .preset-ratio').inner_text()
        assert [float(n) for n in caption.split(" / ")] == expected
    results.append({"scenario": "All six three-level presets match the reference before entering prices"})
    quick("conservative")
    el("#entry").fill("100")
    el("#size").fill("2")
    el("#single").fill("130")
    for i, price in enumerate(["130", "110", "120"]):
        prices.nth(i).fill(price)
    assert allocations() == [10, 70, 20]
    metric("#avg-b", 114)
    for selector in ["#single-profit", ".level:first-child .profit", "#profit-a", "#profit-b", "#rate-a", "#rate-b", ".current td:nth-child(4)"]:
        assert text_color(selector) == green, selector
    for selector in ["#difference", "#improvement", "#points", ".current td:nth-child(5)", ".current td:nth-child(6)"]:
        assert text_color(selector) == red, selector
    results.append({"scenario": "Profit and return stay green while negative differences turn red"})
    assert el("#chart-a").evaluate("bar => bar.offsetWidth") > el("#chart-b").evaluate("bar => bar.offsetWidth") > 0
    page.reload()
    metric("#avg-b", 114)
    assert el("#preset-rows tr:first-child th").inner_text() == "Current split"
    assert el('.tools [data-preset="conservative"]').get_attribute("aria-pressed") == "true"
    results.append({"scenario": "Preset chosen first follows execution order and survives reload"})

    el("#entry").fill("70095.53")
    el("#size").fill("1.05")
    el("#single").fill("52000")
    el("#add").click()
    for i, price in enumerate(["54000", "52000", "50000", "48000"]):
        prices.nth(i).fill(price)
    quick("equal")
    scenario("Four-target short, equal weight", "Short", 19000.3065, 51000, 20050.3065, 1050)
    assert el("#difference").inner_text() == "+1,050.00"
    assert el("#difference").evaluate("el => el.classList.contains('positive')")
    metric("#notional", 73600.3065)
    metric(".level:first-child .qty", .2625)
    metric(".level:first-child .profit", 4225.076625)
    page.screenshot(path=ARTIFACTS / "desktop.png", full_page=True)

    quick("front")
    assert allocations() == [40, 30, 20, 10]
    scenario("Four-target short, front-loaded", "Short", 19000.3065, 52000, 19000.3065, 0)
    assert text_color("#difference") not in [green, red]
    prices.nth(0).fill("48000")
    prices.nth(3).fill("54000")
    quick("front")
    assert allocations() == [10, 30, 20, 40], (allocations(), prices.evaluate_all("items => items.map(el => el.value)"))
    metric("#difference", 0)
    results.append({"scenario": "Unsorted short targets follow execution order"})

    el(".remove").last.click()
    el("#entry").fill("4043.22")
    el("#size").fill("24")
    el("#single").fill("3400")
    for i, price in enumerate(["3400", "3300", "3200"]):
        prices.nth(i).fill(price)
    quick("front")
    scenario("Three-target short, front-loaded", "Short", 15437.28, 3330, 17117.28, 1680)
    el('#preset-rows [data-preset="equal"] button').click()
    assert allocations() == [33.34, 33.33, 33.33]
    el("#size").fill("12.3456789")
    page.reload()
    assert el("#size").input_value() == "12.3456789"
    assert allocations() == [33.34, 33.33, 33.33]
    results.append({"scenario": "User inputs persist in a single instrument-independent calculation"})
    el("#entry").fill("60000")
    el("#size").fill("1")
    el("#single").fill("70000")
    for i, (price, weight) in enumerate(zip([65000, 70000, 75000], [20, 30, 50])):
        prices.nth(i).fill(str(price))
        weights.nth(i).fill(str(weight))
    scenario("Long trade", "Long", 10000, 71500, 11500, 1500)
    el("#add").click()
    assert prices.last.input_value() == "" and weights.last.input_value() == ""
    assert [float(w.input_value()) for w in weights.all()[:-1]] == [20, 30, 50]
    metric("#difference", 1500)
    weights.last.fill("0")
    prices.last.fill("59000")
    metric("#difference", 1500)
    weights.last.fill("10")
    assert "10.00%" in el("#allocation-note").inner_text()
    assert prices.last.get_attribute("aria-invalid") == "true"
    blocked()
    weights.nth(0).fill("10")
    metric("#allocation", 100)
    blocked()
    prices.last.fill("")
    blocked()
    el("#single").fill("60000")
    assert el("#single-error").is_visible()
    assert el("#single-profit").inner_text() == "—"
    el("#single").fill("70000")
    results.append({"scenario": "Add, remove, zero-weight rows, excess and wrong-side or empty targets"})

    el(".remove").last.click()
    el("#normalize").click()
    assert allocations() == [11.11, 33.33, 55.56]
    metric("#allocation", 100)
    prices.nth(0).fill("75000")
    prices.nth(2).fill("65000")
    quick("front")
    assert allocations() == [20, 30, 50]
    assert el("#difference").evaluate("el => el.classList.contains('negative')")
    el('#preset-rows [data-preset="back"] td').first.click()
    assert allocations() == [50, 30, 20]
    el('input[type="range"]').first.focus()
    el('input[type="range"]').first.press("ArrowRight")
    assert allocations() == [50.01, 30, 20]
    assert not el(".tools [aria-pressed=true]").count()
    weights.nth(0).fill("13.333")
    assert weights.nth(0).get_attribute("aria-invalid") == "true"
    assert el("#normalize").is_disabled()
    blocked()
    for invalid in ["-1", "101", ""]:
        weights.nth(0).fill(invalid)
        blocked()
    for i in range(3):
        weights.nth(i).fill("0")
    el("#normalize").click()
    assert allocations() == [33.34, 33.33, 33.33]
    results.append({"scenario": "Normalization, zero-total weights, preset table, long execution order and slider precision"})

    for count in [4, 5, 6, 7, 8, 9, 10, 11]:
        el("#add").click()
        prices.last.fill(str(75000 + count * 1000))
        for preset in splits:
            quick(preset)
            assert sum(round(v * 100) for v in allocations()) == 10000
            metric("#allocation", 100)
    while prices.count() > 1:
        el(".remove").last.click()
    assert el(".remove").is_disabled()
    quick("equal")
    assert allocations() == [100]
    for selector in ["#entry", "#size", "#single", '[data-key="price"]']:
        field = el(selector)
        field.focus()
        original = field.input_value()
        for invalid in ["", "0", "-2", "abc"]:
            field.fill(invalid)
            blocked()
            if invalid or selector == '[data-key="price"]':
                assert field.get_attribute("aria-invalid") == "true"
            assert all(s not in el("body").inner_text() for s in ["Infinity", "NaN"])
        field.fill(original)
    prices.first.fill("76000.123456789")
    prices.first.blur()
    assert prices.first.input_value() == "76,000.12"
    metric("#avg-b", 76000.123456789)
    prices.first.focus()
    assert prices.first.input_value() == "76000.123456789"
    results.append({"scenario": "1 to 11 levels, exact percentage totals, invalid fields and full internal precision"})

    # Exercise the empty and completed states in the same mobile viewport.
    page.evaluate("localStorage.clear()")
    page.reload()
    for width in [1440, 1024, 820, 768, 540, 390, 320]:
        page.set_viewport_size({"width": width, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
        assert el(".tools .shape:visible").count() == 6, width
        assert el(".tools .shape i").evaluate_all("(bars, blue) => bars.every(bar => getComputedStyle(bar).backgroundColor === blue)", blue)
    page.set_viewport_size({"width": 390, "height": 844})
    page.emulate_media(color_scheme="dark")
    assert page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches")
    el("#entry").fill("100")
    el("#size").fill("2")
    el("#single").fill("120")
    for i, value in enumerate(["110", "120", "130"]):
        prices.nth(i).fill(value)
    quick("aggressive")
    metric("#difference", 12)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=ARTIFACTS / "mobile-dark.png", full_page=True, animations="disabled")
    assert not errors, errors
    results.append({"scenario": "Responsive widths 320–1440 px, mobile dark mode and browser console"})
    context.close()
    return results


def verify_browser_restart(chromium, channel):
    url = (ROOT / "index.html").as_uri()
    with TemporaryDirectory(prefix="tp-calculator-e2e-") as profile:
        with chromium.launch_persistent_context(profile, channel=channel) as session:
            page = session.pages[0]
            page.goto(url)
            page.locator("#entry").fill("101.123456789")
            page.locator("#size").fill("3.125")
            page.locator("#single").fill("115")
            page.locator("#add").click()
            for field, price in zip(page.locator('[data-key="price"]').all(), ["110", "112", "120"]):
                field.fill(price)
            page.locator('.tools [data-preset="balanced"]').click()
            page.locator('[data-key="allocation"]').first.fill("17.25")
            page.locator('input[type="range"]').first.press("ArrowRight")
            saved_weights = [field.input_value() for field in page.locator('[data-key="allocation"]').all()]

        with chromium.launch_persistent_context(profile, channel=channel) as session:
            page = session.pages[0]
            page.goto(url)
            page.locator("#entry").focus()
            assert page.locator("#entry").input_value() == "101.123456789"
            assert page.locator("#size").input_value() == "3.125"
            assert page.locator("#single").input_value() == "115.00"
            assert [f.input_value() for f in page.locator('[data-key="price"]').all()] == ["110.00", "112.00", "120.00", ""]
            assert [f.input_value() for f in page.locator('[data-key="allocation"]').all()] == saved_weights
            assert saved_weights[0] == "17.26"
            assert not page.locator(".tools [aria-pressed=true]").count()
            assert page.locator("#results").is_hidden()
    return {"scenario": "Full browser restart restores exact inputs, custom slider weights and an unfinished fourth target"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--channel", default="chrome" if sys.platform == "win32" else "chromium")
    args = parser.parse_args()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    report = ARTIFACTS / "results.json"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel=args.channel)
            results = verify(browser)
            data = {"status": "passed", "browser": browser.version, "checks": results}
            browser.close()
            results.append(verify_browser_restart(playwright.chromium, args.channel))
    except Exception as exc:
        report.write_text(json.dumps({"status": "failed", "error": repr(exc)}, indent=2), encoding="utf-8")
        raise
    report.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PASS: {len(results)} scenario groups; report at {report}")
