# Tests for `src/city.html`

`city.html` is one self-contained file (three.js r128 from cdnjs, no build step, no
npm deps), so the tests drive the real artifact: plain node executes the page's own
inline script, and headless Chrome loads the page over CDP with zero dependencies —
`WebSocket`, `fetch` and `node:child_process` are all built in. Nothing here needs
`npm install`.

Run everything that can produce a verdict:

    sh tests/run.sh

Screenshots, `report.json` and chrome logs land in `tests/out/<name>/` (generated —
safe to delete). Chrome itself is found at the macOS default path; override with
`CHROME=/path/to/chrome node tests/cdp_smoke.js`. Each script uses its own
debug port (9333–9338) so they don't collide.

## Pass/fail checks

| Script | What it asserts |
| --- | --- |
| `syntax_check.js` | Extracts the inline `<script>` and runs `node --check` on it. Catches parse errors that would otherwise look like a blank page. |
| `check_strafe.js` | Re-executes the file's **own** move/camera formulas (`new Function` on the extracted source) and asserts W=forward, S=back, D=screen-right, A=screen-left at 8 yaws. Includes a negative control that rebuilds the pre-fix formula and must get flagged — a green run with a non-discriminating checker exits non-zero. |
| `cdp_smoke.js` | Boots the page headless, walks the boot ladder to ENTER, clicks in, then asserts: world visible (boot hidden + canvas is the top element at screen centre), rAF loop advancing, V/T/M/H key behaviour, resize, AudioContext construction. Exit 0 only if the world is visible, the loop is alive **and** there are 0 console errors/exceptions. Full verdict + `report.json` in `tests/out/city_shots/`. |

`extract_script.js` is the shared loader the two node-only checks use. It grabs the
last `<script>` without a `src` attribute and refuses (<100 lines) if that match ever
goes quiet, so a refactor of the page structure can't make the suite silently test
nothing. Run it standalone to dump the script for ad-hoc poking:
`node tests/extract_script.js /tmp/city_extract.js`.

## Diagnostic probes (no verdict — they dump facts and screenshots)

These are the tools that found the real bugs (NaN instance matrices, detached rig
heads, mirrored strafe). They exit non-zero only if the harness itself crashes, so
never wire them into CI as assertions.

| Script | Purpose |
| --- | --- |
| `cdp_scene.js` | Live scene-graph dump: per-instance matrix NaN counts, geometry bounding boxes, car→screen projection, camera identity. The go-to for "the minimap draws it but the 3D view doesn't". |
| `cdp_diag.js` | Lighting A/B: dumps lights + materials, then re-shoots with the suspected darkener disabled (AO multiply, shadows, ambient, environment). |
| `cdp_night.js` | Presses T seven times and shoots each dusk/night step, reading back lamp/neon/window lighting state. |
| `cdp_walk.js` | Identifies the game camera by `far=2600` (PMREM's use 400) and measures actual displacement under W / A. |
| `cdp_probe.js` | Is the key event even delivered, and what does the browser report for pointer lock? Capture-phase listeners, no page edits. |

## Three headless traps — read before trusting a failure

- **Pointer lock is never granted to CDP-synthesised input** in `--headless=new`, so
  the game's `locked && started` gate stays shut and the camera never moves.
  A 0 m walk in `cdp_smoke.js` / `cdp_walk.js` is a harness artifact, **not** a bug —
  that is why the movement math is asserted in `check_strafe.js` instead, and why
  pointer-lock feel, sprint/hop and first-person visuals need a real browser.
- **Under SwiftShader the sim runs ~0.25x real time** (`dt` clamped to 0.05 at ~5
  fps). Slow motion and few frames in screenshots are expected.
- **`cdp_night.js` logs its HUD read one `T` press early.** `hud()` reads
  `#clock`/`#tod` from the DOM *before* `Page.captureScreenshot` runs, and under
  SwiftShader the composited frame is a press ahead of that DOM value. So the
  `after T x4: … 4:40PM` line describes roughly what the *previous* frame shows — the
  frame it is printed next to can read `7:41 PM DUSK`. Trust the clock printed inside
  the image, never the log label. (The lighting dump is different: it runs once at the
  end of the scrub, so it describes the final frame only.)
