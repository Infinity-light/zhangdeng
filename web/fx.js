// 掌灯人 · 声音。三层：
//   配乐   三首现成的曲子（Kevin MacLeod，CC BY 4.0，见 /audio/来源.md），按夜的深浅换曲，交叉淡入淡出；
//   音效   骰子、翻页、脚步、钟这些是真实录音的采样（Kenney，CC0）；提示音（成功、线索的磬、掉定力的闷响）仍是现场合成的；
//   海声   现场合成的底噪。
// 第一次点按之后才会出声（浏览器不允许不经手势出声）。「⋯」里可以分别关掉配乐、或者整个静音。
let ac = null, out = null, seaBus = null, musicBus = null, on = true, musicOn = true;
const flag = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? String(d)); } catch { return d; } };
on = flag('zd.sound', true); musicOn = flag('zd.music', true);

// ---------- 采样
const SAMPLE_NAMES = ['shake1', 'shake2', 'throw1', 'throw2', 'die1', 'die2', 'die3', 'place', 'slide', 'flip1', 'flip2', 'door', 'latch', 'coins', 'cloth', 'creak', 'step1', 'step2', 'step3', 'step4', 'bell1', 'bell2', 'thump', 'wood'];
const SAMPLES = {}; let samplesAsked = false;
function loadSamples() {
  if (samplesAsked || !ac) return; samplesAsked = true;
  for (const n of SAMPLE_NAMES) fetch(`/audio/sfx/${n}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((b) => new Promise((ok, no) => ac.decodeAudioData(b, ok, no))).then((buf) => { SAMPLES[n] = buf; }).catch(() => { /* 这一声退回合成 */ });
}
const smp = (name, t, vol = 1, rate = 1) => { const b = SAMPLES[name]; if (!b) return false; const s = ac.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; const g = ac.createGain(); g.gain.value = vol; s.connect(g); g.connect(out); s.start(t); return true; };
const pick = (...names) => names[Math.floor(Math.random() * names.length)];

function ensure() {
  if (ac) return ac;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  ac = new AC(); out = ac.createGain(); out.gain.value = on ? 1 : 0; out.connect(ac.destination);
  musicBus = ac.createGain(); musicBus.gain.value = musicOn ? 1 : 0; musicBus.connect(out);
  // 海：棕噪声过低通，音量跟着两条很慢的波起伏
  const len = ac.sampleRate * 4, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0); let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
  seaBus = ac.createGain(); seaBus.gain.value = 0.0;
  const swell = ac.createGain(); swell.gain.value = 0.5;
  for (const [f, depth] of [[0.11, 0.34], [0.047, 0.2]]) { const lfo = ac.createOscillator(), g = ac.createGain(); lfo.frequency.value = f; g.gain.value = depth; lfo.connect(g); g.connect(swell.gain); lfo.start(); }
  src.connect(lp); lp.connect(swell); swell.connect(seaBus); seaBus.connect(out); src.start();
  seaBus.gain.linearRampToValueAtTime(0.42, ac.currentTime + 4);
  loadSamples();
  return ac;
}
export function unlock() { const a = ensure(); if (a && a.state === 'suspended') a.resume(); primeMusic(); }
export const soundOn = () => on;
export function setSound(v) { on = !!v; try { localStorage.setItem('zd.sound', JSON.stringify(on)); } catch { /* 存不下就算了 */ } if (ac) out.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 0.08); else if (on) unlock(); }
// 室内场景把海压低一点
export function ambience(level) { if (ac && seaBus) seaBus.gain.setTargetAtTime(level, ac.currentTime, 1.2); }

// ---------- 配乐
const TRACKS = {
  explore: { src: '/audio/music/myst-on-the-moor.mp3', vol: 0.34 },   // 上岸、打听、翻东西
  tense: { src: '/audio/music/lightless-dawn.mp3', vol: 0.5 },        // 夜深了、起雾以后
  ending: { src: '/audio/music/decline.mp3', vol: 0.6 },              // 收团
};
// 两个播放位轮流用：一个放着，换曲时另一个淡进来。只下载正在放的那一首——
// 之前是三首一起起播再停住，进桌面的头几秒它们和页面抢网，慢的网络上此地的信息要等好几秒才出来。
const slots = []; let want = null, primed = false, cur = -1;
function slot(i) {
  if (slots[i]) return slots[i];
  const el = new Audio(); el.loop = true; el.preload = 'none';
  const p = { el, gain: null, name: null, vol: 0, fade: null, stop: null };
  try { const node = ac.createMediaElementSource(el); p.gain = ac.createGain(); p.gain.gain.value = 0; node.connect(p.gain); p.gain.connect(musicBus); } catch { el.volume = 0; }
  return (slots[i] = p);
}
const setVol = (p, v, sec) => {
  if (p.gain) { p.gain.gain.cancelScheduledValues(ac.currentTime); p.gain.gain.setTargetAtTime(v, ac.currentTime, sec / 3); return; }
  clearInterval(p.fade); const from = p.el.volume, t0 = performance.now(); const to = on && musicOn ? v : 0;   // 接不进 WebAudio 的浏览器：直接调元素的音量
  p.fade = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / (sec * 1000)); p.el.volume = from + (to - from) * k; if (k >= 1) clearInterval(p.fade); }, 60);
};
const hush = (p) => { setVol(p, 0, 2.4); clearTimeout(p.stop); p.stop = setTimeout(() => p.el.pause(), 4200); };
function applyMusic() {
  if (!ac || !primed) return;
  const now = cur >= 0 ? slots[cur] : null;
  if (!want || !musicOn) { for (const p of slots) if (p) hush(p); return; }
  if (now && now.name === want) { clearTimeout(now.stop); if (now.el.paused) now.el.play().catch(() => { primed = false; }); setVol(now, now.vol, 3); return; }
  if (now) hush(now);
  cur = cur === 0 ? 1 : 0; const p = slot(cur); clearTimeout(p.stop); p.name = want; p.vol = TRACKS[want].vol; p.el.src = TRACKS[want].src;
  const go = p.el.play(); if (go?.catch) go.catch(() => { /* 还没有手势：下一次点按时再起 */ primed = false; cur = cur === 0 ? 1 : 0; });
  setVol(p, p.vol, 3);
}
// 手势里调用：把要放的那一首真正放起来；另一个播放位也在这次手势里碰一下（iOS 上元素要在手势里起过一次，之后换曲才肯放）
function primeMusic() {
  if (primed || !ac) return; primed = true; applyMusic();
  if (musicOn && want) { const other = slot(cur === 0 ? 1 : 0); if (!other.name) { other.el.src = TRACKS[want].src; const r = other.el.play(); if (r?.then) r.then(() => { if (slots[cur] !== other) other.el.pause(); }).catch(() => {}); } }
}
// 换曲：'explore' | 'tense' | 'ending' | null（停）。还没出过声时只记下来，等第一次点按。
export function music(name) { const n = name && TRACKS[name] ? name : null; if (n === want) return; want = n; applyMusic(); }
export const musicIsOn = () => musicOn;
export function setMusic(v) { musicOn = !!v; try { localStorage.setItem('zd.music', JSON.stringify(musicOn)); } catch { /* 存不下就算了 */ } if (!ac) { if (musicOn) unlock(); return; } musicBus.gain.setTargetAtTime(musicOn ? 1 : 0, ac.currentTime, 0.2); applyMusic(); if (seaBus) seaBus.gain.setTargetAtTime(0.42, ac.currentTime, 1); }

// ---------- 合成的提示音
const tone = (type, f0, f1, t0, dur, vol, dest) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.connect(g); g.connect(dest || out); o.start(t0); o.stop(t0 + dur + 0.05); };
const noise = (t0, dur, freq, q, vol, type = 'bandpass') => { const n = Math.ceil(ac.sampleRate * dur), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; const s = ac.createBufferSource(); s.buffer = b; const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = ac.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); s.connect(f); f.connect(g); g.connect(out); s.start(t0); };

const SFX = {
  tap: (t) => { noise(t, 0.03, 2600, 2, 0.05); smp('place', t, 0.16, 1.5); },
  // 把话递出去：纸在桌上一推
  send: (t) => { if (!smp('slide', t, 0.42)) noise(t, 0.12, 1400, 1, 0.06); },
  // 骰子在手里晃
  shake: (t) => { if (!smp(pick('shake1', 'shake2'), t, 0.6, 1.15)) for (let i = 0; i < 6; i++) noise(t + i * 0.07, 0.03, 2200 + Math.random() * 1200, 3, 0.08); },
  // 骰子落在木头上。strength 1 = 第一下，越往后越轻
  land: (t, strength = 1) => { const ok = strength > 0.75 ? smp(pick('throw1', 'throw2'), t, 0.95) : smp(pick('die1', 'die2', 'die3'), t, 0.25 + strength * 0.6, 1 + (1 - strength) * 0.3); if (!ok) { noise(t, 0.035, 1800 + Math.random() * 1600, 3, 0.2 * strength); tone('sine', 240, 180, t, 0.05, 0.06 * strength); } },
  // 旧的一整串滚动声（3D 骰子出不来时用）
  dice: (t) => { if (smp(pick('throw1', 'throw2'), t + 0.05, 0.9)) { smp(pick('die1', 'die2'), t + 0.42, 0.5); return; } let x = 0; for (let i = 0; i < 9; i++) { x += 0.045 + i * 0.012; noise(t + x, 0.035, 1800 + Math.random() * 1600, 3, 0.16); tone('sine', 240 - i * 8, 180, t + x, 0.05, 0.05); } },
  ok: (t) => { tone('triangle', 392, 392, t, 0.2, 0.09); tone('triangle', 587, 587, t + 0.1, 0.5, 0.08); tone('sine', 1174, 1174, t + 0.1, 0.7, 0.025); },
  crit: (t) => { for (const [i, f] of [392, 494, 587, 784, 1175].entries()) { tone('triangle', f, f, t + i * 0.08, 0.7, 0.075); tone('sine', f * 2, f * 2, t + i * 0.08, 0.9, 0.02); } },
  fail: (t) => { tone('sine', 150, 92, t, 0.6, 0.2); noise(t, 0.12, 300, 1, 0.1, 'lowpass'); smp('wood', t, 0.5, 0.7); },
  // 线索：翻过一页，一声很轻的磬
  clue: (t) => { smp('flip1', t, 0.6); for (const [f, v] of [[784, 0.08], [1176, 0.04], [1568, 0.024]]) tone('sine', f, f, t + 0.12, 1.8, v); },
  item: (t) => { smp('coins', t, 0.4); },
  // 定力掉了：胸口闷的两下，底下垫一条往下走的低音
  mind: (t) => { tone('sawtooth', 62, 48, t, 1.8, 0.07); for (const dt of [0, 0.26, 0.9, 1.16]) { tone('sine', 70, 44, t + dt, 0.2, 0.3); smp('thump', t + dt, dt === 0 || dt === 0.9 ? 0.55 : 0.34, 0.8); } },
  // 换场：几步脚步，一阵风
  scene: (t) => { noise(t, 1.1, 500, 0.7, 0.09, 'lowpass'); tone('sine', 98, 98, t, 1.4, 0.04); ['step1', 'step3', 'step2', 'step4'].forEach((n, i) => smp(n, t + 0.1 + i * 0.34, 0.3 - i * 0.04, 0.92)); },
  omen: (t) => { tone('sine', 110, 104, t, 2.4, 0.1); tone('sine', 164.8, 160, t, 2.4, 0.045); smp('creak', t + 0.1, 0.3, 0.6); },
  // 钟：真钟的一声放慢，底下垫几个不成谐的分音，拖得很长
  bell: (t) => { smp('bell2', t, 0.8, 0.5); smp('bell1', t + 0.04, 0.4, 0.25); for (const [f, v, d] of [[147, 0.16, 5], [294 * 1.19, 0.08, 3.4], [441 * 1.26, 0.05, 2.2], [588 * 1.5, 0.03, 1.4]]) tone('sine', f, f * 0.995, t, d, v); noise(t, 0.05, 900, 1, 0.12); },
  lamp: (t) => { if (!smp('latch', t, 0.4)) noise(t, 0.02, 3200, 4, 0.1); tone('sine', 520, 700, t + 0.02, 0.5, 0.03); },
  page: (t) => { smp('flip2', t, 0.5); },
};
export function sfx(name, delay = 0, arg) { if (!on) return; const a = ensure(); if (!a || a.state !== 'running' || !SFX[name]) return; try { SFX[name](a.currentTime + delay, arg); } catch { /* 出不了声不影响玩 */ } }
// 页面上第一次点按就把声音打开（浏览器不允许不经手势出声）
addEventListener('pointerdown', () => { if (on && (!ac || ac.state !== 'running' || !primed)) unlock(); }, { capture: true });
// 切到后台：把配乐停住，回来再接上
document.addEventListener('visibilitychange', () => { if (!ac) return; if (document.hidden) { for (const p of slots) if (p) p.el.pause(); } else applyMusic(); });
