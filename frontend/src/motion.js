// Xeroura motion system — no dependencies.
// Springs are simulated once and handed to the Web Animations API as CSS linear() easings,
// so every animation runs on the compositor and ends exactly at rest.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const reduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Damped spring → linear() easing string + its natural duration (ms). */
function springEasing({ stiffness = 170, damping = 20, mass = 1 } = {}) {
  const pts = [];
  let x = 0; let v = 0; const dt = 1 / 120;
  let t = 0; let settled = 0;
  while (t < 2.5) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt; x += v * dt; t += dt;
    pts.push(x);
    if (Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.01) { settled += 1; if (settled > 6) break; } else settled = 0;
  }
  const step = Math.max(1, Math.floor(pts.length / 48));
  const sampled = pts.filter((_, i) => i % step === 0).map((p) => +p.toFixed(4));
  sampled[sampled.length - 1] = 1;
  return { easing: `linear(0, ${sampled.join(', ')})`, duration: Math.round(t * 1000) };
}

const supportsLinear = (() => { try { return CSS.supports('animation-timing-function', 'linear(0, 1)'); } catch { return false; } })();
function spring(cfg, fallback = 'cubic-bezier(.34,1.4,.64,1)') {
  const s = springEasing(cfg);
  return supportsLinear ? s : { easing: fallback, duration: Math.min(700, s.duration) };
}

export const SPRING = {
  snappy: spring({ stiffness: 380, damping: 30 }),
  bouncy: spring({ stiffness: 260, damping: 17 }),
  soft: spring({ stiffness: 160, damping: 22 }),
  gooey: spring({ stiffness: 230, damping: 19 }),
};
export const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
export const EASE_IN = 'cubic-bezier(.7,0,.84,0)';

export function animate(el, keyframes, opts = {}) {
  if (!el || !el.animate) return null;
  if (reduced()) return null;
  try { return el.animate(keyframes, { fill: 'backwards', ...opts }); } catch { return null; }
}

/** Rise + un-blur, used for everything entering the page. */
export function revealEl(el, delay = 0, { y = 12, blur = 6, scale = 1, duration = 620 } = {}) {
  return animate(el, [
    { opacity: 0, transform: `translateY(${y}px) scale(${scale})`, filter: `blur(${blur}px)` },
    { opacity: 1, transform: 'none', filter: 'blur(0)' },
  ], { duration, delay, easing: EASE_OUT });
}

export function stagger(root, selector, { step = 38, max = 16, start = 0, ...rest } = {}) {
  if (!root) return;
  const els = [...root.querySelectorAll(selector)].filter((e) => e.offsetParent !== null || e.getClientRects().length);
  els.forEach((el, i) => revealEl(el, start + Math.min(i, max) * step, rest));
}

/** Stagger children in once, on mount (and again whenever `key` changes). */
export function useReveal(selector, key, opts) {
  const ref = useRef(null);
  useLayoutEffect(() => { stagger(ref.current, selector, opts); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

/** Reveal when the data first arrives (skeleton → content). */
export function useRevealOnData(ref, ready, selector, opts) {
  const done = useRef(false);
  useLayoutEffect(() => {
    if (ready && !done.current) { done.current = true; stagger(ref.current, selector, opts); }
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * FLIP: elements carrying data-flip="<id>" glide from where they were to where they are
 * after every render. New ids pop in; ids that changed parent get a "landed" glow.
 */
export function useFlip(ref, dep) {
  const rects = useRef(new Map());
  const parents = useRef(new Map());
  const first = useRef(true);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const next = new Map();
    const nextParents = new Map();
    let fresh = 0;
    root.querySelectorAll('[data-flip]').forEach((el) => {
      const id = el.dataset.flip;
      const r = el.getBoundingClientRect();
      next.set(id, r);
      const group = el.closest('[data-flip-group]')?.dataset.flipGroup || '';
      nextParents.set(id, group);
      if (first.current) return;
      const prev = rects.current.get(id);
      if (!prev) {
        const delay = Math.min(fresh++, 14) * 32;
        animate(el, [{ opacity: 0, transform: 'scale(.92) translateY(10px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: SPRING.bouncy.duration, easing: SPRING.bouncy.easing, delay });
        return;
      }
      const dx = prev.left - r.left;
      const dy = prev.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      const moved = parents.current.get(id) !== group;
      el.style.zIndex = moved ? '30' : '';
      const a = animate(el, [
        { transform: `translate(${dx}px, ${dy}px) scale(${moved ? 1.04 : 1})`, boxShadow: moved ? '0 18px 40px rgba(20,24,30,.18)' : undefined },
        { transform: 'none' },
      ].map((k) => Object.fromEntries(Object.entries(k).filter(([, v]) => v !== undefined))), { duration: SPRING.gooey.duration, easing: SPRING.gooey.easing });
      if (a) a.onfinish = () => { el.style.zIndex = ''; if (moved) landed(el); };
    });
    rects.current = next;
    parents.current = nextParents;
    first.current = false;
  }, [dep]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function landed(el) {
  animate(el, [
    { boxShadow: '0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent)' },
    { boxShadow: '0 0 0 8px color-mix(in srgb, var(--accent) 0%, transparent)' },
  ], { duration: 700, easing: EASE_OUT, fill: 'none' });
}

export function pulse(el) {
  animate(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: SPRING.bouncy.duration, easing: SPRING.bouncy.easing, fill: 'none' });
}

/** Number that ticks to its new value (keeps "%", "min", "," formatting of the input). */
export function useTicker(target, { duration = 900 } = {}) {
  const [shown, setShown] = useState(target);
  const prev = useRef(null);
  useEffect(() => {
    const parse = (v) => {
      const s = String(v ?? '');
      const m = s.match(/-?[\d,]*\.?\d+/);
      if (!m) return null;
      const raw = m[0];
      return { n: parseFloat(raw.replace(/,/g, '')), dec: (raw.split('.')[1] || '').length, comma: raw.includes(','), pre: s.slice(0, m.index), post: s.slice(m.index + raw.length) };
    };
    const to = parse(target);
    if (!to || reduced()) { setShown(target); prev.current = target; return undefined; }
    const from = parse(prev.current) || { n: 0 };
    prev.current = target;
    if (from.n === to.n) { setShown(target); return undefined; }
    const t0 = performance.now();
    let raf;
    const fmt = (x) => {
      const v = to.dec ? x.toFixed(to.dec) : Math.round(x);
      return to.pre + (to.comma ? Number(v).toLocaleString('en-US', { minimumFractionDigits: to.dec, maximumFractionDigits: to.dec }) : v) + to.post;
    };
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(2, -10 * p);
      setShown(fmt(from.n + (to.n - from.n) * (p === 1 ? 1 : e)));
      if (p < 1) raf = requestAnimationFrame(tick); else setShown(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return shown;
}

/**
 * A pill that glides between the active items of a nav / segmented control.
 * It stretches over both items first and then contracts (the "gooey" move).
 */
export function useSlidingPill(containerRef, activeSelector, deps, { axis = 'y' } = {}) {
  const pillRef = useRef(null);
  const last = useRef(null);
  useLayoutEffect(() => {
    const c = containerRef.current;
    const pill = pillRef.current;
    if (!c || !pill) return;
    const place = (animateIt) => {
      const a = c.querySelector(activeSelector);
      if (!a) { pill.style.opacity = '0'; return; }
      const cr = c.getBoundingClientRect();
      const r = a.getBoundingClientRect();
      const box = { x: r.left - cr.left + c.scrollLeft, y: r.top - cr.top + c.scrollTop, w: r.width, h: r.height };
      pill.style.opacity = '1';
      pill.style.transform = `translate(${box.x}px, ${box.y}px)`;
      pill.style.width = `${box.w}px`;
      pill.style.height = `${box.h}px`;
      const prev = last.current;
      last.current = box;
      if (!animateIt || !prev || reduced()) return;
      const span = axis === 'y'
        ? { x: box.x, y: Math.min(prev.y, box.y), w: box.w, h: Math.abs(prev.y - box.y) + box.h }
        : { x: Math.min(prev.x, box.x), y: box.y, w: Math.abs(prev.x - box.x) + (prev.x < box.x ? box.w : prev.w), h: box.h };
      const fr = (b) => ({ transform: `translate(${b.x}px, ${b.y}px)`, width: `${b.w}px`, height: `${b.h}px` });
      pill.animate([fr(prev), { ...fr(span), offset: 0.38 }, fr(box)], { duration: 560, easing: EASE_OUT });
    };
    place(true);
    const ro = new ResizeObserver(() => place(false));
    ro.observe(c);
    return () => ro.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return pillRef;
}

/** Material-style ripple on every .btn, wired once. */
export function installRipples() {
  if (window.__xcrmRipples) return;
  window.__xcrmRipples = true;
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn, .send-btn, .seg-chip, .snippet');
    if (!btn || btn.disabled || reduced()) return;
    const r = btn.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2.2;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.width = s.style.height = `${d}px`;
    s.style.left = `${e.clientX - r.left - d / 2}px`;
    s.style.top = `${e.clientY - r.top - d / 2}px`;
    btn.appendChild(s);
    const a = s.animate([{ transform: 'scale(0)', opacity: 0.32 }, { transform: 'scale(1)', opacity: 0 }], { duration: 650, easing: EASE_OUT });
    a.onfinish = () => s.remove();
  }, { passive: true });
}

/** Theme switch as a circular reveal from the click point (View Transitions API). */
export function themeTransition(e, apply) {
  if (!document.startViewTransition || reduced()) { apply(); return; }
  const x = e?.clientX ?? window.innerWidth - 80;
  const y = e?.clientY ?? 40;
  const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const t = document.startViewTransition(() => apply());
  t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
      { duration: 650, easing: EASE_OUT, pseudoElement: '::view-transition-new(root)' },
    );
  }).catch(() => {});
}

/** Animate an element out, then resolve (used by modals, drawers, page changes). */
export function exit(el, keyframes, duration = 180) {
  return new Promise((res) => {
    const a = animate(el, keyframes, { duration, easing: EASE_IN, fill: 'forwards' });
    if (!a) res(); else a.onfinish = () => res();
  });
}

/** Typewriter for AI suggestions: calls set() with growing prefixes. */
export function typeInto(text, set, { cps = 90 } = {}) {
  if (reduced()) { set(text); return () => {}; }
  let i = 0;
  let raf;
  let t0 = performance.now();
  const tick = (now) => {
    const n = Math.min(text.length, Math.floor(((now - t0) / 1000) * cps) + 1);
    if (n !== i) { i = n; set(text.slice(0, i)); }
    if (i < text.length) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); t0 = 0; };
}
