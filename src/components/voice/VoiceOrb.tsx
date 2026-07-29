/**
 * VoiceOrb — esfera animada con canvas, 5 estados.
 *
 * Adaptación del orb HTML/JS de Weaver Live a React.
 * Cambios:
 *  - Eliminados los botones y el panel inferior (los controles viven en LiveOverlay).
 *  - El estado se lee de useVoiceStore en vez de botones.
 *  - Click en el orb → cycle state (debug, no se usa en producción).
 *  - Resize automático al contenedor padre.
 *  - Cleanup del rAF al desmontar.
 *
 * Estados y paletas:
 *   - idle:      morado→violeta, baja energía, breathing suave
 *   - listening: cyan→azul, partículas absorbidas, ripples
 *   - thinking:  magenta→rosa, partículas en órbita compacta, spin rápido
 *   - speaking:  azul→índigo, waveform radial (bars), breathing medio
 *   - error:     rojo→magenta, glitch + aberración cromática
 */

import { useEffect, useRef } from 'react';
import { useVoiceStore, type VoiceState } from '@/store/voice';

// --- Configuración de estados ----------------------------------------------

const STATES: Record<VoiceState, StateDefLike> = {
  idle: {
    label: 'En reposo',
    c1: [96, 110, 255], c2: [150, 90, 250], glow: [125, 105, 255],
    energy: 0.22, breath: 1, edgeAmp: 4, waves: 3, rot: 0.12, pSpeed: 0.25, ring: 0, wave: 0, orbit: 0, glitch: 0, absorb: 0,
  },
  listening: {
    label: 'Escuchando',
    c1: [0, 235, 195], c2: [0, 165, 255], glow: [0, 215, 215],
    energy: 0.65, breath: 2.4, edgeAmp: 6, waves: 4, rot: 0.5, pSpeed: 0.8, ring: 1, wave: 0, orbit: 0, glitch: 0, absorb: 1,
  },
  thinking: {
    label: 'Procesando',
    c1: [175, 95, 255], c2: [255, 95, 215], glow: [195, 110, 255],
    energy: 0.75, breath: 1.4, edgeAmp: 5, waves: 5, rot: 2.2, pSpeed: 2.2, ring: 0, wave: 0, orbit: 1, glitch: 0, absorb: 0,
  },
  speaking: {
    label: 'Respondiendo',
    c1: [0, 195, 255], c2: [95, 120, 255], glow: [70, 160, 255],
    energy: 1, breath: 1.8, edgeAmp: 7, waves: 6, rot: 0.9, pSpeed: 1.2, ring: 0, wave: 1, orbit: 0, glitch: 0, absorb: 0,
  },
  error: {
    label: 'Error',
    c1: [255, 75, 80], c2: [255, 45, 120], glow: [255, 70, 70],
    energy: 0.85, breath: 3.2, edgeAmp: 9, waves: 7, rot: 0.7, pSpeed: 1.4, ring: 0, wave: 0, orbit: 0, glitch: 1, absorb: 0,
  },
};

const NUM_KEYS = ['energy', 'breath', 'edgeAmp', 'waves', 'rot', 'pSpeed', 'ring', 'wave', 'orbit', 'glitch', 'absorb'] as const;
type NumericKey = typeof NUM_KEYS[number];
interface StateDefLike { label: string; energy: number; breath: number; edgeAmp: number; waves: number; rot: number; pSpeed: number; ring: number; wave: number; orbit: number; glitch: number; absorb: number; c1: number[]; c2: number[]; glow: number[] }
interface CurState { energy: number; breath: number; edgeAmp: number; waves: number; rot: number; pSpeed: number; ring: number; wave: number; orbit: number; glitch: number; absorb: number; c1: number[]; c2: number[]; glow: number[] }

// --- Helpers ---------------------------------------------------------------

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rgba = (c: number[], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a: number[], b: number[], t: number) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function speechEnv(t: number) {
  const v = Math.sin(t * 5.1) * 0.45 + Math.sin(t * 9.7 + 1.3) * 0.35 + Math.sin(t * 15.3 + 2.1) * 0.2;
  return Math.pow(Math.min(1, Math.abs(v)), 1.1);
}
function glitchNoise(a: number, time: number) {
  const s = Math.sin(a * 91.7 + Math.floor(time * 16) * 12.3) * 43758.55;
  return (s - Math.floor(s)) * 2 - 1;
}

// --- Partículas / dust / rings / arcs / bars -------------------------------

interface Particle { a: number; d: number; sp: number; sz: number; ph: number; tw: number }
interface Dust { x: number; y: number; s: number; v: number; a: number; ph: number }
interface Ring { r: number; a: number; lw: number }

const ARCS = [
  { r: 1.24, len: 1.9, sp: 2.6, w: 3 },
  { r: 1.36, len: 1.1, sp: -1.8, w: 2 },
  { r: 1.48, len: 2.6, sp: 1.2, w: 1.5 },
];
const BARS = 56;

function makeParticle(R: number): Particle {
  return {
    a: Math.random() * Math.PI * 2,
    d: R * (1.15 + Math.random() * 1.0),
    sp: (0.25 + Math.random() * 0.75) * (Math.random() < 0.5 ? -1 : 1),
    sz: 0.6 + Math.random() * 1.7,
    ph: Math.random() * Math.PI * 2,
    tw: 0.4 + Math.random() * 0.6,
  };
}
function initParticles(R: number): Particle[] {
  return Array.from({ length: 70 }, () => makeParticle(R));
}
function initDust(W: number, H: number): Dust[] {
  return Array.from({ length: 55 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    s: 0.4 + Math.random() * 1.2,
    v: 2 + Math.random() * 7,
    a: 0.03 + Math.random() * 0.1,
    ph: Math.random() * 6.28,
  }));
}

// --- Componente -------------------------------------------------------------

export function VoiceOrb({ size = 320 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<VoiceState>('idle');
  const activeRef = useRef<VoiceState>('idle');

  // Suscripción al store: actualiza activeRef cuando cambia el estado
  useEffect(() => {
    const unsub = useVoiceStore.subscribe((s) => {
      if (s.state !== activeRef.current) {
        activeRef.current = s.state;
        stateRef.current = s.state;
      }
    });
    // Sync inicial
    activeRef.current = useVoiceStore.getState().state;
    return unsub;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxRaw = canvas.getContext('2d');
    if (!ctxRaw) return;
    // Assertion para que TS no se queje dentro de las funciones internas
    // (no se propaga el narrowing de `if (!ctxRaw) return` a los closures).
    const ctx: CanvasRenderingContext2D = ctxRaw;

    let W = 0, H = 0, CX = 0, CY = 0, R = 110;
    let particles: Particle[] = [];
    let dust: Dust[] = [];
    let rings: Ring[] = [];
    let ringTimer = 0;
    let popScale = 1;
    let parX = 0, parY = 0, shakeX = 0, shakeY = 0;
    const barSeed = Array.from({ length: BARS }, () => 0.45 + Math.random() * 0.55);
    let time = 0;
    let raf = 0;

    // Estado interpolado
    const init = STATES.idle;
    const cur: CurState = {
      energy: init.energy, breath: init.breath, edgeAmp: init.edgeAmp,
      waves: init.waves, rot: init.rot, pSpeed: init.pSpeed, ring: init.ring,
      wave: init.wave, orbit: init.orbit, glitch: init.glitch, absorb: init.absorb,
      c1: [...init.c1], c2: [...init.c2], glow: [...init.glow],
    };

    function approach(dt: number) {
      const t: StateDefLike = STATES[activeRef.current];
      const k = 1 - Math.exp(-dt * 4.5);
      for (const key of NUM_KEYS) cur[key] = lerp(cur[key], t[key], k);
      for (const ck of ['c1', 'c2', 'glow'] as const) {
        for (let i = 0; i < 3; i++) cur[ck][i] = lerp(cur[ck][i], t[ck][i], k);
      }
    }

    function spawnRing(power: number) {
      rings.push({ r: R * 1.04, a: 0.5 * power, lw: 1.5 + power * 1.5 });
    }

    function update(dt: number) {
      approach(dt);
      popScale = lerp(popScale, 1, 1 - Math.exp(-dt * 6));
      shakeX = shakeY = 0;
      if (cur.glitch > 0.02) {
        shakeX = (Math.random() * 2 - 1) * 3.5 * cur.glitch;
        shakeY = (Math.random() * 2 - 1) * 3.5 * cur.glitch;
        if (Math.random() < 0.05) shakeX *= 3.5;
      }

      ringTimer -= dt;
      if (cur.ring > 0.4 && ringTimer <= 0) {
        spawnRing(0.7 + Math.random() * 0.3);
        ringTimer = 0.85;
      }
      for (const rg of rings) { rg.r += R * 1.35 * dt; rg.a -= dt * 0.45; }
      rings = rings.filter((rg) => rg.a > 0.02);

      for (const p of particles) {
        p.a += p.sp * cur.pSpeed * dt;
        p.d += Math.sin(time * 0.9 + p.ph) * 0.12;
        if (cur.orbit > 0.02) {
          p.d = lerp(p.d, R * 1.32 + Math.sin(p.ph) * 10, Math.min(1, cur.orbit * dt * 2.2));
        }
        if (cur.absorb > 0.02) {
          p.d -= cur.absorb * dt * (26 + 46 * p.tw);
          if (p.d < R * 0.5) { Object.assign(p, makeParticle(R)); p.d = R * (1.6 + Math.random() * 0.5); }
        }
        if (cur.glitch > 0.02) {
          p.d += cur.glitch * dt * 55 * p.tw;
          p.a += (Math.random() - 0.5) * 0.25 * cur.glitch;
          if (p.d > R * 2.8) Object.assign(p, makeParticle(R));
        }
        if (p.d < R * 1.03 && cur.absorb < 0.05) p.d = R * 1.03;
      }

      for (const d of dust) {
        d.y -= d.v * dt;
        if (d.y < -6) { d.y = H + 6; d.x = Math.random() * W; }
      }
    }

    function orbPath(px: number, py: number, scale: number) {
      const base = R * scale;
      ctx.beginPath();
      const steps = 140;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        let r = base
          + Math.sin(a * cur.waves + time * cur.rot * 2.0) * cur.edgeAmp
          + Math.sin(a * (cur.waves * 2 + 1) - time * cur.rot * 3.1) * cur.edgeAmp * 0.45
          + Math.sin(a * 3 + time * 0.7) * cur.edgeAmp * 0.3;
        if (cur.wave > 0.01) {
          r += Math.sin(a * 9 + time * 14) * speechEnv(time) * 14 * cur.wave;
          r += Math.sin(a * 5 - time * 9) * speechEnv(time * 1.4 + 2) * 8 * cur.wave;
        }
        if (cur.glitch > 0.02) r += glitchNoise(a, time) * 10 * cur.glitch;
        const x = CX + px + Math.cos(a) * r, y = CY + py + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    function drawGlow(px: number, py: number, env: number) {
      let inten = 0.55 + cur.energy * 0.75 + env * 0.5 * cur.wave;
      if (cur.glitch > 0.02 && Math.random() < 0.08 * cur.glitch) inten *= 0.4;
      // Glow radius reducido para que fade a transparente ocurra DENTRO del
      // canvas. Antes era R*2.8 (=268px con R=96), pero el canvas es 320px
      // (half-width 160px), así el glow se cortaba en el borde y se veía un
      // cuadrado. Ahora R*1.55 (=149px) deja ~11px de margen transparente.
      const gr = R * 1.55;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(CX + px, CY + py, R * 0.2, CX + px, CY + py, gr);
      // Intensidades ligeramente mayores para compensar el radio menor.
      g.addColorStop(0, rgba(cur.glow, 0.40 * inten));
      g.addColorStop(0.45, rgba(cur.glow, 0.16 * inten));
      g.addColorStop(1, rgba(cur.glow, 0));
      ctx.fillStyle = g;
      ctx.fillRect(CX + px - gr, CY + py - gr, gr * 2, gr * 2);
      ctx.restore();
    }

    function drawRings(px: number, py: number) {
      if (!rings.length) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const rg of rings) {
        ctx.beginPath();
        ctx.arc(CX + px, CY + py, rg.r, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(cur.glow, rg.a);
        ctx.lineWidth = rg.lw;
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawOrb(px: number, py: number, env: number) {
      const pulse = (1
        + Math.sin(time * cur.breath * 1.7) * 0.028 * (0.4 + cur.energy)
        + env * 0.05 * cur.wave
        + speechEnv(time * 0.8 + 5) * 0.07 * cur.ring) * popScale;

      if (cur.glitch > 0.03) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const ca = (2 + Math.random() * 5) * cur.glitch;
        ctx.globalAlpha = 0.4 * cur.glitch;
        orbPath(px - ca, py, pulse); ctx.fillStyle = 'rgba(255,60,60,1)'; ctx.fill();
        orbPath(px + ca, py, pulse); ctx.fillStyle = 'rgba(255,120,180,1)'; ctx.fill();
        ctx.restore();
      }

      orbPath(px, py, pulse);
      const g = ctx.createRadialGradient(CX + px - R * 0.3, CY + py - R * 0.35, R * 0.05, CX + px, CY + py, R * 1.3 * pulse);
      g.addColorStop(0, rgba(mix(cur.c1, [255, 255, 255], 0.35), 1));
      g.addColorStop(0.45, rgba(cur.c1, 1));
      g.addColorStop(1, rgba(cur.c2, 1));
      ctx.fillStyle = g; ctx.fill();

      ctx.save(); ctx.clip();
      const sh = ctx.createLinearGradient(0, CY + py - R, 0, CY + py + R * 1.2);
      sh.addColorStop(0.55, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(0,0,20,0.35)');
      ctx.fillStyle = sh; ctx.fillRect(CX + px - R * 1.5, CY + py - R * 1.5, R * 3, R * 3);

      ctx.globalCompositeOperation = 'lighter';
      const coreR = Math.max(R * (0.32 + 0.1 * Math.sin(time * cur.breath * 2.3) + env * 0.3 * cur.wave), 1);
      const ca2 = 0.35 + cur.energy * 0.35 + env * 0.3 * cur.wave;
      const cg = ctx.createRadialGradient(CX + px, CY + py, 0, CX + px, CY + py, coreR * 1.8);
      cg.addColorStop(0, `rgba(255,255,255,${Math.min(ca2, 0.85)})`);
      cg.addColorStop(0.5, rgba(mix(cur.c1, [255, 255, 255], 0.5), ca2 * 0.35));
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cg; ctx.fillRect(CX + px - R * 1.5, CY + py - R * 1.5, R * 3, R * 3);
      ctx.restore();

      orbPath(px, py, pulse);
      ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      orbPath(px, py, pulse * 1.01);
      ctx.strokeStyle = rgba(cur.glow, 0.35); ctx.lineWidth = 3; ctx.stroke();
      ctx.restore();
    }

    function drawArcs(px: number, py: number) {
      if (cur.orbit < 0.02) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ARCS.forEach((A, i) => {
        const start = time * A.sp + i * 2.1, r = R * A.r;
        ctx.beginPath();
        ctx.arc(CX + px, CY + py, r, start, start + A.len);
        ctx.strokeStyle = rgba(cur.glow, (0.55 - i * 0.13) * cur.orbit);
        ctx.lineWidth = A.w; ctx.stroke();
        const hx = CX + px + Math.cos(start + A.len) * r, hy = CY + py + Math.sin(start + A.len) * r;
        ctx.beginPath(); ctx.arc(hx, hy, A.w * 1.1, 0, Math.PI * 2);
        ctx.fillStyle = rgba([255, 255, 255], 0.8 * cur.orbit); ctx.fill();
      });
      ctx.restore();
    }

    function drawBars(px: number, py: number) {
      if (cur.wave < 0.02) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const base = R * 1.18;
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2 + time * 0.15;
        const band = speechEnv(time * 1.7 + i * 0.6) * barSeed[i];
        const len = 4 + band * 44 * cur.wave;
        ctx.strokeStyle = rgba(mix(cur.glow, [255, 255, 255], 0.25), (0.18 + band * 0.6) * cur.wave);
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(CX + px + Math.cos(a) * base, CY + py + Math.sin(a) * base);
        ctx.lineTo(CX + px + Math.cos(a) * (base + len), CY + py + Math.sin(a) * (base + len));
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawParticlesFn(px: number, py: number, env: number) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        const tw = 0.35 + 0.65 * Math.pow(Math.sin(time * 1.7 + p.ph) * 0.5 + 0.5, 2);
        const alpha = 0.55 * p.tw * tw * (0.35 + cur.energy * 0.65);
        const d = p.d + env * cur.wave * 8;
        const x = CX + px + Math.cos(p.a) * d, y = CY + py + Math.sin(p.a) * d * 0.96;
        const col = mix(cur.glow, [255, 255, 255], 0.45);
        ctx.beginPath(); ctx.arc(x, y, p.sz * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = rgba(col, alpha * 0.22); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, p.sz, 0, Math.PI * 2);
        ctx.fillStyle = rgba(col, alpha); ctx.fill();
      }
      ctx.restore();
    }

    function drawDust() {
      for (const d of dust) {
        const tw = 0.6 + 0.4 * Math.sin(time * 0.8 + d.ph);
        ctx.fillStyle = rgba(cur.glow, d.a * tw);
        ctx.beginPath(); ctx.arc(d.x, d.y, d.s, 0, 6.2832); ctx.fill();
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const env = speechEnv(time);
      const px = parX + shakeX, py = parY + shakeY;
      drawDust();
      drawGlow(px, py, env);
      drawRings(px, py);
      drawOrb(px, py, env);
      drawArcs(px, py);
      drawBars(px, py);
      drawParticlesFn(px, py, env);
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const last = (frame as unknown as { _last?: number })._last ?? now;
      const dt = Math.min((now - last) / 1000, 0.05);
      (frame as unknown as { _last?: number })._last = now;
      time += dt;
      update(dt);
      draw();
    }

    function resize() {
      const cv = canvas;
      if (!cv) return;
      const parent = cv.parentElement;
      const cssSize = size || parent?.clientWidth || 320;
      const DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = cssSize; H = cssSize;
      cv.width = W * DPR; cv.height = H * DPR;
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      CX = W / 2; CY = H * 0.44;
      R = Math.max(48, Math.min(Math.min(W, H) * 0.30, 140));
      particles = initParticles(R);
      dust = initDust(W, H);
    }

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [size]);

  // Click para cycle state (debug)
  const cycleState = () => {
    const order: VoiceState[] = ['idle', 'listening', 'thinking', 'speaking', 'error'];
    const cur = useVoiceStore.getState().state;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    useVoiceStore.getState().setState(next);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={cycleState}
      className="cursor-pointer"
      style={{ display: 'block', background: 'transparent' }}
      title="Click para cambiar estado (debug)"
    />
  );
}
