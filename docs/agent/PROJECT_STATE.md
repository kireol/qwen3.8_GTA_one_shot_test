# Project State

## Current Objective
`src/city.html` is a finished, self-contained walkable voxel city (three.js r128 from
cdnjs, zero assets, zero build step). The harness now lives in `tests/` instead of loose
files in `/tmp`, and the repo-level `README.md` is written. No open implementation work;
remaining items need the user's real browser.

## Architecture Decisions
- Decision: the test suite drives the real artifact — no bundler, no npm deps.
  - Reason: `city.html` is a single file with an inline IIFE; nothing inside it is
    reachable from outside, so tests either re-execute its own source text or drive
    it over CDP. Adding a test framework would only add a second source of truth.
  - Alternatives rejected: refactoring the page into modules to make it unit-testable.
- Decision: movement math is asserted by `check_strafe.js`, which rebuilds the page's
  own formulas with `new Function` on the extracted source — not by transcribing them.
  - Reason: headless Chrome never grants pointer lock, so in-page movement is
    unmeasurable there (see Known Issues).
  - Alternatives rejected: asserting a hand-copied formula (proves nothing about the
    file), or measuring the camera in headless (can never pass).
- Decision: `extract_script.js` is the single loader and fails loudly if the inline
  `<script>` match goes quiet (<100 lines).
  - Reason: a silent regex miss would make every downstream check pass while testing
    nothing.
- Decision: keep the original script filenames when moving into `tests/`; only the
  hardcoded absolute paths changed (`PAGE` derives from `__dirname`, output goes to
  `tests/out/`, Chrome path overridable via `$CHROME`).
  - Reason: prior notes and bug write-ups refer to these names.

## Completed
- [x] `city.html` sections 0-17 written; no resume markers.
- [x] 2026-11-05 fixes, all verified at the time: strafe sign in `updatePlayer`
      (A/D were mirrored), `yawRate` initialised in `newCar` (NaN was zeroing every car
      instance matrix), `head` geometry made pivot-local in `mkPedPartGeo`.
- [x] Harness relocated to `tests/` (from `/tmp`) and made location-independent:
      `run.sh`, `README.md`, `syntax_check.js`, `extract_script.js`, `check_strafe.js`,
      `cdp_smoke.js`, `cdp_scene.js`, `cdp_diag.js`, `cdp_night.js`, `cdp_walk.js`,
      `cdp_probe.js`.
- [x] Verified from the new location: `node --check` clean on all 9 js files;
      `syntax_check.js` exit 0 (3906 lines extracted); `check_strafe.js` exit 0 with
      its negative control correctly flagging the pre-fix formula.
- [x] `cdp_smoke.js` re-run from `tests/` against `src/city.html` — see Last Verified
      State for the result.
- [x] `tests/README.md` written: what each script does, the probe/CI split, port
      allocation 9333-9338, `$CHROME` override, and the two headless traps.
- [x] 2026-11-05: re-ran `tests/cdp_night.js` to regenerate genuine dusk/night frames
      for the README (`tests/out/city_night/n0-start.png`..`n7.png`, exit 0,
      `errors: 0`). At the final frame: sun `i=0.07`, hemisphere `i=0.48` tint
      `#03060f`, fog `040306` d=0.00106, env present, exposure 1.05. Clock read 1:46 AM.
- [x] Repo-level `README.md` written (218 lines), citing strata
      (https://github.com/niko1221/strata), model
      `qwen3.8-flash-next-unsloth-ud-iq4_xs-v31` (Unsloth UD-IQ4_XS Dynamic v3.1,
      2026-11-04), the runtime/hardware context block verbatim, and the verbatim
      prompt read in from the screenshot at
      https://unsloth.ai/docs/models/qwen3.8-next.
- [x] Every numeric claim in `README.md` checked against the artifact, including the
      18-section file map, which `diff` confirms matches the section-title lines in
      `src/city.html` verbatim (19 lines: section 10 uses an ASCII hyphen, and the
      section 17 title wraps over source lines 3770-3771). `wc -l` says 4034 because
      the file has no trailing newline; the README quotes the editor count (4,035)
      plus the exact byte count (197,691).
- [x] Screenshots curated into `docs/images/` (boot.png, city-morning.png,
      camera-close-chase.png, dusk.png, night.png) — durable copies, because
      `tests/out/` is documented as disposable. Every frame was viewed before being
      embedded; `08-cam-first-person.png` and `09-sprint.png` were rejected because both
      show the `WIDE FOLLOW` toast rather than the state their filename claims.

## In Progress
- [ ] Nothing in flight.

## Outstanding Tasks
- [ ] Needs the user's real browser (not testable headless): pointer-lock feel,
      sprint/hop, first-person CAMMODE 2 visuals.
- [ ] Cosmetic: the stop bar sits on the zebra band, so cars stop nose-in on the
      crossing. Now visible because cars render. Move the stop line up to the
      crosswalk's approach edge.

## Known Issues
- Issue: `--headless=new` never grants pointer lock to CDP-synthesised input, so the
  game's `locked && started` gate stays shut and the camera never moves.
  - Reproduction: `node tests/cdp_smoke.js` step [4] reports 0 m walked.
  - Current investigation: none — resolved as a harness artifact, not a bug. The user
    plays in a real browser and does move. Do NOT re-open the "spawn sits inside a
    collider so `resolveCircle` pins the player" hypothesis.
- Issue: under SwiftShader the sim runs ~0.25x real time (`dt` clamped to 0.05 at
  ~5 fps), so headless screenshots look slow-motion. Expected, not a bug.
- Issue: the originals are still in `/tmp` as untracked duplicates.
  - Current investigation: left in place deliberately (non-destructive copy). Delete
    `/tmp/cdp_*.js`, `/tmp/check_strafe.js`, `/tmp/city_extract.js` once `tests/` is
    confirmed good.

## Important Files
- `README.md` — repo front page: screenshots, provenance (strata + model + prompt),
      controls, world contents, section map of `city.html`, run/test instructions,
      known limitations.
- `docs/images/` — the 5 screenshots the README embeds. Durable; `tests/out/` is not.
- `src/city.html` — the whole game/world, 4034 lines; inline `<script>` at 128-4031.
- `tests/run.sh` — runs the three pass/fail checks (`sh tests/run.sh`).
- `tests/README.md` — what each script does, plus the two headless traps.
- `tests/extract_script.js` — shared inline-script loader; standalone dumps it too.
- `tests/syntax_check.js` / `tests/check_strafe.js` / `tests/cdp_smoke.js` — verdicts.
- `tests/cdp_scene.js` — scene-graph dump; the go-to for "minimap shows it but the 3D
  view doesn't" (NaN instance matrices) and detached rig heads.
- `tests/cdp_diag.js` `cdp_night.js` `cdp_walk.js` `cdp_probe.js` — diagnostic probes.
- `tests/out/` — generated screenshots / `report.json` / chrome logs; safe to delete.

## Last Verified State
- Build: n/a (no build step). `node --check` on the extracted inline script: clean.
- Tests: `sh tests/run.sh` — `syntax_check.js` PASS (exit 0), `check_strafe.js` PASS
      (exit 0, negative control discriminating), `cdp_smoke.js` exit 0, 0 console
      errors, world visible, rAF loop alive (re-verified 2026-11-05 after the move).
- Git commit: no git repository in this directory.
