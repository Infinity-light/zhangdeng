// 背景：一幅雾夜的海与灯塔（底图），加上实时画的光束、流动的雾和水面碎光。
// 底图加载失败时退回纯代码画的剪影。sea.beam 是光束此刻扫到的横向位置（0–1），首屏文字的明暗跟着它走。
export const sea = { beam: 0.5, dim: 0 };
const LAMP = { x: 0.7635, y: 0.386 };        // 灯在底图里的位置（比例）
const IMG = { w: 1586, h: 992 };
const TALL = { x: 0.662, y: 0.215, w: 941, h: 1672, hz: 0.43 };   // 竖屏用另一张竖构图的底图：灯塔在上，下半是海，字和按钮压在海上

export function startSea(cv) {
  const cx = cv.getContext('2d'); let W, H, D;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const img = new Image(); let ready = false; img.onload = () => { ready = true; }; img.src = '/img/hero.webp';
  const imgT = new Image(); let readyT = false; imgT.onload = () => { readyT = true; }; if (innerHeight > innerWidth) imgT.src = '/img/hero-tall.webp'; else addEventListener('resize', () => { if (!imgT.src && innerHeight > innerWidth) imgT.src = '/img/hero-tall.webp'; });
  const fit = () => { D = Math.min(devicePixelRatio || 1, 2); W = cv.width = innerWidth * D; H = cv.height = innerHeight * D; };
  addEventListener('resize', fit); fit();
  const off = document.createElement('canvas'), ox = off.getContext('2d');
  const fogs = Array.from({ length: 8 }, (_, i) => ({ x: Math.random(), y: 0.5 + Math.random() * 0.42, r: 0.28 + Math.random() * 0.36, v: (0.004 + Math.random() * 0.006) * (i % 3 ? 1 : -1), a: 0.035 + Math.random() * 0.05 }));

  function frame(t) {
    const T = still ? 9000 : t;
    // 底图按「盖满」铺，并保证灯塔留在画面里（竖屏时把灯放在偏右 68% 处）
    const tall = H > W; const useT = tall && readyT; const L = useT ? TALL : { x: LAMP.x, y: LAMP.y, w: IMG.w, h: IMG.h, hz: 0.64 };
    const sc = useT ? Math.max(W / L.w, H / L.h) : Math.max(W / IMG.w, (tall ? 0.8 : 1) * H / IMG.h), iw = L.w * sc, ih = L.h * sc;
    const wantX = (useT ? 0.64 : tall ? 0.7 : LAMP.x) * W; const dx = Math.min(0, Math.max(W - iw, wantX - L.x * iw)); const dy = tall ? 0 : Math.min(0, Math.max(H - ih, (H - ih) * 0.45));
    const lx = dx + L.x * iw, ly = dy + L.y * ih, hz = dy + L.hz * ih;
    if (useT || ready) {
      cx.fillStyle = '#070d0e'; cx.fillRect(0, 0, W, H); cx.drawImage(useT ? imgT : img, dx, dy, iw, ih);
      if (dy + ih < H) { const sm = cx.createLinearGradient(0, dy + ih * 0.8, 0, dy + ih); sm.addColorStop(0, 'rgba(7,13,14,0)'); sm.addColorStop(1, 'rgba(7,13,14,1)'); cx.fillStyle = sm; cx.fillRect(0, dy + ih * 0.8, W, ih * 0.2 + 2); }
    }
    else {
      const sky = cx.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, '#060c0e'); sky.addColorStop(1, '#12211f'); cx.fillStyle = sky; cx.fillRect(0, 0, W, hz);
      const sg = cx.createLinearGradient(0, hz, 0, H); sg.addColorStop(0, '#0f1d1c'); sg.addColorStop(1, '#070d0e'); cx.fillStyle = sg; cx.fillRect(0, hz, W, H - hz);
      cx.fillStyle = '#050a0b'; const tw = Math.max(9 * D, H * 0.016);
      cx.beginPath(); cx.moveTo(lx - W * 0.2, hz + 2); cx.quadraticCurveTo(lx, hz - H * 0.06, W, hz - H * 0.02); cx.lineTo(W, hz + 2); cx.fill();
      cx.beginPath(); cx.moveTo(lx - tw, hz - H * 0.03); cx.lineTo(lx - tw * 0.6, ly); cx.lineTo(lx + tw * 0.6, ly); cx.lineTo(lx + tw, hz - H * 0.03); cx.fill();
    }
    // 光束：慢慢地在左侧的海面与雾之间来回扫。三层楔形叠出软边。
    const ph = (Math.sin(T / 5600) + 1) / 2; const ang = Math.PI * (0.83 + ph * 0.25); sea.beam = 1 - ph;
    const len = Math.hypot(W, H) * 1.15;
    // 光束画在半分辨率的离屏画布上：角向用锥形渐变做软边，径向再乘一层衰减
    const bw = off.width = Math.ceil(W / 2), bh = off.height = Math.ceil(H / 2), bx = lx / 2, by = ly / 2;
    const spread = 0.2; const cg = ox.createConicGradient ? ox.createConicGradient(ang - spread, bx, by) : null;
    if (cg) {
      const f = (2 * spread) / (2 * Math.PI);
      cg.addColorStop(0, 'rgba(240,200,120,0)'); cg.addColorStop(f * 0.3, 'rgba(240,200,120,.10)'); cg.addColorStop(f * 0.46, 'rgba(246,208,132,.34)'); cg.addColorStop(f * 0.5, 'rgba(255,224,160,.5)'); cg.addColorStop(f * 0.54, 'rgba(246,208,132,.34)'); cg.addColorStop(f * 0.7, 'rgba(240,200,120,.10)'); cg.addColorStop(f, 'rgba(240,200,120,0)'); cg.addColorStop(1, 'rgba(240,200,120,0)');
      ox.globalCompositeOperation = 'source-over'; ox.clearRect(0, 0, bw, bh); ox.fillStyle = cg; ox.fillRect(0, 0, bw, bh);
      const rg = ox.createRadialGradient(bx, by, 0, bx, by, len / 2); rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(0.2, 'rgba(0,0,0,.6)'); rg.addColorStop(0.65, 'rgba(0,0,0,.26)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ox.globalCompositeOperation = 'destination-in'; ox.fillStyle = rg; ox.fillRect(0, 0, bw, bh);
    }
    cx.save(); cx.globalCompositeOperation = 'screen';
    if (cg) cx.drawImage(off, 0, 0, W, H);
    // 光束压到水面上的那一条碎光
    if (Math.sin(ang) > 0.02) {
      const reach = (hz - ly) / Math.sin(ang); const wx = lx + Math.cos(ang) * reach;      // 光束中线与海平线的交点
      for (let i = 0; i < 40; i++) {
        const k = i / 40, px = wx + (wx - lx) * k * 0.55 + Math.sin(T / 650 + i * 1.9) * 16 * D * (0.3 + k), py = hz + 6 * D + k * k * (H - hz) * 0.95;
        const w = (26 + 190 * k) * D * (0.55 + 0.45 * Math.sin(T / 380 + i * 1.3)); cx.fillStyle = `rgba(240,205,140,${0.1 * (1 - k * 0.6)})`; cx.fillRect(px - w / 2, py, w, Math.max(1, 1.3 * D));
      }
    }
    // 灯芯一明一暗
    const fl = 0.75 + 0.25 * Math.sin(T / 900) * Math.sin(T / 370); const lg = cx.createRadialGradient(lx, ly, 0, lx, ly, H * 0.09); lg.addColorStop(0, `rgba(255,225,160,${0.5 * fl})`); lg.addColorStop(1, 'rgba(232,182,90,0)'); cx.fillStyle = lg; cx.beginPath(); cx.arc(lx, ly, H * 0.09, 0, 7); cx.fill();
    cx.restore();
    // 雾
    for (const f of fogs) {
      if (!still) f.x += f.v / 60; if (f.x > 1.4) f.x = -0.4; if (f.x < -0.4) f.x = 1.4;
      const fx = f.x * W, fy = f.y * H, fr = f.r * Math.max(W, H * 0.8); const fg = cx.createRadialGradient(fx, fy, 0, fx, fy, fr); fg.addColorStop(0, `rgba(150,176,172,${f.a})`); fg.addColorStop(1, 'rgba(150,176,172,0)');
      cx.fillStyle = fg; cx.save(); cx.translate(fx, fy); cx.scale(1, 0.3); cx.translate(-fx, -fy); cx.beginPath(); cx.arc(fx, fy, fr, 0, 7); cx.fill(); cx.restore();
    }
    // 左下压暗，让标题站得住
    const vg = cx.createLinearGradient(0, H * 0.35, 0, H); vg.addColorStop(0, 'rgba(8,14,16,0)'); vg.addColorStop(1, 'rgba(8,14,16,.62)'); cx.fillStyle = vg; cx.fillRect(0, H * 0.35, W, H * 0.65);
    if (sea.dim) { cx.fillStyle = `rgba(11,20,22,${sea.dim})`; cx.fillRect(0, 0, W, H); }
    const lit = document.querySelectorAll('.lit'); if (lit.length) { const pct = `${(4 + sea.beam * 88).toFixed(1)}%`; for (const el of lit) el.style.setProperty('--bx', pct); }
    if (still) return;
    if (document.hidden) setTimeout(() => requestAnimationFrame(frame), 600); else requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (still) { addEventListener('resize', () => requestAnimationFrame(frame)); img.addEventListener('load', () => requestAnimationFrame(frame)); setInterval(() => requestAnimationFrame(frame), 1500); }
}
