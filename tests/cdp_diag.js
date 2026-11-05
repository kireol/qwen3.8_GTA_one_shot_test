/* Lighting diagnostic: exposes the live scene via a render hook, dumps lights and
   materials, then A/B-screenshots the suspects (AO multiply mesh / shadows /
   ambient / environment). Harness only — city.html is not modified. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = 'file://' + path.resolve(__dirname, '..', 'src', 'city.html');
const PORT = 9334;
const SHOTS = path.join(__dirname, 'out', 'city_diag');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-diag-'));
fs.mkdirSync(SHOTS, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=1440,900', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--mute-audio', '--disable-background-timer-throttling', 'about:blank'],
  { stdio: ['ignore', fs.openSync(SHOTS + '/chrome.log', 'w'), fs.openSync(SHOTS + '/chrome.log', 'w')] });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

(async () => {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(250);
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch (e) {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error'))
      errors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
    else if (m.method === 'Runtime.exceptionThrown')
      errors.push('EXC ' + JSON.stringify(m.params.exceptionDetails && m.params.exceptionDetails.exception));
  };
  const cdp = (method, params) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await cdp('Runtime.enable'); await cdp('Log.enable'); await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    /* The game builds its renderer synchronously in the first boot rung, so the
       constructor can never be wrapped from here. Instead hook prototype methods
       that are only reached later, once THREE exists and the ladder has yielded:
       Object3D.add (the first light added to a scene reveals the real scene),
       PMREMGenerator.fromScene (holds the renderer), Object3D.lookAt (per frame). */
    var IV = setInterval(function () {
      var T = window.THREE;
      if (!T || !T.Object3D || !T.PMREMGenerator || !T.Object3D.prototype.add) return;
      clearInterval(IV);
      var _add = T.Object3D.prototype.add;
      T.Object3D.prototype.add = function () {
        if (!window.__sc && this.isScene) {
          for (var i = 0; i < arguments.length; i++)
            if (arguments[i] && arguments[i].isLight) { window.__sc = this; break; }
        }
        return _add.apply(this, arguments);
      };
      var _fs = T.PMREMGenerator.prototype.fromScene;
      T.PMREMGenerator.prototype.fromScene = function () {
        window.__r = this._renderer;
        return _fs.apply(this, arguments);
      };
      var _la = T.Object3D.prototype.lookAt;
      T.Object3D.prototype.lookAt = function () {
        /* the camera looks every frame: apply any diagnostic override afterwards,
           since the sim rewrites the lights earlier in the same frame */
        if (this.isCamera) { window.__cam = this; if (window.__ov && window.__sc) { try { window.__ov(window.__sc, this); } catch (e) { window.__ovErr = String(e); } } }
        return _la.apply(this, arguments);
      };
      window.__hooked = true;
    }, 0);
  ` });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: PAGE });
  const ev = (expr) => cdp('Runtime.evaluate', { expression: expr, returnByValue: true })
    .then(r => r.exceptionDetails ? 'EVAL-ERR ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text) : r.result.value);
  const shot = async n => {
    const b = Buffer.from((await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
    fs.writeFileSync(path.join(SHOTS, n + '.png'), b);
    console.log(`  shot ${n}.png ${b.length}B ${crypto.createHash('md5').update(b).digest('hex').slice(0, 8)}`);
  };
  for (let i = 0; i < 300; i++) { await sleep(400);
    const d = await ev(`document.getElementById('enter').className + '|' + getComputedStyle(document.getElementById('note')).display`);
    if (/\|block/.test(d)) { console.log('BUILD ERROR: ' + await ev(`document.getElementById('note').textContent`)); process.exit(3); }
    if (/^on\|/.test(d)) break; }
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1, buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 450, button: 'left', clickCount: 1 });
  await sleep(2500);
  console.log('hooks:', await ev(`JSON.stringify({hooked:!!window.__hooked, sc:!!window.__sc, cam:!!window.__cam, r:!!window.__r})`));

  console.log('\n===== RENDERER / SCENE =====');
  console.log(await ev(`(function(){
    var r = window.__r, s = window.__sc, o = {};
    o.renderer = { toneMapping: r.toneMapping, exposure: r.toneMappingExposure, outputEncoding: r.outputEncoding,
      shadowEnabled: r.shadowMap.enabled, shadowType: r.shadowMap.type, autoUpdate: r.shadowMap.autoUpdate,
      pixelRatio: r.getPixelRatio(), size: r.getSize(new THREE.Vector2()).toArray(),
      calls: r.info.render.calls, tris: r.info.render.triangles, geoms: r.info.memory.geometries, progs: r.info.programs.length };
    o.fog = s.fog ? { type: s.fog.type, density: +s.fog.density.toFixed(5), color: s.fog.color.getHexString() } : null;
    o.environment = !!s.environment;
    o.lights = [];
    s.traverse(function (n) {
      if (!n.isLight) return;
      var L = { type: n.type, name: n.name, intensity: +n.intensity.toFixed(3), visible: n.visible,
                color: n.color ? n.color.getHexString() : null, castShadow: !!n.castShadow,
                pos: n.position.toArray().map(function(v){return +v.toFixed(1);}) };
      if (n.shadow) { var c = n.shadow.camera;
        L.shadow = { bias: n.shadow.bias, normalBias: n.shadow.normalBias, radius: n.shadow.radius,
          mapSize: n.shadow.mapSize.toArray(), cam: [c.left, c.right, c.top, c.bottom, c.near, c.far].map(Number),
          hasMap: !!n.shadow.map, frameExt: (n.shadow._frameExtents || []).slice ? undefined : undefined };
      }
      if (n.colorTop) L.hemi = [n.color.getHexString(), n.groundColor.getHexString()];
      o.lights.push(L);
    });
    o.camPos = window.__cam.position.toArray().map(function(v){return +v.toFixed(2);});
    o.camFov = +window.__cam.fov.toFixed(1);
    o.nMesh = 0; s.traverse(function(n){ if (n.isMesh) o.nMesh++; });
    return JSON.stringify(o, null, 1);
  })()`));

  console.log('\n===== KEY MATERIALS =====');
  console.log(await ev(`(function(){
    var out = {};
    window.__sc.traverse(function (n) {
      if (!n.isMesh || !n.material || !n.material.isMeshStandardMaterial) return;
      var key = n.name || n.material.name || (n.material.type + ':' + (n.geometry.attributes.color ? 'vc' : 'novc'));
      if (out[key]) return;
      var m = n.material;
      out[key] = { color: m.color.getHexString(), vertexColors: !!m.vertexColors, env: m.envMapIntensity,
        rough: m.roughness, metal: m.metalness, emissive: m.emissiveIntensity,
        map: m.map ? (m.map.encoding === 3001 ? 'sRGB' : 'linear') : null,
        geomColorStats: (function(){ var a = n.geometry.attributes.color; if (!a) return null;
          var mn = [1,1,1], mx = [0,0,0], i, j, v;
          for (i = 0; i < a.count; i++) for (j = 0; j < 3; j++) { v = a.array[i*3+j]; if (v<mn[j]) mn[j]=v; if (v>mx[j]) mx[j]=v; }
          return { min: mn.map(function(x){return +x.toFixed(2);}), max: mx.map(function(x){return +x.toFixed(2);}) }; })() };
    });
    return JSON.stringify(out, null, 1);
  })()`));

  console.log('\n===== A/B TESTS (each reverts after the shot) =====');
  const ab = async (label, setup, teardown) => {
    console.log(`\n-- ${label}`);
    console.log('   ' + await ev(setup));
    await sleep(1200); await shot(label.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
    if (teardown) await ev(teardown);
    await sleep(500);
  };
  const off = `(function(){window.__ov=null;return 'override cleared';})()`;
  const ov = body => `(function(){window.__ov=${body};return 'override installed';})()`;
  await ab('BASELINE', `(function(){return 'ok';})()`);
  await ab('A-no-ao', ov(`function(s){var a=s.getObjectByName('ao'); if(a)a.visible=false;}`), off);
  await ab('B-sun-no-castshadow', ov(`function(s){s.traverse(function(n){if(n.isDirectionalLight&&n.castShadow)n.castShadow=false;});}`), off);
  await ab('C-amb-hemi-up', ov(`function(s){s.traverse(function(n){if(n.isAmbientLight)n.intensity*=3;else if(n.isHemisphereLight)n.intensity*=2.2;});}`), off);
  await ab('D-no-environment', ov(`function(s){if(!window.__holdEnv)window.__holdEnv=s.environment;s.environment=null;}`),
    `(function(){window.__ov=null;if(window.__holdEnv)window.__sc.environment=window.__holdEnv;return 'env restored';})()`);
  await ab('E-exposure-2x', `(function(){window.__r.toneMappingExposure=2.2;return 'exposure 2.2';})()`, `(function(){window.__r.toneMappingExposure=1.05;return 'reverted';})()`);
  await ab('F-sun-overhead', ov(`function(s){s.traverse(function(n){if(n.isDirectionalLight&&n.castShadow){n.position.set(n.target.position.x,120,n.target.position.z);n.intensity=2.0;}});}`), off);
  await ab('G-no-fog', ov(`function(s){s.fog.density=0.0;}`), off);
  await sleep(900); await shot('H-final-baseline');
  console.log('override errors:', await ev(`window.__ovErr||'none'`));
  console.log('\nerrors: ' + errors.length);
  errors.slice(0, 8).forEach(e => console.log('  ' + e));
  ws.close(); chrome.kill('SIGKILL'); process.exit(0);
})().catch(e => { console.log('DIAG FAILED ' + e.message); try { chrome.kill('SIGKILL'); } catch (x) {} process.exit(1); });
