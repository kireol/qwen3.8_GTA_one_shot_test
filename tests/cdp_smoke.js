/* Dependency-free CDP smoke test: launches Chrome headless, loads city.html,
   drives the boot ladder, clicks ENTER, presses the documented keys, screenshots. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = 'file://' + path.resolve(__dirname, '..', 'src', 'city.html');
const PORT = 9333;
const SHOTS = path.join(__dirname, 'out', 'city_shots');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-prof-'));
fs.mkdirSync(SHOTS, { recursive: true });
const chromeLog = fs.openSync(path.join(SHOTS, 'chrome.log'), 'w');

const args = [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--window-size=1440,900', '--window-position=60,60',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  '--enable-logging=stderr', '--log-level=0',
  'about:blank'
];
const chrome = spawn(CHROME, args, { stdio: ['ignore', chromeLog, chromeLog], detached: false });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const logs = [], errors = [], exceptions = [];

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = ev => reject(new Error('ws error ' + (ev.message || '')));
  });
}
function makeCdp(ws) {
  let id = 0; const pend = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method) handleEvent(m.method, m.params);
  };
  return (method, params) => new Promise((resolve, reject) => {
    const mid = ++id; pend.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
}
function handleEvent(method, p) {
  if (method === 'Runtime.consoleAPICalled') {
    const txt = (p.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
    (p.type === 'error' || p.type === 'warning' ? errors : logs).push(`[console.${p.type}] ${txt}`);
  } else if (method === 'Runtime.exceptionThrown') {
    const d = p.exceptionDetails || {};
    errors.push('[exception] ' + (d.exception && (d.exception.description || d.exception.value) || d.text || 'unknown'));
  } else if (method === 'Log.entryAdded') {
    const e = p.entry || {};
    if (e.level === 'error' || e.level === 'warning') errors.push(`[log.${e.level}] ${e.source || ''} ${e.text || ''}`);
    else logs.push(`[log.${e.level}] ${e.source || ''} ${e.text || ''}`);
  }
}
async function waitForTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const t = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (t) return t;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('no CDP target appeared');
}
async function main() {
  const target = await waitForTarget();
  const ws = await connect(target.webSocketDebuggerUrl);
  const cdp = makeCdp(ws);
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');
  /* Capture the live scene + camera through prototype hooks (r128 puts
     renderer.render on the instance, so the constructor can't be wrapped from
     here — and the game builds it before any injected timer could run anyway). */
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    var IV = setInterval(function () {
      var T = window.THREE; if (!T || !T.Object3D || !T.Object3D.prototype.add) return; clearInterval(IV);
      var _add = T.Object3D.prototype.add;
      T.Object3D.prototype.add = function () {
        if (!window.__sc && this.isScene) for (var i = 0; i < arguments.length; i++)
          if (arguments[i] && arguments[i].isLight) { window.__sc = this; break; }
        return _add.apply(this, arguments);
      };
      var _la = T.Object3D.prototype.lookAt;
      T.Object3D.prototype.lookAt = function () { if (this.isCamera) window.__cam = this; return _la.apply(this, arguments); };
    }, 0);` });
  /* the page is one IIFE, so nothing inside is reachable from outside: instrument
     WebAudio at the constructor to prove section 16 actually runs and fires. */
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__probe = { ac: 0, ctx: null, osc: 0, buf: 0, frames: 0 };
    (function f(){ window.__probe.frames++; requestAnimationFrame(f); })();
    (function(){
      var B = window.AudioContext || window.webkitAudioContext;
      if (!B) return;
      var oc = B.prototype.createOscillator, bc = B.prototype.createBufferSource;
      B.prototype.createOscillator = function(){ window.__probe.osc++; return oc.apply(this, arguments); };
      B.prototype.createBufferSource = function(){ window.__probe.buf++; return bc.apply(this, arguments); };
      var W = new Proxy(B, { construct: function(t, a){
        var i = Reflect.construct(t, a);
        window.__probe.ac++; window.__probe.ctx = i; return i; } });
      window.AudioContext = W;
      if (window.webkitAudioContext) window.webkitAudioContext = W;
    })();
  ` });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: PAGE });

  const ev = expr => cdp('Runtime.evaluate', { expression: expr, returnByValue: true })
    .then(r => (r.exceptionDetails ? 'EVAL-THREW: ' + r.exceptionDetails.text : r.result.value));
  const state = () => ev(`JSON.stringify({
    enter: document.getElementById('enter').className,
    boot:  document.getElementById('boot').className,
    bar:   document.querySelector('#bar i').style.width,
    msg:   document.getElementById('bootmsg').textContent,
    note:  getComputedStyle(document.getElementById('note')).display,
    noteTxt: document.getElementById('note').textContent,
    three: typeof THREE,
    hud:   document.getElementById('hud').className,
    clock: document.getElementById('clock').textContent,
    dist:  document.getElementById('dist').textContent,
    tod:   document.getElementById('tod').textContent,
    toastK:document.getElementById('toast').firstElementChild.textContent,
    toastV:document.getElementById('toast').lastElementChild.textContent,
    mute:  document.getElementById('mute').className,
    hint:  document.getElementById('hint').getAttribute('style') || '',
    lock:  document.pointerLockElement ? document.pointerLockElement.tagName : null,
    canvas:(document.querySelector('#stage canvas')||{}).width||null,
    fade:  document.getElementById('fade').style.opacity || getComputedStyle(document.getElementById('fade')).opacity,
    ac:    (window.__probe||{}).ac||0,
    acState: window.__probe && window.__probe.ctx ? window.__probe.ctx.state : null,
    acTime: window.__probe && window.__probe.ctx ? +window.__probe.ctx.currentTime.toFixed(2) : null,
    osc:   (window.__probe||{}).osc||0,
    buf:   (window.__probe||{}).buf||0,
    frames:(window.__probe||{}).frames||0,
    hit:   (document.elementFromPoint(720, 450)||{}).tagName,
    bootVis: getComputedStyle(document.getElementById('boot')).visibility,
    bootOp: getComputedStyle(document.getElementById('boot')).opacity,
    mapHash: (function(){ try { var d = document.getElementById('map').toDataURL(), s = 0, i = d.length - 6000;
      if (i < 0) i = 0; for (; i < d.length; i++) s = (s * 31 + d.charCodeAt(i)) | 0; return s; } catch (e) { return 'ERR ' + e.name; } })(),
    camPos: window.__cam ? window.__cam.position.toArray().map(function (v) { return +v.toFixed(2); }) : null
  })`).then(JSON.parse);

  const report = { steps: [], state0: null, errors: [], notes: [] };
  const note = s => { report.notes.push(s); console.log('   ' + s); };
  const shot = async name => {
    const r = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const buf = Buffer.from(r.data, 'base64');
    const file = path.join(SHOTS, name + '.png');
    fs.writeFileSync(file, buf);
    const sum = crypto.createHash('md5').update(buf).digest('hex').slice(0, 10);
    note(`shot ${name}: ${buf.length}B md5 ${sum}`);
    return { file, sum, size: buf.length };
  };
  const key = async (code, keyName, text) => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyName, windowsVirtualKeyCode: vk(code), nativeVirtualKeyCode: vk(code), text });
    await sleep(60);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyName, windowsVirtualKeyCode: vk(code), nativeVirtualKeyCode: vk(code) });
    await sleep(160);
  };
  const hold = async (code, keyName, ms) => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyName, windowsVirtualKeyCode: vk(code), nativeVirtualKeyCode: vk(code) });
    await sleep(ms);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyName, windowsVirtualKeyCode: vk(code), nativeVirtualKeyCode: vk(code) });
    await sleep(200);
  };

  console.log('[1] waiting for the boot ladder to finish...');
  let s = null, ok = false;
  for (let i = 0; i < 300; i++) {
    await sleep(400);
    s = await state();
    if (s.note !== 'none') { report.bootError = s.noteTxt; break; }
    if (/on/.test(s.enter)) { ok = true; break; }
    if (i % 10 === 0) process.stdout.write(`   ${s.bar} ${s.msg}\n`);
  }
  report.boot = { finished: ok, bar: s.bar, msg: s.msg, three: s.three, note: s.note, canvasW: s.canvas };
  console.log('[1] boot:', JSON.stringify(report.boot));
  report.state0 = s;
  if (!ok || report.bootError) {
    report.errors = errors.filter(notNoise);
    fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
    await shot('01-boot-failed');
    console.log('BOOT FAILED: ' + (report.bootError || 'timeout after 120s'));
    console.log('=== ERRORS ===');
    report.errors.slice(0, 15).forEach(e => console.log('  ' + e));
    ws.close(); chrome.kill('SIGKILL'); process.exit(3);
  }
  await shot('01-boot');

  console.log('[2] clicking to enter (this starts audio + the loop)...');
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1, buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 450, button: 'left', clickCount: 1 });
  await sleep(2600);
  s = await state(); report.afterEnter = s;
  note(`after enter: hud="${s.hud}" boot="${s.boot}" vis=${s.bootVis} op=${s.bootOp} hit=${s.hit} lock=${s.lock} fade=${s.fade}`);
  report.worldVisible = /gone/.test(s.boot) && s.bootVis === 'hidden' && s.hit === 'CANVAS';
  note('WORLD VISIBLE (boot gone + canvas is top element): ' + (report.worldVisible ? 'PASS' : 'FAIL'));
  await shot('02-city');

  console.log('[3] checking the frame loop advances...');
  const sa = await state(); const a = await shot('03-city-a');
  await sleep(1400);
  const b = await shot('04-city-b'); const sb = await state();
  report.loopAlive = sb.frames > sa.frames;
  report.canvasMoved = a.sum !== b.sum;
  note(`rAF ticks ${sa.frames} -> ${sb.frames} (${sb.frames - sa.frames} in ~1.4s); canvas ${a.sum} -> ${b.sum} ${report.canvasMoved ? 'changed' : 'identical'}`);

  console.log('[4] walking (needs pointer lock)...');
  const before = await state();
  await hold('KeyW', 'w', 4000);
  await hold('KeyA', 'a', 1500);
  const after = await state();
  const moved = (before.camPos && after.camPos)
    ? Math.hypot(after.camPos[0] - before.camPos[0], after.camPos[2] - before.camPos[2]) : null;
  report.walk = { lockBefore: before.lock, lockAfter: after.lock, camMovedM: moved,
                  camPos: [before.camPos, after.camPos], map: [before.mapHash, after.mapHash],
                  distBefore: before.dist, distAfter: after.dist };
  note(`walk: camera moved ${moved === null ? 'n/a' : moved.toFixed(2) + ' m'} (lock=${before.lock}->${after.lock}) | map ${before.mapHash} -> ${after.mapHash} | district ${before.dist} -> ${after.dist}`);
  await shot('05-after-walk');

  console.log('[5] keys V / T / M / H ...');
  const k1 = await state(); await key('KeyV', 'v'); const k2 = await state();
  report.camToast = { from: [k1.toastK, k1.toastV], to: [k2.toastK, k2.toastV] };
  note(`V -> toast ${JSON.stringify(report.camToast.to)}`);
  await shot('06-cam-close');
  await key('KeyT', 't'); const k3 = await state();
  report.time = { clock: [k2.clock, k3.clock], tod: [k2.tod, k3.tod], toast: [k3.toastK, k3.toastV] };
  note(`T -> clock ${k2.clock} => ${k3.clock}, tod ${k2.tod} => ${k3.tod}`);
  await sleep(1200); await shot('07-after-time-jump');
  await key('KeyM', 'm'); const k4 = await state();
  report.mute = { mute: k4.mute };
  note(`M -> #mute="${k4.mute}"`);
  await key('KeyM', 'm'); const k5 = await state();
  report.unmute = { mute: k5.mute };
  await key('KeyH', 'h'); const k6 = await state();
  report.hint = { style: k6.hint };
  note(`H -> hint style="${k6.hint}"`);
  await key('KeyH', 'h');
  await key('KeyV', 'v'); await key('KeyV', 'v');
  await sleep(900);
  await shot('08-cam-first-person');

  console.log('[6] sprint + hop ...');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  await hold('KeyW', 'w', 1400);
  await key('Space', ' ', ' ');
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  await sleep(600); await shot('09-sprint');

  console.log('[7] resize ...');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 1400, deviceScaleFactor: 1, mobile: false });
  await sleep(900); await shot('10-portrait-resize');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(700);

  console.log('[8] pause via a mouse move + Escape-like unlock ...');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 400, deltaX: 220, deltaY: -40 });
  await sleep(400);
  const lp = await state();
  note(`pointerlockElement=${lp.lock} hud=${lp.hud}`);
  await sleep(700); await shot('11-looked-around');

  const final = await state();
  report.final = final;
  report.audioProbe = await ev(`(function(){var B=window.AudioContext||window.webkitAudioContext;
    if(!B) return 'no AudioContext ctor';
    try{ var c=new B(); var st=c.state; if(c.close) c.close(); return 'ctor ok, state='+st; }
    catch(e){ return 'ctor THREW: '+e.name+' - '+e.message; } })()`);
  note('AudioContext ctor probe: ' + report.audioProbe);
  report.rafFrames = final.frames;
  report.errors = errors.filter(notNoise).slice(0, 40);
  report.errorCount = report.errors.length;
  report.logSample = logs.slice(0, 12);
  report.bootError = report.bootError || null;
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== BOOT ERROR ===\n' + (report.bootError || '(none)'));
  console.log('=== ERRORS/WARNINGS, noise filtered (' + report.errors.length + ') ===');
  report.errors.slice(0, 25).forEach(e => console.log('  ' + e));
  console.log('\n=== REPORT ===');
  const verdict = {
    worldVisible: report.worldVisible, loopAlive: report.loopAlive, canvasMoved: report.canvasMoved,
    rafFrames: report.rafFrames, lock: final.lock, boot: final.boot, bootVis: final.bootVis, hit: final.hit,
    audio: { ctxCount: report.afterEnter.ac, stateAtEnter: report.afterEnter.acState, stateEnd: final.acState,
             acTime: final.acTime, oscillators: final.osc, bufferSources: final.buf, ctorProbe: report.audioProbe },
    keys: { camToast: report.camToast.to, time: report.time, mute: report.mute, unmute: report.unmute, hint: report.hint.style },
    walk: report.walk, walkedMeters: report.walk.camMovedM,
    hud: { clock: final.clock, dist: final.dist, tod: final.tod },
    errorCount: report.errors.length
  };
  console.log(JSON.stringify(verdict, null, 2));
  ws.close();
  chrome.kill('SIGKILL');
  process.exit(report.worldVisible && report.loopAlive && report.errors.length === 0 ? 0 : 4);
}
function notNoise(e) {
  return !/GPU stall due to ReadPixels|willReadFrequently|GL Driver Message/.test(e);
}
function vk(code) {
  if (/^Key([A-Z])$/.test(code)) return code.charCodeAt(3);
  if (code === 'Space') return 32;
  if (code === 'ShiftLeft') return 16;
  return 0;
}
main().catch(e => {
  console.log('SMOKE FAILED: ' + e.message);
  console.log('errors captured: ' + errors.length);
  errors.slice(0, 20).forEach(x => console.log('  ' + x));
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ fail: e.message, errors: errors.slice(0, 40) }, null, 2));
  try { chrome.kill('SIGKILL'); } catch (e2) {}
  process.exit(1);
});
