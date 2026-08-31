const DEFAULT_START_LABEL = 'Start slicing';

// Feature flags load in the background so a CDN or SDK failure never blocks the game.
async function initFeatureFlags() {
  const startBtnEl = document.getElementById('startBtn');
  try {
    const [{ createClient }, observabilityMod, sessionReplayMod] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/@launchdarkly/js-client-sdk@4/+esm'),
      import('https://cdn.jsdelivr.net/npm/@launchdarkly/observability@1.1.19/+esm'),
      import('https://cdn.jsdelivr.net/npm/@launchdarkly/session-replay@1.1.19/+esm'),
    ]);
    const Observability = observabilityMod.default;
    const SessionReplay = sessionReplayMod.default;

    let contextKey = localStorage.getItem('ld-context-key');
    if (!contextKey) {
      contextKey = crypto.randomUUID();
      localStorage.setItem('ld-context-key', contextKey);
    }

    const client = createClient(
      '6a6a85f67dfccf0a96207e6c',
      {
        kind: 'user',
        key: contextKey,
      },
      {
        plugins: [new Observability(), new SessionReplay()],
      },
    );
    client.start();

    const result = await client.waitForInitialization({ timeout: 5 });
    if (result.status !== 'complete') {
      console.error('LaunchDarkly initialization failed', result.status);
      return;
    }

    // Flag on → "Start", flag off → "Start slicing"
    const applyStartBtnFlag = () => {
      startBtnEl.textContent = client.variation('start-slicing-btn', false)
        ? 'Start'
        : DEFAULT_START_LABEL;
    };
    applyStartBtnFlag();
    client.on('change', applyStartBtnFlag);
  } catch (err) {
    console.error('LaunchDarkly SDK unavailable, using default start label', err);
    startBtnEl.textContent = DEFAULT_START_LABEL;
  }
}

initFeatureFlags();

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('stageWrap');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const livesEl = document.getElementById('lives');
  const comboEl = document.getElementById('combo');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');

  let W, H, dpr;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = wrap.clientWidth;
    H = wrap.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // --- sound (Web Audio, fully synthesized — no files) ---
  let audioCtx = null,
    muted = false;
  const muteBtn = document.getElementById('muteBtn');
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', muted ? 'Unmute sounds' : 'Mute sounds');
  });
  function audio() {
    if (muted) return null;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.2, slide = 0, delay = 0 } = {}) {
    const ac = audio();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator(),
      g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  function noise(dur, { vol = 0.25, lp = 2200, hp = 0, slide = 0, delay = 0 } = {}) {
    const ac = audio();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const len = Math.ceil(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = src;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(lp, t0);
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(60, lp + slide), t0 + dur);
    node.connect(f);
    node = f;
    if (hp) {
      const f2 = ac.createBiquadFilter();
      f2.type = 'highpass';
      f2.frequency.value = hp;
      node.connect(f2);
      node = f2;
    }
    node.connect(g).connect(ac.destination);
    src.start(t0);
  }
  const SFX = {
    slice() {
      noise(0.12, { vol: 0.3, lp: 6000, hp: 1200, slide: -4500 }); // blade swoosh
      noise(0.22, { vol: 0.22, lp: 900, slide: -500, delay: 0.02 }); // wet splat
      tone(180 + Math.random() * 80, 0.1, { type: 'sine', vol: 0.12, slide: -90, delay: 0.02 });
    },
    combo(n) {
      const base = 440 * Math.pow(1.12, Math.min(n, 10));
      tone(base, 0.12, { type: 'triangle', vol: 0.16 });
      tone(base * 1.5, 0.14, { type: 'triangle', vol: 0.12, delay: 0.06 });
    },
    bomb() {
      noise(0.7, { vol: 0.5, lp: 400, slide: -320 }); // deep boom
      noise(0.25, { vol: 0.3, lp: 5000, hp: 800, slide: -4200 }); // crack
      tone(70, 0.6, { type: 'sawtooth', vol: 0.2, slide: -40 });
    },
    miss() {
      tone(300, 0.25, { type: 'sine', vol: 0.14, slide: -180 }); // sad dip
    },
    gameOver() {
      [392, 330, 262, 196].forEach((f, i) =>
        tone(f, 0.28, { type: 'triangle', vol: 0.16, delay: i * 0.16 })
      );
    },
    start() {
      [262, 392, 523].forEach((f, i) =>
        tone(f, 0.14, { type: 'triangle', vol: 0.15, delay: i * 0.08 })
      );
    },
    best() {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(f, 0.18, { type: 'triangle', vol: 0.15, delay: i * 0.1 })
      );
    },
  };

  const FRUITS = [
    { name: 'watermelon', r: 36, skin: '#3fae4a', stripe: '#2b7d34', flesh: '#ff5964', seeds: true },
    { name: 'orange', r: 27, skin: '#ffb631', stripe: null, flesh: '#ffd98a', seeds: false },
    { name: 'apple', r: 25, skin: '#ff5964', stripe: null, flesh: '#fff4e0', seeds: false },
    { name: 'lime', r: 21, skin: '#a8e05f', stripe: null, flesh: '#dcf5b0', seeds: false },
    { name: 'grape', r: 22, skin: '#8f6bff', stripe: null, flesh: '#d6c8ff', seeds: false },
    { name: 'peach', r: 26, skin: '#ff9e7d', stripe: null, flesh: '#ffe8d6', seeds: false },
  ];
  const GRAV = 980;

  let fruits = [],
    halves = [],
    particles = [],
    splats = [],
    trail = [];
  let score = 0,
    best = +(localStorage.getItem('juiceRushBest') || 0),
    lives = 3;
  let running = false,
    spawnTimer = 0.5,
    comboCount = 0,
    comboTimer = 0,
    lastT = 0,
    shake = 0;
  bestEl.textContent = best;

  const hearts = (n) => '❤️'.repeat(n) + '🖤'.repeat(3 - n);

  function spawnFruit() {
    const isBomb = Math.random() < Math.min(0.2, 0.08 + score * 0.002);
    const type = FRUITS[(Math.random() * FRUITS.length) | 0];
    const x = 70 + Math.random() * (W - 140);
    const targetX = 70 + Math.random() * (W - 140);
    const peak = H * (0.6 + Math.random() * 0.32);
    const vy = -Math.sqrt(2 * GRAV * peak);
    const vx = (targetX - x) / 1.7;
    fruits.push({
      x,
      y: H + 50,
      vx,
      vy,
      r: isBomb ? 26 : type.r,
      type,
      bomb: isBomb,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 3,
    });
  }

  function sliceFruit(f, ang) {
    if (f.bomb) {
      explode(f.x, f.y);
      shake = 14;
      SFX.bomb();
      endGame();
      return;
    }
    SFX.slice();
    comboCount++;
    comboTimer = 0.9;
    score += comboCount >= 2 ? comboCount : 1;
    scoreEl.textContent = score;
    if (comboCount >= 2) {
      SFX.combo(comboCount);
      comboEl.textContent = 'combo x' + comboCount;
      comboEl.classList.add('show');
    }
    const nx = Math.cos(ang + Math.PI / 2),
      ny = Math.sin(ang + Math.PI / 2);
    for (const s of [-1, 1]) {
      halves.push({
        x: f.x,
        y: f.y,
        vx: f.vx + nx * s * 130 + (Math.random() - 0.5) * 50,
        vy: f.vy * 0.3 - 90 + ny * s * 130,
        r: f.r,
        type: f.type,
        ang,
        side: s,
        rot: f.rot,
        vr: (Math.random() - 0.5) * 9,
        life: 1.7,
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2,
        sp = 70 + Math.random() * 260;
      particles.push({
        x: f.x,
        y: f.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 90,
        r: 2 + Math.random() * 4,
        c: f.type.flesh,
        life: 0.7 + Math.random() * 0.5,
      });
    }
    splats.push({
      x: f.x,
      y: f.y,
      r: f.r,
      c: f.type.flesh,
      life: 3,
      blobs: Array.from({ length: 5 }, () => ({
        dx: (Math.random() - 0.5) * f.r * 2.2,
        dy: (Math.random() - 0.5) * f.r * 2.2,
        s: 0.3 + Math.random() * 0.7,
      })),
    });
  }

  function explode(x, y) {
    for (let i = 0; i < 32; i++) {
      const a = Math.random() * Math.PI * 2,
        sp = 100 + Math.random() * 380;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: 2 + Math.random() * 6,
        c: Math.random() < 0.5 ? '#9a9a9a' : '#ffb631',
        life: 0.5 + Math.random() * 0.6,
      });
    }
  }

  function endGame() {
    running = false;
    const newBest = score > best;
    if (newBest) {
      best = score;
      localStorage.setItem('juiceRushBest', best);
    }
    bestEl.textContent = best;
    if (newBest && score > 0) SFX.best();
    else SFX.gameOver();
    overlay.innerHTML =
      '<h2>Game over</h2>' +
      '<p class="final">Final score: ' +
      score +
      (score >= best && score > 0 ? ' 🏆 New best!' : '') +
      '</p>' +
      '<button id="againBtn">Play again</button>';
    overlay.classList.remove('hidden');
    document.getElementById('againBtn').addEventListener('click', startGame);
  }

  function startGame() {
    fruits = [];
    halves = [];
    particles = [];
    splats = [];
    trail = [];
    score = 0;
    lives = 3;
    comboCount = 0;
    shake = 0;
    running = true;
    spawnTimer = 0.4;
    scoreEl.textContent = '0';
    livesEl.textContent = hearts(3);
    overlay.classList.add('hidden');
    SFX.start();
  }
  startBtn.addEventListener('click', startGame);

  // --- input ---
  let pointerDown = false,
    lastPt = null;
  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top, t: performance.now() };
  };
  function segCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1,
      dy = y2 - y1,
      len2 = dx * dx + dy * dy || 1;
    let t = ((cx - x1) * dx + (cy - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx,
      py = y1 + t * dy;
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  }
  function onMove(e) {
    if (!pointerDown || !running) return;
    e.preventDefault();
    const p = getPos(e);
    trail.push(p);
    if (trail.length > 16) trail.shift();
    if (lastPt) {
      const dx = p.x - lastPt.x,
        dy = p.y - lastPt.y;
      if (Math.hypot(dx, dy) > 4) {
        const ang = Math.atan2(dy, dx);
        for (let i = fruits.length - 1; i >= 0; i--) {
          const f = fruits[i];
          if (segCircle(lastPt.x, lastPt.y, p.x, p.y, f.x, f.y, f.r)) {
            fruits.splice(i, 1);
            sliceFruit(f, ang);
            if (!running) return;
          }
        }
      }
    }
    lastPt = p;
  }
  canvas.addEventListener('mousedown', (e) => {
    pointerDown = true;
    lastPt = getPos(e);
  });
  canvas.addEventListener(
    'touchstart',
    (e) => {
      pointerDown = true;
      lastPt = getPos(e);
    },
    { passive: false }
  );
  window.addEventListener('mouseup', () => {
    pointerDown = false;
    lastPt = null;
  });
  window.addEventListener('touchend', () => {
    pointerDown = false;
    lastPt = null;
  });
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('touchmove', onMove, { passive: false });

  // --- drawing ---
  function drawFruit(f) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    if (f.bomb) {
      ctx.fillStyle = '#1c1c22';
      ctx.beginPath();
      ctx.arc(0, 0, f.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a4a55';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.beginPath();
      ctx.arc(-f.r * 0.3, -f.r * 0.3, f.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a8a95';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -f.r);
      ctx.quadraticCurveTo(11, -f.r - 13, 17, -f.r - 8);
      ctx.stroke();
      const flick = 3 + Math.sin(performance.now() / 70) * 2;
      ctx.fillStyle = '#ffb631';
      ctx.beginPath();
      ctx.arc(18, -f.r - 8, flick, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff5964';
      ctx.beginPath();
      ctx.arc(18, -f.r - 8, flick * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = f.type.skin;
      ctx.beginPath();
      ctx.arc(0, 0, f.r, 0, Math.PI * 2);
      ctx.fill();
      if (f.type.stripe) {
        ctx.strokeStyle = f.type.stripe;
        ctx.lineWidth = 4;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.abs(i) * f.r * 0.28 + 2, f.r - 3, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.beginPath();
      ctx.arc(-f.r * 0.32, -f.r * 0.35, f.r * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2b7d34';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -f.r * 0.9);
      ctx.lineTo(4, -f.r * 1.3);
      ctx.stroke();
      ctx.fillStyle = '#57c05e';
      ctx.beginPath();
      ctx.ellipse(9, -f.r * 1.15, 7, 3.5, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHalf(h) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.ang + h.rot * 0.3);
    ctx.globalAlpha = Math.min(1, h.life);
    const d = h.side;
    ctx.fillStyle = h.type.flesh;
    ctx.beginPath();
    ctx.arc(0, 0, h.r, d > 0 ? 0 : Math.PI, d > 0 ? Math.PI : Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = h.type.skin;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, h.r - 3, d > 0 ? 0 : Math.PI, d > 0 ? Math.PI : Math.PI * 2);
    ctx.stroke();
    if (h.type.seeds) {
      ctx.fillStyle = '#26262c';
      for (let i = 0; i < 4; i++) {
        const a = (d > 0 ? 0.45 : Math.PI + 0.45) + i * 0.6;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * h.r * 0.5, Math.sin(a) * h.r * 0.5, 2.5, 4.5, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // --- main loop ---
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.033, (t - lastT) / 1000 || 0.016);
    lastT = t;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0) {
      shake -= dt * 40;
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    // splats on the "wall"
    for (let i = splats.length - 1; i >= 0; i--) {
      const s = splats[i];
      s.life -= dt;
      if (s.life <= 0) {
        splats.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(0.4, s.life * 0.2);
      ctx.fillStyle = s.c;
      for (const b of s.blobs) {
        ctx.beginPath();
        ctx.arc(s.x + b.dx, s.y + b.dy, s.r * b.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (running) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        const burst = Math.random() < 0.28 ? 2 + ((Math.random() * 2) | 0) : 1;
        for (let i = 0; i < burst; i++) setTimeout(spawnFruit, i * 150);
        spawnTimer = Math.max(0.5, 1.5 - score * 0.012) + Math.random() * 0.5;
      }
      comboTimer -= dt;
      if (comboTimer <= 0 && comboCount) {
        comboCount = 0;
        comboEl.classList.remove('show');
      }
    }

    for (let i = fruits.length - 1; i >= 0; i--) {
      const f = fruits[i];
      f.vy += GRAV * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      if (f.y > H + 70 && f.vy > 0) {
        fruits.splice(i, 1);
        if (running && !f.bomb) {
          lives--;
          livesEl.textContent = hearts(Math.max(0, lives));
          if (lives > 0) SFX.miss();
          else endGame();
        }
        continue;
      }
      drawFruit(f);
    }

    for (let i = halves.length - 1; i >= 0; i--) {
      const h = halves[i];
      h.vy += GRAV * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.rot += h.vr * dt;
      h.life -= dt;
      if (h.life <= 0 || h.y > H + 90) {
        halves.splice(i, 1);
        continue;
      }
      drawHalf(h);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += GRAV * 0.7 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(1, p.life * 1.6);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // blade trail
    const now = performance.now();
    while (trail.length && now - trail[0].t > 150) trail.shift();
    if (trail.length > 1) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < trail.length; i++) {
        const a = i / trail.length;
        ctx.strokeStyle = 'rgba(255,244,224,' + (0.12 + a * 0.7) + ')';
        ctx.lineWidth = 1 + a * 7;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  requestAnimationFrame(loop);
})();
