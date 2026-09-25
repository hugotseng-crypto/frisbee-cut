const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const BEST_KEY = 'cut.best.v1';
const state = {
  mode: 'menu', score: 0, combo: 0, turns: 0, stall: 0, stallAcc: 0,
  throwType: 'flat', drag: null, shake: 0, flash: 0,
  W: 0, H: 0, field: null,
};
let thrower, cutter, defender, disc, particles;

function best() { return Number(localStorage.getItem(BEST_KEY) || 0); }
function saveBest() {
  if (state.score > best()) localStorage.setItem(BEST_KEY, String(state.score));
  document.getElementById('best').textContent = best();
}
function hud() {
  document.getElementById('score').textContent = state.score;
  document.getElementById('combo').textContent = state.combo;
  document.getElementById('turn').textContent = state.turns;
  const s = document.getElementById('stall');
  s.textContent = Math.floor(state.stall);
  s.className = state.stall >= 8 ? 'hot' : state.stall >= 6 ? 'warn' : '';
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  state.W = innerWidth; state.H = innerHeight;
  canvas.width = state.W * dpr; canvas.height = state.H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = 18, top = 78, bot = 128;
  state.field = { x: pad, y: top, w: state.W - pad * 2, h: state.H - top - bot };
}
addEventListener('resize', resize);

function fieldPoint(fx, fy) {
  const f = state.field;
  return { x: f.x + fx * f.w, y: f.y + (1 - fy) * f.h };
}
function inEndzone(p) {
  const f = state.field;
  return p.y < f.y + f.h * 0.18 && p.x > f.x && p.x < f.x + f.w;
}
function inField(p, extra = 0) {
  const f = state.field;
  return p.x > f.x - extra && p.x < f.x + f.w + extra && p.y > f.y - extra && p.y < f.y + f.h + extra;
}

function resetPossession(keepScore) {
  const start = fieldPoint(0.5, 0.16);
  thrower = { x: start.x, y: start.y, r: 16, team: 1, hasDisc: true };
  cutter = { x: fieldPoint(0.62, 0.42).x, y: fieldPoint(0.62, 0.42).y, r: 15, team: 1, vx: 0, vy: 0, mode: 'under' };
  defender = { x: fieldPoint(0.58, 0.48).x, y: fieldPoint(0.58, 0.48).y, r: 15, team: 0, vx: 0, vy: 0 };
  disc = { x: thrower.x, y: thrower.y - 8, z: 0, vx: 0, vy: 0, vz: 0, flying: false, curve: 0 };
  particles = [];
  state.stall = 0; state.stallAcc = 0; state.drag = null;
  if (!keepScore) { state.score = 0; state.combo = 0; state.turns = 0; }
  hud();
}

function setThrow(type) {
  state.throwType = type;
  document.getElementById('tFlat').classList.toggle('on', type === 'flat');
  document.getElementById('tOut').classList.toggle('on', type === 'out');
  document.getElementById('tHam').classList.toggle('on', type === 'ham');
}
document.getElementById('tFlat').onclick = () => setThrow('flat');
document.getElementById('tOut').onclick = () => setThrow('out');
document.getElementById('tHam').onclick = () => setThrow('ham');
document.getElementById('cutUnder').onclick = () => { if (cutter) cutter.mode = 'under'; };
document.getElementById('cutDeep').onclick = () => { if (cutter) cutter.mode = 'deep'; };

function pointerPos(e) {
  const t = e.touches ? e.touches[0] : e;
  return { x: t.clientX, y: t.clientY };
}
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'play' || disc.flying || !thrower.hasDisc) return;
  const p = pointerPos(e);
  state.drag = { x0: thrower.x, y0: thrower.y, x1: p.x, y1: p.y };
});
canvas.addEventListener('pointermove', (e) => {
  if (!state.drag) return;
  const p = pointerPos(e);
  state.drag.x1 = p.x; state.drag.y1 = p.y;
});
function endDrag() {
  if (!state.drag || state.mode !== 'play') { state.drag = null; return; }
  const dx = state.drag.x1 - state.drag.x0;
  const dy = state.drag.y1 - state.drag.y0;
  const dist = Math.hypot(dx, dy);
  state.drag = null;
  if (dist < 28) return;
  throwDisc(dx, dy, dist);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { state.drag = null; });

function throwDisc(dx, dy, dist) {
  const power = Math.min(1, dist / 220);
  const ang = Math.atan2(dy, dx);
  let spd = 420 + power * 520;
  let z = 18 + power * 16;
  let vz = 8 + power * 10;
  let curve = 0;
  if (state.throwType === 'out') { curve = (dx >= 0 ? 1 : -1) * (180 + power * 140); spd *= 0.92; }
  if (state.throwType === 'ham') { z = 46 + power * 28; vz = 22; spd *= 0.78; curve = (dx >= 0 ? -0.4 : 0.4) * 90; }
  disc.flying = true; thrower.hasDisc = false;
  disc.x = thrower.x; disc.y = thrower.y - 10; disc.z = z;
  disc.vx = Math.cos(ang) * spd; disc.vy = Math.sin(ang) * spd; disc.vz = vz; disc.curve = curve;
  state.stall = 0;
}

function seek(ent, tx, ty, acc, max) {
  const ax = tx - ent.x, ay = ty - ent.y;
  const d = Math.hypot(ax, ay) || 1;
  ent.vx += (ax / d) * acc;
  ent.vy += (ay / d) * acc;
  const s = Math.hypot(ent.vx, ent.vy);
  if (s > max) { ent.vx *= max / s; ent.vy *= max / s; }
}

function updateAI(dt) {
  const f = state.field;
  const deepY = f.y + f.h * 0.16;
  const underY = thrower.y - f.h * 0.22;
  const side = cutter.x < thrower.x ? -1 : 1;
  let tx, ty;
  if (disc.flying) {
    const look = 0.28;
    tx = disc.x + disc.vx * look;
    ty = disc.y + disc.vy * look;
  } else if (cutter.mode === 'deep') {
    tx = thrower.x + side * f.w * 0.18;
    ty = deepY + 20;
  } else {
    tx = thrower.x + side * f.w * 0.28;
    ty = Math.max(f.y + f.h * 0.28, underY);
  }
  seek(cutter, tx, ty, 2400 * dt, disc.flying ? 260 : 210);
  cutter.x += cutter.vx * dt; cutter.y += cutter.vy * dt;
  cutter.vx *= 0.86; cutter.vy *= 0.86;

  const mark = thrower.hasDisc
    ? { x: thrower.x + 22, y: thrower.y - 26 }
    : { x: disc.x + disc.vx * 0.18, y: disc.y + disc.vy * 0.18 };
  const shade = {
    x: cutter.x * 0.55 + mark.x * 0.45,
    y: cutter.y * 0.62 + mark.y * 0.38,
  };
  seek(defender, shade.x, shade.y, 2200 * dt, 200 + state.score * 3);
  defender.x += defender.vx * dt; defender.y += defender.vy * dt;
  defender.vx *= 0.86; defender.vy *= 0.86;
}

function burst(x, y, color, n = 10) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 160;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color });
  }
}

function catchBy(player) {
  disc.flying = false; disc.z = 0; disc.vx = 0; disc.vy = 0; disc.vz = 0;
  disc.x = player.x; disc.y = player.y - 8;
  if (inEndzone(player)) {
    state.score += 1 + Math.floor(state.combo / 2);
    state.combo += 1;
    state.flash = 0.35; state.shake = 10;
    burst(player.x, player.y, '#ffd60a', 16);
    saveBest(); hud();
    setTimeout(() => { if (state.mode === 'play') resetPossession(true); }, 520);
    return;
  }
  thrower.hasDisc = false;
  const old = thrower;
  thrower = { x: player.x, y: player.y, r: 16, team: 1, hasDisc: true };
  cutter = {
    x: old.x, y: old.y, r: 15, team: 1, vx: 0, vy: 0,
    mode: player.y < state.field.y + state.field.h * 0.45 ? 'under' : 'deep',
  };
  state.combo += 1; state.stall = 0; hud();
  burst(player.x, player.y, '#34c759', 8);
}

function turnover(why) {
  state.turns += 1; state.combo = 0; state.shake = 8; hud();
  burst(disc.x, disc.y, '#ff453a', 12);
  if (state.turns >= 3) {
    state.mode = 'over';
    document.getElementById('overlay').classList.remove('hide');
    document.querySelector('#overlay h1').textContent = '比赛结束';
    document.querySelector('#overlay p').textContent = `得分 ${state.score} · 最佳 ${best()}`;
    document.getElementById('startBtn').textContent = '再来一局';
    return;
  }
  setTimeout(() => { if (state.mode === 'play') resetPossession(true); }, 480);
}

function tick(dt) {
  if (state.mode !== 'play') return;
  if (thrower.hasDisc && !disc.flying) {
    state.stallAcc += dt;
    if (state.stallAcc >= 1) { state.stall += 1; state.stallAcc = 0; hud(); }
    if (state.stall >= 10) { disc.x = thrower.x; disc.y = thrower.y; turnover('stall'); return; }
  }
  updateAI(dt);
  if (disc.flying) {
    disc.vx += disc.curve * dt;
    disc.x += disc.vx * dt; disc.y += disc.vy * dt;
    disc.z += disc.vz * dt;
    disc.vz -= (state.throwType === 'ham' ? 70 : 46) * dt;
    disc.curve *= 0.985;
    const catchR = 26 + Math.min(18, disc.z * 0.15) + (state.throwType === 'ham' ? 8 : 0);
    if (disc.z < 26 && Math.hypot(disc.x - cutter.x, disc.y - cutter.y) < catchR) {
      catchBy(cutter); return;
    }
    if (disc.z < 20 && Math.hypot(disc.x - defender.x, disc.y - defender.y) < 22) {
      turnover('block'); return;
    }
    if (disc.z <= 0) { disc.z = 0; turnover('drop'); return; }
    if (!inField(disc, 8)) { turnover('oob'); return; }
  } else if (thrower.hasDisc) {
    disc.x = thrower.x; disc.y = thrower.y - 10; disc.z = 6;
  }
  particles.forEach(p => { p.life -= dt * 1.8; p.x += p.vx * dt; p.y += p.vy * dt; });
  particles = particles.filter(p => p.life > 0);
  state.shake *= 0.86; state.flash *= 0.9;
}

function drawField() {
  const f = state.field;
  ctx.fillStyle = '#147a36';
  ctx.fillRect(f.x, f.y, f.w, f.h);
  ctx.fillStyle = '#0f5f2a';
  ctx.fillRect(f.x, f.y, f.w, f.h * 0.18);
  ctx.fillRect(f.x, f.y + f.h * 0.82, f.w, f.h * 0.18);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(f.x, f.y, f.w, f.h);
  ctx.beginPath();
  ctx.moveTo(f.x, f.y + f.h * 0.18); ctx.lineTo(f.x + f.w, f.y + f.h * 0.18);
  ctx.moveTo(f.x, f.y + f.h * 0.82); ctx.lineTo(f.x + f.w, f.y + f.h * 0.82);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.font = '700 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ENDZONE', f.x + f.w / 2, f.y + 16);
}

function drawPlayer(p, label) {
  ctx.beginPath();
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.ellipse(p.x, p.y + 7, p.r * 0.8, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = p.team ? '#ff9f0a' : '#0a84ff';
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  if (label) {
    ctx.fillStyle = '#06210d'; ctx.font = '800 10px sans-serif';
    ctx.textAlign = 'center'; ctx.fillText(label, p.x, p.y + 3);
  }
}

function drawDisc() {
  const s = 6 + disc.z * 0.12;
  ctx.beginPath();
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.ellipse(disc.x + 4, disc.y + 10 + disc.z * 0.2, s, s * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = '#f2f2f7';
  ctx.ellipse(disc.x, disc.y - disc.z * 0.35, 9, 5, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d0d0d8'; ctx.stroke();
}

function drawDrag() {
  if (!state.drag) return;
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(state.drag.x0, state.drag.y0); ctx.lineTo(state.drag.x1, state.drag.y1); ctx.stroke();
  ctx.setLineDash([]);
  const mx = state.drag.x0 + (state.drag.x1 - state.drag.x0) * 0.65;
  const my = state.drag.y0 + (state.drag.y1 - state.drag.y0) * 0.65;
  if (state.throwType === 'out') {
    ctx.strokeStyle = 'rgba(255,214,10,.75)';
    ctx.beginPath();
    ctx.moveTo(state.drag.x0, state.drag.y0);
    ctx.quadraticCurveTo(mx + 40, my, state.drag.x1, state.drag.y1);
    ctx.stroke();
  }
}

function render() {
  ctx.fillStyle = '#0b1a10';
  ctx.fillRect(0, 0, state.W, state.H);
  ctx.save();
  if (state.shake > 0.4) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
  drawField();
  if (thrower) {
    drawPlayer(defender, 'D');
    drawPlayer(cutter, cutter.mode === 'deep' ? '深' : '边');
    drawPlayer(thrower, thrower.hasDisc ? '盘' : '');
    drawDisc();
    drawDrag();
  }
  particles.forEach(p => {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  });
  if (state.flash > 0.02) {
    ctx.fillStyle = `rgba(255,214,10,${state.flash * 0.35})`;
    ctx.fillRect(state.field.x, state.field.y, state.field.w, state.field.h * 0.18);
  }
  ctx.restore();
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  tick(dt); render();
  requestAnimationFrame(loop);
}

document.getElementById('startBtn').onclick = () => {
  document.getElementById('overlay').classList.add('hide');
  state.mode = 'play';
  resetPossession(false);
  saveBest();
};
resize(); saveBest(); requestAnimationFrame(loop);
