#!/bin/sh
# Checks that can produce a real pass/fail verdict (exit 0 = green).
# The CDP probes in this folder are diagnostic dumps, not assertions — run them
# by hand, see README.md.
set -e
cd "$(dirname "$0")"
echo "== syntax_check"      && node syntax_check.js
echo "== check_strafe"      && node check_strafe.js
echo "== cdp_smoke (Chrome headless, ~2 min)" && node cdp_smoke.js
echo "== SUITE PASS"
