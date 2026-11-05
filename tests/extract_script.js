/* Extracts the game's inline <script> from src/city.html so plain node can
   check or re-execute it. The page has one CDN tag (three.js r128) and one
   inline block; the inline block is the last <script> without a src attribute.
   Run standalone to write it: node tests/extract_script.js [outfile] */
const fs = require('fs');
const path = require('path');

const CITY = path.resolve(__dirname, '..', 'src', 'city.html');

function extractInlineScript(html) {
  let best = null;
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    best = m[2];
  }
  return best;
}

function loadGameScript() {
  const html = fs.readFileSync(CITY, 'utf8');
  const js = extractInlineScript(html);
  if (js === null) throw new Error(`no inline <script> found in ${CITY} — did the page structure change?`);
  const lines = js.split('\n').length;
  /* A silently-empty regex match would otherwise make every downstream check
     pass by testing nothing. */
  if (lines < 100) throw new Error(`inline <script> looks truncated: ${lines} lines (expected ~3900)`);
  return { js, lines };
}

module.exports = { CITY, extractInlineScript, loadGameScript };

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, 'out', 'city_extract.js');
  const { js, lines } = loadGameScript();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, js);
  console.log(`extracted ${lines} lines from ${path.relative(process.cwd(), CITY)} -> ${out}`);
}
