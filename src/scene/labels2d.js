import * as THREE from 'three';

// Screen-space label layer: one 2D canvas over the WebGL view.
// Fixes the world-space sprite problems found in review: off-axis size
// blow-up (1/cos²θ), no collision handling, truncated edge labels, labels
// leaking below the horizon, and text with no separation from the graphics.
//
// Item: { dir:[x,y,z] scene-frame unit vector, text, cls:'planet'|'star'|'const',
//         priority (lower = keep first), ring (px radius, planets only) }

const FONTS = {
  planet: { px: 12.5, weight: 600, color: [240, 215, 170], alpha: 0.95, caps: false, gap: 10 },
  star: { px: 11.5, weight: 500, color: [210, 218, 230], alpha: 0.9, caps: false, gap: 9 },
  const: { px: 11.5, weight: 500, color: [150, 170, 198], alpha: 0.85, caps: true, gap: 0 },
  compass: { px: 11, weight: 700, color: [150, 172, 198], alpha: 0.95, caps: true, gap: 0 },
};
const CENTERED = new Set(['const', 'compass']);

const FADE_MS = 160;

export function createLabelLayer(container) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const ratio = Math.min(window.devicePixelRatio || 1, 2);

  const fades = new Map(); // key → { alpha, seen }
  const v = new THREE.Vector3();
  let dim = 1;

  function resize() {
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
  }
  resize();
  window.addEventListener('resize', resize);

  return {
    setDim(d) {
      dim = d;
    },
    render(camera, items, dtMs, avoidRects) {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * ratio)) resize();
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Project, cull, and collect candidates.
      const e = camera.matrixWorld.elements;
      const fwd = [-e[8], -e[9], -e[10]]; // camera forward in world space
      const candidates = [];
      for (const it of items) {
        if (it.dir[1] < -0.01) continue; // below the horizon
        // Behind-camera guard: projection mirrors points behind the eye.
        if (it.dir[0] * fwd[0] + it.dir[1] * fwd[1] + it.dir[2] * fwd[2] < 0.05) continue;
        // The point has to be built from the eye, not from the scene origin:
        // the camera stands a metre or two off it, and a fixed 1 km radius
        // turns that into ~0.1° of parallax — invisible at 65° FOV, but a
        // 20 px error between a planet's disc and its ring at 4°.
        v.set(it.dir[0], it.dir[1], it.dir[2]).multiplyScalar(1000).add(camera.position);
        v.project(camera);
        if (v.z > 1 || v.z < -1) continue;
        const x = (v.x * 0.5 + 0.5) * W;
        const y = (-v.y * 0.5 + 0.5) * H;
        if (x < -40 || x > W + 40 || y < -20 || y > H + 20) continue;
        candidates.push({ ...it, x, y });
      }
      candidates.sort((a, b) => a.priority - b.priority);

      // Greedy screen-space declutter. The chrome's own rectangles are seeded
      // as already-occupied so sky labels never slide under a panel.
      const boxes = avoidRects ? avoidRects.slice() : [];
      const placed = [];
      for (const c of candidates) {
        const f = FONTS[c.cls];
        const text = f.caps ? c.text.toUpperCase() : c.text;
        ctx.font = `${f.weight} ${f.px}px -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`;
        if (f.caps) ctx.font = `${f.weight} ${f.px - 1}px -apple-system, "SF Pro Text", Arial, sans-serif`;
        const w = ctx.measureText(text).width + (f.caps ? text.length * 1.4 : 0);
        const h = f.px + 4;
        // Ringed objects (planets, the Earth) push their label clear of the ring.
        const gap = f.gap + (c.ring ? c.ring : 0);
        const lx = CENTERED.has(c.cls) ? c.x - w / 2 : c.x + gap;
        const ly = c.y - h / 2;
        // Whole box must be inside the viewport (no truncated words at edges).
        if (lx < 2 || lx + w > W - 2 || ly < 2 || ly + h > H - 2) {
          if (c.ring) placed.push({ ...c, text: null }); // still draw the ring
          continue;
        }
        const box = { x: lx - 4, y: ly - 3, w: w + 8, h: h + 6 };
        if (boxes.some((b) => b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y)) {
          if (c.ring) placed.push({ ...c, text: null });
          continue;
        }
        boxes.push(box);
        placed.push({ ...c, text, lx, ly: c.y, w });
      }

      // Fade bookkeeping.
      const k = Math.min((dtMs ?? 16) / FADE_MS, 1);
      for (const f of fades.values()) f.seen = false;
      for (const p of placed) {
        const key = `${p.cls}:${p.id ?? p.text}`;
        let f = fades.get(key);
        if (!f) {
          f = { alpha: 0, seen: true };
          fades.set(key, f);
        }
        f.seen = true;
        f.alpha = Math.min(1, f.alpha + k);
        p.fade = f.alpha;
      }
      for (const [key, f] of fades) {
        if (!f.seen) {
          f.alpha -= k;
          if (f.alpha <= 0) fades.delete(key);
        }
      }

      // Draw.
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (const p of placed) {
        const f = FONTS[p.cls];
        // Compass marks are navigation chrome: they hold their brightness
        // when the daylit surface washes the sky labels out.
        const layerDim = p.cls === 'compass' ? 1 : dim;
        const a = f.alpha * layerDim * (p.fade ?? 1) * (p.alpha ?? 1);
        if (a <= 0.01) continue;
        if (p.ring) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.ring, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${f.color.join(',')},${(a * 0.55).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (p.tick) {
          // Compass marks sit on the skyline with a short riser above them.
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 8);
          ctx.lineTo(p.x, p.y - 17);
          ctx.strokeStyle = `rgba(${f.color.join(',')},${(a * 0.65).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (!p.text) continue;
        ctx.font = `${f.weight} ${f.caps ? f.px - 1 : f.px}px -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`;
        if (f.caps) {
          ctx.save();
          ctx.translate(p.lx, p.ly);
          drawSpaced(ctx, p.text, 1.4, a, f.color);
          ctx.restore();
        } else {
          // Dark halo so lines/stars never strike through glyphs.
          ctx.strokeStyle = `rgba(0,0,0,${(a * 0.55).toFixed(3)})`;
          ctx.lineWidth = 3;
          ctx.strokeText(p.text, p.lx, p.ly);
          ctx.fillStyle = `rgba(${f.color.join(',')},${a.toFixed(3)})`;
          ctx.fillText(p.text, p.lx, p.ly);
        }
      }
    },
  };
}

function drawSpaced(ctx, text, spacing, alpha, color) {
  let x = 0;
  ctx.strokeStyle = `rgba(0,0,0,${(alpha * 0.55).toFixed(3)})`;
  ctx.lineWidth = 3;
  ctx.fillStyle = `rgba(${color.join(',')},${alpha.toFixed(3)})`;
  for (const ch of text) {
    ctx.strokeText(ch, x, 0);
    ctx.fillText(ch, x, 0);
    x += ctx.measureText(ch).width + spacing;
  }
}
