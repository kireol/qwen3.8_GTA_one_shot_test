/* Syntax gate for the single-file build: extracts the inline <script> from
   src/city.html and runs `node --check` on it. Catches the parse errors that
   would otherwise only show up as a blank page in the browser. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadGameScript } = require('./extract_script');

const OUT = path.join(__dirname, 'out', 'city_extract.js');
const { js, lines } = loadGameScript();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, js);

const r = spawnSync(process.execPath, ['--check', OUT], { encoding: 'utf8' });
const stderr = (r.stderr || '').replace(OUT, path.relative(process.cwd(), OUT));
console.log(`extracted ${lines} lines -> ${path.relative(process.cwd(), OUT)}`);
if (r.status === 0) {
  console.log('SYNTAX CHECK PASS: node --check clean');
  process.exit(0);
}
console.log('SYNTAX CHECK FAIL: node --check exited ' + r.status);
console.log(stderr.split('\n').slice(0, 20).map(l => '  ' + l).join('\n'));
process.exit(1);
