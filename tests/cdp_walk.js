/* Focused: does WASD actually move the player? The game camera is identified
   uniquely by far=2600 (PMREM's cameras use far=400), and its position tracks the
   player through camCur — so a displacement proves the movement path ran. */
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = 'file://' + path.resolve(__dirname, '..', 'src', 'city.html');
const PORT = 9336;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-walk-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=1440,900', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--mute-audio', '--disable-background-timer-throttling', 'about:blank'],
  { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let t; for (let i = 0; i < 120 && !t; i++) { await sleep(250);
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  const cdp = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    var IV = setInterval(function () {
      var T = window.THREE; if (!T || !T.Object3D || !T.Object3D.prototype.lookAt) return; clearInterval(IV);
      var _la = T.Object3D.prototype.lookAt;
      T.Object3D.prototype.lookAt = function () {
        if (this.isPerspectiveCamera && Math.abs(this.far - 2600) < 1) {
          window.__gc = this;
          this.updateMatrixWorld(true);
          window.__gcp = [ +this.position.x.toFixed(2), +this.position.y.toFixed(2), +this.position.z.toFixed(2) ];
          window.__gcfov = +this.fov.toFixed(1);
        }
        return _la.apply(this, arguments);
      };
    }, 0);` });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: PAGE });
  const ev = x => cdp('Runtime.evaluate', { expression: x, returnByValue: true }).then(r => r.result.value);
  for (let i = 0; i < 300; i++) { await sleep(400);
    if (/^on$/.test(await ev(`document.getElementById('enter').className`))) break; }
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1, buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 450, button: 'left', clickCount: 1 });
  await sleep(2000);
  const key = async (code, name, ms) => {
    const vk = code.charCodeAt(3);
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', code, key: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(ms);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', code, key: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(300);
  };
  console.log('game camera:', await ev(`JSON.stringify({found:!!window.__gc, pos:window.__gcp, fov:window.__gcfov})`));
  const a = await ev(`window.__gcp.join(',')`);
  await key('KeyW', 'w', 6000);
  const b = await ev(`window.__gcp.join(',')`);
  console.log('after 6s of W:', b);
  const [ax, , az] = a.split(',').map(Number), [bx, by2, bz] = b.split(',').map(Number);
  console.log(`moved ${Math.hypot(bx - ax, bz - az).toFixed(2)} m in XZ (camera y=${by2})`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 400, deltaX: 300, deltaY: 0 }).catch(() => {});
  await sleep(600);
  const fovBefore = await ev(`window.__gcfov`);
  await key('KeyA', 'a', 3000);
  console.log('after 3s of A:', await ev(`window.__gcp.join(',')`), 'fov', fovBefore, '->', await ev(`window.__gcfov`));
  const img = await ev(`(function(){var c=document.querySelector('#stage canvas');return c.width+'x'+c.height;})()`);
  console.log('canvas', img);
  ws.close(); chrome.kill('SIGKILL'); process.exit(0);
})().catch(e => { console.log('FAILED ' + e.message); try { chrome.kill('SIGKILL'); } catch (x) {} process.exit(1); });
