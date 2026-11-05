/* Night/dusk verification: scrub city time with the T key and shoot, checking the
   lamp/neon/window lighting that updateSky switches on. Also reads back the
   lighting state through the same prototype hooks the diagnostic uses. */
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = 'file://' + path.resolve(__dirname, '..', 'src', 'city.html');
const PORT = 9335;
const OUT = path.join(__dirname, 'out', 'city_night');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-night-'));
fs.mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=1440,900', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--mute-audio', '--disable-background-timer-throttling', 'about:blank'],
  { stdio: ['ignore', fs.openSync(OUT + '/chrome.log', 'w'), fs.openSync(OUT + '/chrome.log', 'w')] });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
(async () => {
  let t; for (let i = 0; i < 120 && !t; i++) { await sleep(250);
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
    else if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + JSON.stringify(m.params.exceptionDetails.exception || {}).slice(0, 300)); };
  const cdp = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Log.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    var IV = setInterval(function () {
      var T = window.THREE; if (!T || !T.Object3D || !T.PMREMGenerator) return; clearInterval(IV);
      var _add = T.Object3D.prototype.add;
      T.Object3D.prototype.add = function () { if (!window.__sc && this.isScene) for (var i = 0; i < arguments.length; i++)
        if (arguments[i] && arguments[i].isLight) { window.__sc = this; break; } return _add.apply(this, arguments); };
      var _fs = T.PMREMGenerator.prototype.fromScene;
      T.PMREMGenerator.prototype.fromScene = function () { window.__r = this._renderer; return _fs.apply(this, arguments); };
    }, 0);` });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: PAGE });
  const ev = x => cdp('Runtime.evaluate', { expression: x, returnByValue: true })
    .then(r => r.exceptionDetails ? 'EVAL-ERR ' + JSON.stringify(r.exceptionDetails.text) : r.result.value);
  for (let i = 0; i < 300; i++) { await sleep(400);
    const d = await ev(`document.getElementById('enter').className + '|' + getComputedStyle(document.getElementById('note')).display`);
    if (/\|block/.test(d)) { console.log('BUILD ERROR: ' + await ev(`document.getElementById('note').textContent`)); process.exit(3); }
    if (/^on\|/.test(d)) break; }
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1, buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 450, button: 'left', clickCount: 1 });
  await sleep(2200);
  const hud = () => ev(`JSON.stringify({clock:document.getElementById('clock').textContent, tod:document.getElementById('tod').textContent})`);
  const lighting = () => ev(`(function(){
    var o={lights:{},mat:{},fog:null,env:!!window.__sc.environment};
    window.__sc.traverse(function(n){ if(!n.isLight) return;
      var s={i:+n.intensity.toFixed(2),vis:n.visible,y:+n.position.y.toFixed(1)};
      if(n.isHemisphereLight) s.h=[n.color.getHexString(),n.groundColor.getHexString()];
      o.lights[n.type+(n.castShadow?'(shadow)':'')]=s; });
    var f=window.__sc.fog; o.fog={d:+f.density.toFixed(5),c:f.color.getHexString()};
    ['fac0','gf0','glowDot','glowPool','carBeam','neon'].forEach(function(k){});
    window.__sc.traverse(function(n){ if(!n.isMesh||!n.material||!n.material.name) return; });
    o.exposure = window.__r.toneMappingExposure;
    return JSON.stringify(o);
  })()`);
  const shot = async n => { const b = Buffer.from((await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
    fs.writeFileSync(path.join(OUT, n + '.png'), b); console.log('  shot ' + n + '.png ' + b.length + 'B'); };
  const pressT = async () => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyT', key: 't', windowsVirtualKeyCode: 84, nativeVirtualKeyCode: 84 });
    await sleep(50);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyT', key: 't', windowsVirtualKeyCode: 84, nativeVirtualKeyCode: 84 });
    await sleep(1100);
  };
  console.log('start: ' + await hud());
  await shot('n0-start');
  for (let k = 1; k <= 7; k++) {
    await pressT();
    console.log(`after T x${k}: ` + await hud());
    await shot('n' + k);
  }
  console.log('\nlighting at the end: ' + await lighting());
  console.log('errors: ' + errors.length); errors.slice(0, 6).forEach(e => console.log('  ' + e));
  ws.close(); chrome.kill('SIGKILL'); process.exit(0);
})().catch(e => { console.log('FAILED ' + e.message); try { chrome.kill('SIGKILL'); } catch (x) {} process.exit(1); });
