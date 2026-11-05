/* Scene probe for city.html: boots the page, enters the world, then dumps the
   live scene graph facts needed to explain (a) cars missing from the 3D view and
   (b) heads detached from bodies. Also measures the strafe direction. */
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = 'file://' + path.resolve(__dirname, '..', 'src', 'city.html');
const PORT = 9338;
const SHOTS = path.join(__dirname, 'out', 'city_scene');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-scene-'));
fs.mkdirSync(SHOTS, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', '--use-gl=angle',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio',
  '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required', 'about:blank'],
  { stdio: ['ignore', fs.openSync(path.join(SHOTS, 'chrome.log'), 'w'), fs.openSync(path.join(SHOTS, 'chrome.log'), 'a')] });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SCENE_JS = `(function () {
  if (!window.__scenes || !window.__scenes.length) return JSON.stringify({ err: 'no scenes captured' });
  function stats(g) {
    var p = g.attributes.position, i, k, mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9], nan = 0;
    if (!p) return { noPos: true };
    for (i = 0; i < p.count * 3; i += 3) for (k = 0; k < 3; k++) {
      var v = p.array[i + k];
      if (!isFinite(v)) { nan++; continue; }
      if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
    }
    var c = g.attributes.color, cmin = null, cmax = null;
    if (c) {
      cmin = [1e9,1e9,1e9]; cmax = [-1e9,-1e9,-1e9];
      for (i = 0; i < c.count * 3; i += 3) for (k = 0; k < 3; k++) {
        var w = c.array[i + k];
        if (w < cmin[k]) cmin[k] = w; if (w > cmax[k]) cmax[k] = w;
      }
      cmin = cmin.map(function (v) { return +v.toFixed(3); });
      cmax = cmax.map(function (v) { return +v.toFixed(3); });
    }
    var f = function (a) { return a.map(function (v) { return v > 1e8 ? null : +v.toFixed(3); }); };
    return { verts: p.count, tris: g.index ? g.index.count / 3 : 0, bbMin: f(mn), bbMax: f(mx),
             posNaN: nan, colMin: cmin, colMax: cmax };
  }
  var out = [];
  window.__scenes.forEach(function (sc, si) {
    var ims = [], meshes = [];
    sc.children.forEach(function (o) {
      if (o.isInstancedMesh) {
        var st = stats(o.geometry), m = new THREE.Matrix4(), t = [], bad = 0, badN = 0, zero = 0, i, k;
        for (i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          var e = m.elements, ok = true;
          for (k = 0; k < 16; k++) if (!isFinite(e[k])) { bad++; ok = false; }
          if (!ok) badN++;
          if (ok && i < 3) t.push([+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)]);
          if (ok && !e[0] && !e[5] && !e[10]) zero++;
        }
        ims.push({ verts: st.verts, tris: st.tris, bbMin: st.bbMin, bbMax: st.bbMax, posNaN: st.posNaN,
                   colMin: st.colMin, colMax: st.colMax, count: o.count, cap: o.instanceMatrix.count,
                   mat: o.material.type, vc: !!o.material.vertexColors, op: o.material.opacity,
                   vis: o.visible, tr2: !!o.material.transparent, dw: o.material.depthWrite,
                   fc: o.frustumCulled, ic: !!o.instanceColor, mNaN: bad, mBadInst: badN, mZero: zero, mT: t });
      } else if (o.isMesh) {
        var s2 = stats(o.geometry), e2 = o.matrix.elements;
        meshes.push({ verts: s2.verts, bbMin: s2.bbMin, bbMax: s2.bbMax, posNaN: s2.posNaN,
                      colMin: s2.colMin, colMax: s2.colMax, mat: o.material.type,
                      vc: !!o.material.vertexColors, vis: o.visible,
                      mT: [+e2[12].toFixed(3), +e2[13].toFixed(3), +e2[14].toFixed(3)],
                      mS: [+e2[0].toFixed(3), +e2[5].toFixed(3), +e2[10].toFixed(3)], amu: o.matrixAutoUpdate });
      }
    });
    out.push({ scene: si, children: sc.children.length,
               lights: sc.children.filter(function (o) { return o.isLight; }).length,
               cams: sc.children.filter(function (o) { return o.isCamera; }).length,
               ims: ims, meshes: meshes });
  });
  return JSON.stringify(out);
})()`;

(async () => {
  let t; for (let i = 0; i < 120 && !t; i++) { await sleep(250);
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const events = [];
  ws.onmessage = ev => { const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.consoleAPICalled' && /error|warning/.test(m.params.type)) events.push('console.' + m.params.type + ' ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' '));
    else if (m.method === 'Runtime.exceptionThrown') events.push('EXCEPTION ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text).slice(0, 300)); };
  const cdp = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    var IV = setInterval(function () {
      var T = window.THREE; if (!T || !T.Object3D || !T.Object3D.prototype.add) return; clearInterval(IV);
      window.__scenes = [];
      var _add = T.Object3D.prototype.add;
      T.Object3D.prototype.add = function () {
        if (this.isScene && window.__scenes.indexOf(this) < 0) window.__scenes.push(this);
        return _add.apply(this, arguments); };
      var _la = T.Object3D.prototype.lookAt;
      T.Object3D.prototype.lookAt = function () {
        if (this.isPerspectiveCamera && Math.abs(this.far - 2600) < 1) {
          window.__gc = this;
          window.__gcState = { pos: this.position.toArray().map(function (v) { return +v.toFixed(3); }),
                               quat: this.quaternion.toArray().map(function (v) { return +v.toFixed(4); }),
                               far: this.far }; }
        return _la.apply(this, arguments); };
    }, 0);` });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: PAGE });
  const ev = x => cdp('Runtime.evaluate', { expression: x, returnByValue: true })
    .then(r => r.exceptionDetails ? 'EVAL-THREW: ' + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value);
  for (let i = 0; i < 300; i++) { await sleep(400);
    const s = JSON.parse(await ev(`JSON.stringify({c: document.getElementById('enter').className, n: getComputedStyle(document.getElementById('note')).display, t: document.getElementById('note').textContent})`));
    if (s.n !== 'none') { console.log('BOOT FAILED: ' + s.t); process.exit(3); }
    if (/^on$/.test(s.c)) break; }
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1, buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 450, button: 'left', clickCount: 1 });
  await sleep(4000);
  console.log('[scene] dump...');
  const scenes = JSON.parse(await ev(SCENE_JS));
  fs.writeFileSync(path.join(SHOTS, 'scenes.json'), JSON.stringify(scenes, null, 2));
  scenes.forEach(sc => {
    console.log(`scene ${sc.scene}: children=${sc.children} lights=${sc.lights} cams=${sc.cams} IM=${sc.ims.length} Mesh=${sc.meshes.length}`);
    sc.ims.forEach(im => console.log('  IM ' + JSON.stringify(im)));
    sc.meshes.forEach(m => console.log('  MESH ' + JSON.stringify(m)));
  });
  /* strafe direction: hold D, compare the player's world delta with the camera heading */
  const camOf = async () => JSON.parse(await ev(`JSON.stringify(window.__gcState || null)`));
  const g0 = await camOf();
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 });
  await sleep(2500);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 });
  await sleep(300);
  const g1 = await camOf();
  console.log('[cam] D-hold ' + JSON.stringify(g0) + ' -> ' + JSON.stringify(g1));
  if (g0 && g1) {
    const q = g1.quat, fwd = [2 * (q[0] * q[2] + q[3] * q[1]), 2 * (q[1] * q[2] - q[3] * q[0]), -(1 - 2 * (q[0] * q[0] + q[1] * q[1]))];
    const d = [g1.pos[0] - g0.pos[0], g1.pos[2] - g0.pos[2]];
    const dotF = d[0] * fwd[0] + d[1] * fwd[2], dotR = d[0] * -fwd[2] + d[1] * fwd[0];
    console.log(`[strafe] camera forward=(${fwd[0].toFixed(2)}, ${fwd[2].toFixed(2)}) delta=(${d[0].toFixed(3)}, ${d[1].toFixed(3)}) alongFwd=${dotF.toFixed(3)} alongRight=${dotR.toFixed(3)} => ${dotR > 0 ? 'MOVED RIGHT (D=strafe right)' : dotR < 0 ? 'MOVED LEFT (D=strafe LEFT -> keys swapped)' : 'did not move (collision pin / input gate)'}`);
  }
  /* Project every car-body instance into screen space so the screenshot can be
     checked against a car that is provably inside the view frustum. */
  const CAR_JS = `(function () {
    var cam = window.__gc;
    if (!cam) return JSON.stringify({ err: 'no game camera' });
    var v = new THREE.Vector3(), m = new THREE.Matrix4(), hits = [], n = 0;
    window.__scenes.forEach(function (sc) {
      sc.children.forEach(function (o) {
        if (!o.isInstancedMesh || !o.instanceColor) return;
        var vc = o.geometry.attributes.position.count;
        if (vc < 400 || vc > 600 || o.count >= 50) return;
        for (var i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m); n++;
          v.set(m.elements[12], m.elements[13] + 0.7, m.elements[14]);
          var d = v.distanceTo(cam.position);
          v.project(cam);
          if (v.z > 1 || Math.abs(v.x) > 0.85 || Math.abs(v.y) > 0.85) continue;
          hits.push({ d: +d.toFixed(1), x: Math.round((v.x * 0.5 + 0.5) * 1440), y: Math.round((-v.y * 0.5 + 0.5) * 900) });
        }
      });
    });
    hits.sort(function (a, b) { return a.d - b.d; });
    return JSON.stringify({ carInstances: n, inView: hits.length, nearest: hits.slice(0, 6) });
  })()`;
  const cars = JSON.parse(await ev(CAR_JS));
  console.log('[cars] ' + JSON.stringify(cars));
  const shot = async name => { const r = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64')); console.log('shot ' + name); };
  await shot('scene-01');
  console.log('[console] ' + events.length + ' error/warn lines');
  events.slice(0, 10).forEach(e => console.log('  ' + e));
  ws.close(); chrome.kill('SIGKILL'); process.exit(0);
})().catch(e => { console.log('FAILED ' + e.message); events.slice(0, 20).forEach(x => console.log('  ' + x));
  try { chrome.kill('SIGKILL'); } catch (x) {} process.exit(1); });
