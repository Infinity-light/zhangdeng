// 掌灯人 · 掷骰动画。两颗十面骰（十位、个位；有顺势骰/逆势骰时十位多几颗）从屏幕下沿抛进来，
// 落一下、朝屏幕弹起来、再落定，朝上的那一面就是引擎掷出的骰面；然后把读数和成败摆在骰子下面。
// 骰面是引擎定的（可复现、进日志），这里只负责把它「演」出来：轨迹是算好的，不是物理模拟，所以落定的面一定对。
// three.js 放在 /vendor/ 里按需加载；WebGL 起不来、或者系统设了「减少动态效果」，就退回叙述流里那张会滚的牌。
import { sfx } from '/fx.js';

let T = null, loading = null, G = null;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
export function preloadDice() {
  if (still) return Promise.resolve(false);
  if (!loading) loading = import('/vendor/three.module.min.js').then((m) => { T = m; G = setup(); return !!G; }).catch(() => false);
  return loading;
}
export const diceReady = () => !!G;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// 十面骰：五角偏方面体。上下两个尖，中间一圈十个点一高一低；每个面是一只风筝形。
function buildD10() {
  const h = 0.1056, ring = [];
  for (let i = 0; i < 10; i++) { const a = (i * Math.PI) / 5; ring.push(new T.Vector3(Math.cos(a), Math.sin(a), i % 2 ? -h : h)); }
  const top = new T.Vector3(0, 0, 1), bot = new T.Vector3(0, 0, -1); const tri = [], faces = [];
  const face = (apex, a, m, c, flip, value) => {
    if (flip) tri.push(apex, m, a, apex, c, m); else tri.push(apex, a, m, apex, m, c);
    const n = new T.Vector3().subVectors(a, apex).cross(new T.Vector3().subVectors(m, apex)).normalize(); if (flip) n.negate();
    const center = new T.Vector3().addScaledVector(apex, 0.2).addScaledVector(a, 0.27).addScaledVector(c, 0.27).addScaledVector(m, 0.26);
    const up = new T.Vector3().subVectors(apex, m).normalize();
    faces[value] = { n, center, up };
  };
  for (let k = 0; k < 5; k++) {
    face(top, ring[2 * k], ring[2 * k + 1], ring[(2 * k + 2) % 10], false, 2 * k);
    face(bot, ring[2 * k + 1], ring[(2 * k + 2) % 10], ring[(2 * k + 3) % 10], true, 9 - 2 * ((k + 3) % 5));   // 对面相加得 9
  }
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(tri.flatMap((v) => [v.x, v.y, v.z]), 3)); geo.computeVertexNormals();
  return { geo, faces, edges: new T.EdgesGeometry(geo, 1), rest: Math.abs(faces[0].n.dot(ring[0])) };
}
function digitTexture(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 192; const x = c.getContext('2d');
  x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `700 ${text.length > 1 ? 104 : 128}px Georgia, "Times New Roman", "Songti SC", serif`;
  x.fillText(text, 96, 92); if (text === '6' || text === '9') x.fillRect(64, 158, 64, 9);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t;
}
const SKIN = {
  tens: { body: 0xe9dcc0, edge: 0x8d7f63, ink: '#172320', rough: 0.5 },      // 十位：旧骨色，墨字
  units: { body: 0x16474a, edge: 0x7fc4bc, ink: '#f3cf85', rough: 0.34 },    // 个位：深潮色，灯色的字
};
function setup() {
  let ren; const cv = el('canvas', 'cv');
  try { ren = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, powerPreference: 'high-performance' }); } catch { return null; }
  ren.setClearColor(0x000000, 0);
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(32, 1, 10, 6000);
  scene.add(new T.AmbientLight(0xcfe3df, 0.9));
  const key = new T.DirectionalLight(0xffe0ad, 2.6), fill = new T.DirectionalLight(0x8fc7c0, 0.7); scene.add(key, fill);
  const d10 = buildD10(); const tex = { tens: [], units: [] };
  for (let v = 0; v < 10; v++) { tex.tens[v] = digitTexture(v + '0', SKIN.tens.ink); tex.units[v] = digitTexture(String(v), SKIN.units.ink); }
  const sc = document.createElement('canvas'); sc.width = sc.height = 128; const sx = sc.getContext('2d'); const sg = sx.createRadialGradient(64, 64, 4, 64, 64, 64); sg.addColorStop(0, 'rgba(0,0,0,.85)'); sg.addColorStop(0.55, 'rgba(0,0,0,.35)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); sx.fillStyle = sg; sx.fillRect(0, 0, 128, 128);
  const shadowTex = new T.CanvasTexture(sc), plane = new T.PlaneGeometry(1, 1);
  const top = el('div', 'top'), res = el('div', 'res'), root = el('div', 'dicefx'); root.append(el('i', 'sigil'), cv, top, res); /* sigil：骰子底下压着的一枚铜线印 */ document.body.append(root);
  return { ren, scene, cam, key, fill, d10, tex, shadowTex, plane, root, top, res, busy: false };
}
function makeDie(kind, value) {
  const s = SKIN[kind], g = new T.Group();
  const body = new T.Mesh(G.d10.geo, new T.MeshStandardMaterial({ color: s.body, roughness: s.rough, metalness: 0.05, flatShading: true, transparent: true })); g.add(body);
  const line = new T.LineSegments(G.d10.edges, new T.LineBasicMaterial({ color: s.edge, transparent: true, opacity: 0.55 })); line.scale.setScalar(1.002); g.add(line);
  const mats = [body.material, line.material];
  for (let v = 0; v < 10; v++) {
    const f = G.d10.faces[v], m = new T.Mesh(G.plane, new T.MeshBasicMaterial({ map: G.tex[kind][v], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const x = new T.Vector3().crossVectors(f.up, f.n).normalize(); m.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(x, f.up, f.n)); m.position.copy(f.center).addScaledVector(f.n, 0.006); m.scale.setScalar(kind === 'tens' ? 0.66 : 0.6); g.add(m); mats.push(m.material);
  }
  // 落定时的朝向：这一面的法线对着镜头，字大致摆正（留一点歪，像真的）
  const f = G.d10.faces[value], Z = new T.Vector3(0, 0, 1); const q0 = new T.Quaternion().setFromUnitVectors(f.n, Z); const u = f.up.clone().applyQuaternion(q0);
  const target = new T.Quaternion().setFromAxisAngle(Z, Math.PI / 2 + (Math.random() - 0.5) * 0.7 - Math.atan2(u.y, u.x)).multiply(q0);
  const shadow = new T.Mesh(G.plane, new T.MeshBasicMaterial({ map: G.shadowTex, transparent: true, depthWrite: false }));
  const rnd = () => new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
  return { kind, value, g, mats, shadow, target, ax1: rnd(), ax2: rnd(), a1: (5 + Math.random() * 3) * Math.PI * (Math.random() < 0.5 ? -1 : 1), a2: (2.5 + Math.random() * 2) * Math.PI, hit: 0 };
}

const LANDS = [0.2, 0.56, 0.76, 0.9, 1], PEAKS = [0.26, 0.4, 0.11, 0.028, 0.006];   // 各次落地的时刻（占整段的比例）与每一跳的高度（占镜头距离的比例）
function heightAt(s) {
  if (s <= LANDS[0]) { const u = s / LANDS[0]; return PEAKS[0] * (1 - u * u); }       // 从半空落进画面
  for (let i = 1; i < LANDS.length; i++) if (s <= LANDS[i]) { const u = (s - LANDS[i - 1]) / (LANDS[i] - LANDS[i - 1]); return PEAKS[i] * 4 * u * (1 - u); }
  return 0;
}

// d：dice.roll 事件的数据。opts.onLand：落定那一刻（出成败的声音、掉定力的红边）；opts.hold：读数停留的毫秒数。
// 返回的 Promise 在整段演完、遮罩退掉之后兑现；演不了时兑现为 false。
export function rollDice3D(d, opts = {}) {
  if (!G || G.busy || document.hidden) return Promise.resolve(false);
  G.busy = true;
  const W = innerWidth, H = innerHeight, { ren, scene, cam, root } = G;
  ren.setPixelRatio(Math.min(devicePixelRatio || 1, 3)); ren.setSize(W, H, false);
  cam.aspect = W / H; const dist = H / 2 / Math.tan((cam.fov * Math.PI) / 360); cam.position.set(0, 0, dist); cam.near = dist * 0.05; cam.far = dist * 3; cam.updateProjectionMatrix();
  G.key.position.set(-W * 0.5, H * 0.7, dist * 0.9); G.fill.position.set(W * 0.8, -H * 0.3, dist * 0.5);
  const tens = d.dice?.tens?.length ? d.dice.tens : [Math.floor((d.value % 100) / 10)], units = d.dice?.units ?? d.value % 10;
  const keepT = Math.floor((d.value % 100) / 10); let kept = false;
  const dice = [...tens.map((t) => { const x = makeDie('tens', t); x.drop = kept || t !== keepT; if (!x.drop) kept = true; return x; }), makeDie('units', units)];
  const n = dice.length, r = Math.max(30, Math.min(72, Math.min(W, H) * 0.15)) * (n > 2 ? 0.84 : 1), gap = r * 2.55, cy = H * 0.085, rest = G.d10.rest * r;
  dice.forEach((x, i) => {
    x.g.scale.setScalar(r); x.to = new T.Vector3((i - (n - 1) / 2) * gap + (Math.random() - 0.5) * r * 0.3, cy + (Math.random() - 0.5) * r * 0.5, rest);
    x.from = new T.Vector3(x.to.x * 0.2 + (Math.random() - 0.5) * W * 0.5, -H / 2 - r * 2.4, rest); x.delay = i * 0.07 + Math.random() * 0.03;
    scene.add(x.g, x.shadow);
  });
  const ok = !!d.success, crit = d.level === 'crit' || /大成功/.test(d.levelName || ''), fumble = d.level === 'fumble' || /大失败/.test(d.levelName || '');
  root.className = 'dicefx on ' + (crit ? 'crit' : ok ? 'ok' : fumble ? 'no fumble' : 'no') + (opts.loss ? ' hurt' : '');
  G.top.replaceChildren(el('b', '', d.label || ''), el('span', '', opts.sub || ''));
  G.res.replaceChildren(el('b', 'v', String(d.value).padStart(2, '0')), el('i', '', d.levelName || ''), opts.loss ? el('span', 'loss', opts.loss) : '');
  sfx('shake');
  const ROLL = 1.55, PRE = 0.32, HOLD = (opts.hold ?? 1150) / 1000, OUT = 0.4; let t0 = null, landed = false, skip = false, done;
  const finish = new Promise((r2) => { done = r2; });
  const onSkip = () => { skip = true; }; root.addEventListener('pointerdown', onSkip);
  const q = new T.Quaternion(), q1 = new T.Quaternion();
  function frame(now) {
    if (t0 == null) t0 = now; let t = (now - t0) / 1000 - PRE;
    if (skip && !landed) { t0 = now - (PRE + ROLL + 0.2) * 1000; t = ROLL + 0.2; }
    for (const x of dice) {
      const s = Math.max(0, Math.min(1, (t - x.delay) / ROLL)), e = 1 - Math.pow(1 - s, 3.2), z = heightAt(s) * dist;
      x.g.position.lerpVectors(x.from, x.to, e); x.g.position.z = rest + z;
      const k = (1 - s) * (1 - s); q.setFromAxisAngle(x.ax1, x.a1 * k); q1.setFromAxisAngle(x.ax2, x.a2 * k * (1 - s)); x.g.quaternion.copy(x.target).multiply(q).multiply(q1);
      const sh = 1 + (z / dist) * 3.2; x.shadow.position.set(x.g.position.x + z * 0.12, x.g.position.y - z * 0.16, 0.5); x.shadow.scale.setScalar(r * 2.7 * sh); x.shadow.material.opacity = (s > 0.02 ? 0.6 : 0) / sh;
      while (x.hit < LANDS.length - 1 && s >= LANDS[x.hit]) { if (!skip) sfx('land', 0, (x === dice[0] ? 1 : 0.7) * [1, 0.62, 0.34, 0.16][x.hit]); x.hit++; }
    }
    const tl = t - ROLL - dice[n - 1].delay;
    if (tl >= 0 && !landed) { landed = true; root.classList.add('landed'); try { opts.onLand?.(); } catch { /* 声音出不来不影响 */ } }
    if (landed) {
      const pop = Math.max(0, 1 - tl / 0.3); for (const x of dice) { x.g.scale.setScalar(r * (1 + (x.drop ? 0 : 0.14) * Math.sin(pop * Math.PI))); if (x.drop) { const o = Math.max(0.28, 1 - tl / 0.25); for (const m of x.mats) m.opacity = (m.isLineBasicMaterial ? 0.55 : 1) * o; } }
      const hold = skip ? Math.min(HOLD, 0.35) : HOLD;
      if (tl > hold && !root.classList.contains('out')) root.classList.add('out');
      if (tl > hold + OUT) { cleanup(); return; }
    }
    ren.render(scene, cam); requestAnimationFrame(frame);
  }
  function cleanup() {
    root.removeEventListener('pointerdown', onSkip); root.className = 'dicefx';
    for (const x of dice) { scene.remove(x.g, x.shadow); for (const m of x.mats) m.dispose(); x.shadow.material.dispose(); }
    ren.clear(); G.busy = false; done(true);
  }
  requestAnimationFrame(frame);
  // 标签页被切到后台时 rAF 会停：别让叙述流一直等着
  const guard = setInterval(() => { if (!G.busy) return clearInterval(guard); if (document.hidden) { clearInterval(guard); if (!landed) { landed = true; try { opts.onLand?.(); } catch { /* 同上 */ } } cleanup(); } }, 500);
  return finish;
}
