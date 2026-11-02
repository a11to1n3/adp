/* Live agent-based background. Boids under local rules only — but the rule
 * weights drift slowly between three regimes, so the population cycles
 * through the classic collective states (Couzin et al. 2002): a polarized
 * flock, a rotating mill, and a disordered swarm. Every minute or so a hawk
 * crosses the page and the flock flash-expands around it. Agents fade under
 * the content column so text stays readable. Honors prefers-reduced-motion
 * with a static frame, sleeps while the tab is hidden, and the footer
 * control pauses it. Console toys: __abm.regime('mill'), __abm.hawk(). */
(() => {
    'use strict';
    const canvas = document.getElementById('abm-background');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const root = document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // --- model parameters (px, px/s) ----------------------------------
    const SEPARATION = 26;   // personal space
    const LINK_DIST = 50;    // show interaction links below this distance
    const MAX_SPEED = 48, MIN_SPEED = 20;
    const W_MOUSE = 70, MOUSE_R = 110;
    const COLUMN_DIM = 0.35; // agent alpha multiplier under the text column
    const FEATHER = 90;      // soft edge of the column dimming (px)

    // Collective states: same agents, different rule weights.
    // sep/ali/coh are the three Reynolds rules; orbit steers tangentially
    // around the local centroid (one handedness, so mills co-rotate);
    // wander is per-agent correlated noise; per is the perception radius —
    // wide neighbourhoods let small eddies merge into page-scale mills.
    const REGIMES = {
        flocking: { sep: 38, ali: 30, coh: 8, orbit: 0, wander: 6, per: 70 },
        milling: { sep: 30, ali: 4, coh: 24, orbit: 46, wander: 0, per: 120 },
        swarming: { sep: 36, ali: 0, coh: 3, orbit: 0, wander: 42, per: 50 },
    };
    const ORDER = ['flocking', 'milling', 'swarming'];
    const HOLD_MIN = 22, HOLD_MAX = 38;   // seconds per regime
    const BLEND_TAU = 2.5;                // smooth parameter cross-fade

    // Hawk: a fast intruder every so often; prey flee, then regroup.
    const HAWK_SPEED = 180, HAWK_R = 150, W_HAWK = 220;
    const HAWK_MIN = 35, HAWK_MAX = 75;   // seconds between crossings

    let boids = [], W = 0, H = 0, dpr = 1;
    let column = null, mouse = null, hawk = null;
    let paused = false, raf = null, last = null;
    let simTime = 0, regimeIdx = 0, nextRegimeAt = 0, nextHawkAt = 0;
    let params = { ...REGIMES.flocking };
    try { paused = localStorage.abmPaused === '1'; } catch {}

    const rand = (a, b) => a + Math.random() * (b - a);

    function spawn() {
        const angle = rand(0, 2 * Math.PI), speed = rand(MIN_SPEED, MAX_SPEED);
        return { x: rand(0, W), y: rand(0, H), vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, wa: rand(0, 2 * Math.PI) };
    }

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const content = document.querySelector('.article-content') ||
            document.querySelector('main .container') || document.querySelector('main');
        if (content) {
            const rect = content.getBoundingClientRect();
            column = { left: rect.left, right: rect.right };
        }

        const target = Math.max(40, Math.min(130, Math.round(W * H / 13000)));
        while (boids.length < target) boids.push(spawn());
        boids.length = target;
        for (const b of boids) { b.x = Math.min(b.x, W); b.y = Math.min(b.y, H); }
    }

    function setRegimeLabel(name) {
        const el = document.getElementById('abm-regime');
        if (el) el.textContent = name;
    }

    function scheduleRegime() {
        regimeIdx = (regimeIdx + 1) % ORDER.length;
        nextRegimeAt = simTime + rand(HOLD_MIN, HOLD_MAX);
        setRegimeLabel(ORDER[regimeIdx]);
    }

    function spawnHawk() {
        const side = Math.floor(rand(0, 4));
        const from = [
            { x: -40, y: rand(0, H) }, { x: W + 40, y: rand(0, H) },
            { x: rand(0, W), y: -40 }, { x: rand(0, W), y: H + 40 },
        ][side];
        // hunt the flock: single out the boid with the busiest neighbourhood
        let prey = boids[0], best = -1;
        for (const b of boids) {
            let k = 0;
            for (const o of boids) {
                if (o !== b && Math.hypot(o.x - b.x, o.y - b.y) < 100) k++;
            }
            if (k > best) { best = k; prey = b; }
        }
        const to = { x: prey.x + rand(-20, 20), y: prey.y + rand(-20, 20) };
        const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        hawk = { x: from.x, y: from.y, vx: HAWK_SPEED * (to.x - from.x) / d, vy: HAWK_SPEED * (to.y - from.y) / d };
    }

    // One Euler step: three rules + regime extras + hawk/cursor avoidance.
    function step(dt) {
        simTime += dt;
        if (simTime >= nextRegimeAt) scheduleRegime();
        const t = REGIMES[ORDER[regimeIdx]];
        const k = Math.min(1, dt / BLEND_TAU);
        for (const key in params) params[key] += (t[key] - params[key]) * k;

        if (hawk) {
            hawk.x += hawk.vx * dt; hawk.y += hawk.vy * dt;
            if (hawk.x < -60 || hawk.x > W + 60 || hawk.y < -60 || hawk.y > H + 60) {
                hawk = null;
                nextHawkAt = simTime + rand(HAWK_MIN, HAWK_MAX);
            }
        } else if (simTime >= nextHawkAt) spawnHawk();

        const n = boids.length;
        for (let i = 0; i < n; i++) {
            const b = boids[i];
            let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0, count = 0;
            for (let j = 0; j < n; j++) {
                if (j === i) continue;
                const o = boids[j];
                const dx = o.x - b.x, dy = o.y - b.y;
                const d2 = dx * dx + dy * dy;
                if (d2 > params.per * params.per || d2 === 0) continue;
                const d = Math.sqrt(d2);
                count++;
                aliX += o.vx; aliY += o.vy;
                cohX += dx; cohY += dy;
                if (d < SEPARATION) { sepX -= dx / d; sepY -= dy / d; }
            }
            let ax = 0, ay = 0;
            if (count > 0) {
                const sp = Math.hypot(b.vx, b.vy) || 1;
                ax += params.sep * sepX + params.ali * (aliX / count / MAX_SPEED - b.vx / sp) + params.coh * (cohX / count / params.per);
                ay += params.sep * sepY + params.ali * (aliY / count / MAX_SPEED - b.vy / sp) + params.coh * (cohY / count / params.per);
                if (params.orbit > 0.5) {
                    const cd = Math.hypot(cohX, cohY) / count || 1;
                    ax += params.orbit * (-cohY / count) / cd;   // tangent to the
                    ay += params.orbit * (cohX / count) / cd;    // local centroid
                }
            }
            if (params.wander > 0.5) {
                b.wa += rand(-2.4, 2.4) * dt * 4;
                ax += params.wander * Math.cos(b.wa);
                ay += params.wander * Math.sin(b.wa);
            }
            if (mouse) {
                const dx = b.x - mouse.x, dy = b.y - mouse.y;
                const d = Math.hypot(dx, dy);
                if (d < MOUSE_R && d > 0) {
                    const push = W_MOUSE * (1 - d / MOUSE_R);
                    ax += push * dx / d; ay += push * dy / d;
                }
            }
            if (hawk) {
                const dx = b.x - hawk.x, dy = b.y - hawk.y;
                const d = Math.hypot(dx, dy);
                if (d < HAWK_R && d > 0) {
                    const push = W_HAWK * (1 - d / HAWK_R);
                    ax += push * dx / d; ay += push * dy / d;
                }
            }
            b.vx += ax * dt; b.vy += ay * dt;
            const sp = Math.hypot(b.vx, b.vy) || 1;
            // fleeing prey may briefly exceed cruise speed
            const cap = hawk && Math.hypot(b.x - hawk.x, b.y - hawk.y) < HAWK_R ? MAX_SPEED * 1.8 : MAX_SPEED;
            const clamped = Math.max(MIN_SPEED, Math.min(cap, sp));
            b.vx *= clamped / sp; b.vy *= clamped / sp;
        }
        for (const b of boids) {
            b.x += b.vx * dt; b.y += b.vy * dt;
            if (b.x < -12) b.x += W + 24; else if (b.x > W + 12) b.x -= W + 24;
            if (b.y < -12) b.y += H + 24; else if (b.y > H + 12) b.y -= H + 24;
        }
    }

    // Quiet under the text column, livelier in the margins.
    function columnFade(x) {
        if (!column) return 1;
        const inside = Math.min(x - (column.left - FEATHER), (column.right + FEATHER) - x);
        if (inside <= 0) return 1;
        const t = Math.min(1, inside / FEATHER);
        return 1 - t * (1 - COLUMN_DIM);
    }

    function palette() {
        const dark = root.classList.contains('dark');
        return dark
            ? { base: [148, 163, 184], accent: [125, 170, 250], hawk: [251, 191, 36], agentA: 0.55, lineA: 0.16 }
            : { base: [71, 85, 105], accent: [37, 99, 235], hawk: [180, 83, 9], agentA: 0.5, lineA: 0.12 };
    }

    function triangle(x, y, ang, size, fill) {
        ctx.fillStyle = fill;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(1.3 * size, 0); ctx.lineTo(-0.9 * size, 0.72 * size); ctx.lineTo(-0.9 * size, -0.72 * size);
        ctx.closePath(); ctx.fill();
        ctx.restore();
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        const p = palette();
        const n = boids.length;

        // interaction links first, agents on top
        ctx.lineWidth = 1;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = boids[i], b = boids[j];
                const dx = b.x - a.x, dy = b.y - a.y;
                const d2 = dx * dx + dy * dy;
                if (d2 > LINK_DIST * LINK_DIST) continue;
                const fade = Math.min(columnFade(a.x), columnFade(b.x));
                const alpha = p.lineA * (1 - Math.sqrt(d2) / LINK_DIST) * fade;
                if (alpha < 0.004) continue;
                ctx.strokeStyle = `rgba(${p.base[0]},${p.base[1]},${p.base[2]},${alpha})`;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
        }
        for (let i = 0; i < n; i++) {
            const b = boids[i];
            const alpha = p.agentA * columnFade(b.x);
            if (alpha < 0.01) continue;
            const c = i % 7 === 0 ? p.accent : p.base;
            triangle(b.x, b.y, Math.atan2(b.vy, b.vx), 5, `rgba(${c[0]},${c[1]},${c[2]},${alpha})`);
        }
        if (hawk) {
            const alpha = Math.min(0.85, p.agentA * 1.6) * columnFade(hawk.x);
            triangle(hawk.x, hawk.y, Math.atan2(hawk.vy, hawk.vx), 10, `rgba(${p.hawk[0]},${p.hawk[1]},${p.hawk[2]},${alpha})`);
        }
    }

    function frame(ts) {
        raf = null;
        if (paused || document.hidden) return;
        if (last !== null) step(Math.min((ts - last) / 1000, 0.05));
        last = ts;
        draw();
        if (!reduceMotion.matches) raf = requestAnimationFrame(frame);
    }

    function start() {
        if (paused) { ctx.clearRect(0, 0, W, H); return; }
        if (reduceMotion.matches) {           // static, settled flock
            hawk = null;
            for (let i = 0; i < 240; i++) step(1 / 30);
            draw();
            return;
        }
        last = null;
        if (!raf) raf = requestAnimationFrame(frame);
    }

    // --- wiring --------------------------------------------------------
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { resize(); if (paused || reduceMotion.matches) start(); }, 150);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
    window.addEventListener('site:theme', () => { if (paused || reduceMotion.matches || document.hidden) return; draw(); });
    reduceMotion.addEventListener?.('change', start);
    window.addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
    window.addEventListener('pointerleave', () => { mouse = null; });
    document.addEventListener('mouseleave', () => { mouse = null; });

    const toggle = document.getElementById('abm-toggle');
    function reflectToggle() {
        if (!toggle) return;
        toggle.textContent = paused ? 'Play it' : 'Pause it';
        toggle.setAttribute('aria-pressed', String(paused));
    }
    toggle?.addEventListener('click', () => {
        paused = !paused;
        try { localStorage.abmPaused = paused ? '1' : '0'; } catch {}
        reflectToggle();
        start();
    });

    // console toys, also used for testing
    window.__abm = {
        regime(name) {
            const idx = ORDER.indexOf(name);
            if (idx < 0) return ORDER;
            regimeIdx = idx;
            nextRegimeAt = simTime + rand(HOLD_MIN, HOLD_MAX);
            setRegimeLabel(name);
        },
        hawk() { if (!hawk) spawnHawk(); },
        get boids() { return boids; },
        get hawkState() { return hawk; },
    };

    resize();
    nextRegimeAt = rand(HOLD_MIN, HOLD_MAX);
    nextHawkAt = rand(12, HAWK_MIN);
    setRegimeLabel(ORDER[0]);
    for (let i = 0; i < 90; i++) step(1 / 30);   // warm-up: arrive as a flock, not confetti
    simTime = 0; nextRegimeAt = rand(HOLD_MIN, HOLD_MAX); nextHawkAt = rand(12, HAWK_MIN);
    reflectToggle();
    start();
})();
