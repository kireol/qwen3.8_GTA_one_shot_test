/* Executes the strafe and camera-placement formulas extracted verbatim from
   city.html, so the A/D sign convention is checked against the file's own math
   rather than a transcription of it. Headless Chrome cannot grant pointer lock,
   so in-page movement cannot be measured. */
const { loadGameScript } = require('./extract_script');
const { js: src } = loadGameScript();

const moveM = src.match(/var fx = Math\.sin\(camYaw\), fz = Math\.cos\(camYaw\);[\s\S]*?gx = [^\n]+;[\s\S]*?gz = [^\n]+;/);
const camM = src.match(/var dx = -Math\.sin\(camYaw\)[^;]*?dz = -Math\.cos\(camYaw\)[^;]*;/);
if (!moveM || !camM) { console.log('FORMULA EXTRACT FAILED: move=' + !!moveM + ' cam=' + !!camM); process.exit(1); }
console.log('move: ' + moveM[0].replace(/\s+/g, ' '));
console.log('cam : ' + camM[0].replace(/\s+/g, ' '));

/* velocity the file produces for a given camYaw / forward f / strafe s */
const vel = new Function('camYaw', 'f', 's',
  'var gx, gz; ' + moveM[0] + ' return [gx, gz];');
/* camera placement offset from the player (updateCam): the camera sits at
   player + (dx, ..., dz), so its horizontal forward is -(dx, dz). */
const camFwd = new Function('camYaw', 'cp',
  'var sp = 0; /* pitch term is irrelevant to the horizontal basis */ ' + camM[0] + ' return [-dx / cp, -dz / cp];');

let fails = 0;
for (const deg of [0, 30, 75, 120, 180, -45, -120, 200]) {
  const yaw = deg * Math.PI / 180;
  const fwdX = camFwd(yaw, 1);                        // unit camera forward (x,z)
  const right = [-fwdX[1], fwdX[0]];                  // screen-right = forward x up
  const cases = { W: [1, 0], S: [-1, 0], D: [0, 1], A: [0, -1] };
  const out = [];
  for (const k of Object.keys(cases)) {
    const v = vel(yaw, cases[k][0], cases[k][1]);
    const l = Math.hypot(v[0], v[1]) || 1;
    const alongR = (v[0] * right[0] + v[1] * right[1]) / l;
    const alongF = (v[0] * fwdX[0] + v[1] * fwdX[1]) / l;
    out.push(`${k}:fwd=${alongF.toFixed(2)}/right=${alongR.toFixed(2)}`);
    const want = { W: [1, 0], S: [-1, 0], D: [0, 1], A: [0, -1] }[k];
    if (Math.abs(alongF - want[0]) > 0.02 || Math.abs(alongR - want[1]) > 0.02) fails++;
  }
  console.log(`camYaw=${String(deg).padStart(4)}deg fwd=(${fwdX[0].toFixed(2)},${fwdX[1].toFixed(2)}) right=(${right[0].toFixed(2)},${right[1].toFixed(2)})  ${out.join('  ')}`);
}
console.log(fails ? `STRAFE CHECK FAILED (${fails} wrong)` : 'STRAFE CHECK PASS: W=forward, S=back, D=screen-right, A=screen-left at every yaw');

/* Negative control: the checker must actually reject the pre-fix formula,
   otherwise a green run would prove nothing. */
const oldMove = moveM[0].replace('fx * f - fz * s; gz = fz * f + fx * s', 'fx * f + fz * s; gz = fz * f - fx * s');
if (oldMove === moveM[0]) { console.log('NEGATIVE CONTROL INCONCLUSIVE: pre-fix text not found'); process.exit(1); }
const velOld = new Function('camYaw', 'f', 's', 'var gx, gz; ' + oldMove + ' return [gx, gz];');
const yaw = 0.6, rgt = (() => { const f = camFwd(yaw, 1); return [-f[1], f[0]]; })();
const dOld = velOld(yaw, 0, 1), aOld = velOld(yaw, 0, -1);
const dot = (v, r) => (v[0] * r[0] + v[1] * r[1]) / Math.hypot(v[0], v[1]);
console.log(`NEGATIVE CONTROL (pre-fix formula): D right-component=${dot(dOld, rgt).toFixed(2)} A right-component=${dot(aOld, rgt).toFixed(2)} ` +
  (dot(dOld, rgt) < -0.9 && dot(aOld, rgt) > 0.9 ? '=> checker correctly flags the old keys as swapped' : '=> CHECKER IS NOT DISCRIMINATING'));
const controlOk = dot(dOld, rgt) < -0.9 && dot(aOld, rgt) > 0.9;
process.exit(fails || !controlOk ? 1 : 0);
