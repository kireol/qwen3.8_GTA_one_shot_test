/* Probe: is the key event delivered, and what does the browser report for the
   pointer lock? A capture-phase document listener sees the same events the game's
   window listener sees, without touching the page. */
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = 'file://' + path.resolve(__dirname, '..', 'src', 'city.html');
const PORT = 9337;
const profile = fs.mkdtempSync(path_join());
function path_join() { return require('path').join(os.tmpdir(), 'cdp-probe-'); }
require('fs').mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=1440,900', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--mute-audio', '--disable-background-timer-throttling', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let t; for (let i = 0; i < 120 && !t; i++) { await sleep(250);
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const events = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.consoleAPICalled') events.push('console.' + m.params.type + ' ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' '));
    else if (m.method === 'Runtime.exceptionThrown') events.push('EXCEPTION ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text).slice(0, 200)); };
  const cdp = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__k = []; window.__pl = [];
    document.addEventListener('keydown', function (e) { window.__k.push('down:' + e.code + '/' + e.key + '/repeat=' + e.repeat); }, true);
    document.addEventListener('keyup', function (e) { window.__k.push('up:' + e.code); }, true);
    document.addEventListener('pointerlockchange', function () { window.__pl.push('change:' + (document.pointerLockElement ? document.pointerLockElement.tagName : 'null')); }, true);
    document.addEventListener('pointerlockerror', function () { window.__pl.push('ERROR'); }, true);
    var IV = setInterval(function () {
      var T = window.THREE; if (!T || !T.Object3D || !T.Object3D.prototype.lookAt) return; clearInterval(IV);
      var _la = T.Object3D.prototype.lookAt;
      T.Object3D.prototype.lookAt = function () {
        if (this.isPerspectiveCamera && Math.abs(this.far - 2600) < 1) {
          window.__gc = this; window.__gcp = [+this.position.x.toFixed(2), +this.position.y.toFixed(2), +this.position.z.toFixed(2)]; }
        return _la.apply(this, arguments); };
    }, 0);` });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: PAGE });
  const ev = x => cdp('Runtime.evaluate', { expression: x, returnByValue: true }).then(r => r.result.value);
  for (let i = 0; i < 300; i++) { await sleep(400);
    if (/^on$/.test(await ev(`document.getElementById('enter').className`))) break; }
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1, buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 450, button: 'left', clickCount: 1 });
  await sleep(300);
  console.log('t+0.3s pointer lock events:', await ev(`JSON.stringify(window.__pl)`));
  await sleep(1500);
  console.log('t+1.8s pointer lock events:', await ev(`JSON.stringify(window.__pl)`), 'lockEl:', await ev(`document.pointerLockElement ? document.pointerLockElement.tagName : 'null'`));
  console.log('activeElement:', await ev(`document.activeElement.tagName + '.' + document.activeElement.id`));
  const p0 = await ev(`window.__gcp.join(',')`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
  await sleep(1500);
  console.log('mid-hold keys seen:', await ev(`JSON.stringify(window.__k.slice(-2))`), 'cam:', await ev(`window.__gcp.join(',')`));
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
  await sleep(400);
  console.log('cam start=' + p0 + ' end=' + await ev(`window.__gcp.join(',')`));
  console.log('\npage console:'); events.slice(0, 12).forEach(e => console.log('  ' + e));
  ws.close(); chrome.kill('SIGKILL'); process.exit(0);
})().catch(e => { console.log('FAILED ' + e.message); try { chrome.kill('SIGKILL'); } catch (x) {} process.exit(1); });
