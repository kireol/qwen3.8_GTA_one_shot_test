---
name: verified-project-readme
description: Write a README for a generated/single-file artifact where every number, line-number map and screenshot is machine-verified against source, and unproven claims are disclosed instead of glossed over.
source: auto-skill
extracted_at: '2026-11-05T15:23:23.736Z'
---

# Verified project README

For repos whose contents were generated (often by an AI agent) and whose README must
carry provenance + screenshots without inventing anything. The rule that drives
everything below: **a README claim is a test assertion — source it or delete it.**

## 1. Draft, then verify each class of claim separately

List the claims, then verify by type. Do not ship a number you inferred from a
filename, a memory, or a prior conversation summary.

| Claim type | How to source it |
|---|---|
| File size | `wc -c` (exact bytes) + editor line count |
| Code structure map | extract real section-title lines (see §2) |
| Runtime constants / key bindings | `read_file` the exact lines; grep is fine only if the result isn't drowned in CSS/HTML noise |
| Lighting / perf numbers in captions | read the harness run log; check exit code and `errors: 0` before citing |
| Model / hardware / prompt text | user-supplied → verbatim (§4) |

## 2. Extracting a section map (two traps that cost real time)

- **Do not** guess that a marker line like `/* ===` *is* the title. The title is usually
  the line **after** the marker; a first pass on `NR+1/NR+2` guesses prints only banner
  rules. Read one section by eye, then generate from the confirmed offsets.
- **Do not** grep a pattern like `^ ?[0-9]+\. [a-z]` and trust "No matches found" —
  titles are commonly indented 2–4 spaces. Prefer `awk 'NR==138||NR==203||…' file`
  over fighting indentation, or use `grep -nE '^[[:space:]]*[0-9]+\.'`.
- Titles may **wrap onto a continuation line** (`17. renderer, boot ladder, … touches`
  / `GPU state or DOM events.`). Capture the continuation or the map is wrong.
- Punctuation inside titles is source data: an ASCII hyphen that *reads* better as an
  em dash is still a hyphen. Fix the README, never the artifact, to make prose nicer.

## 3. Diffing a README code block against the artifact

```sh
diff <(awk '…' src/x.html) <(sed -n '/```/,/```/p' README.md)
diff <(tr -s ' ' <a) <(tr -s ' ' <b)   # whitespace-collapsed re-diff
```

If the raw diff flags **every** line but the collapsed diff matches, the difference is
column padding added for alignment → **fix the verification, not the file**, and say so
in the commit/state note. Print an explicit success line so the check is greppable:
`VERBATIM MATCH (whitespace-aligned): 19 section lines, incl. wrapped 17`.

**Line-count discrepancy:** `wc -l` counts newlines, so a file with no trailing newline
reads one short of the editor count. Quote the editor count **plus the exact byte
count** and record the reason in project state — do not "fix" the file to make `wc` agree.

## 4. User-supplied provenance: format, never rewrite

Harness link, model id/quant, context/KV/hardware block, and a prompt transcribed from a
screenshot go in **verbatim**. Give the context block its own fenced code block (align
fields if you like, change nothing) and the prompt a blockquote, each with a line of
provenance ("read in from a screenshot at <url>, transcribed by vision"). It's fair to
*add* interpretation (e.g. what a 65,536-token window implies for a single-pass
generation) as long as it's visibly separate from the quoted data.

## 5. Screenshots: promote, view, reject, disclose

1. Generated frames live in a **disposable** dir (`tests/out/`). `cp` the curated ones to
   a durable path (`docs/images/`) and say which dir is which in the README.
2. **View every frame** (`read_file` the PNG) before embedding. Never caption from the
   filename — mislabelled captures are common (a `08-cam-first-person.png` that actually
   shows a `WIDE FOLLOW` toast).
3. If the frames you need don't exist, **re-run the capture probe** (e.g. a night/dusk
   probe that presses the in-game time key) and review its log before quoting it.
4. A rejected frame means a **missing claim**, not a silent omission: state in Known
   limitations that first-person view is deliberately not shown, and why.

## 6. "Known limitations" is where unverifiable things go

Split honestly: harness artifacts (headless never grants pointer lock ⇒ scripted walks
report `0 m`; SwiftShader runs the sim ~0.25× real time), not-yet-verified-in-a-real-browser
items, known cosmetics, and repo facts like *no VCS*. This is what keeps the rest of the
README trustworthy.

## 7. Registration & state bookkeeping

- `write_file` / `edit` auto-register artifact-like files. Files created by **shell**
  (`cp`, `>` redirects) do **not** — call `record_artifact` for each (here it was a
  deferred tool: `tool_search` `select:record_artifact`, then `tool_call`; `workspacePath`
  is workspace-relative, `title` required, `kind: image`). Never re-record a path that is
  already registered.
- Update `docs/agent/PROJECT_STATE.md` with what was **verified** (including how), what
  was rejected, and what remains unclaimed — that's what lets a post-compaction session
  skip the re-verification.

## Platform gotcha

`cat -A` is GNU-only — on macOS/BSD it fails with `cat: illegal option -- A`. Use
`sed -n l`, `cat -v` or `od -c` for byte-level inspection.
