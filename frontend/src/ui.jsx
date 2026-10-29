import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuX, LuCheck, LuCheckCheck, LuClock, LuTriangleAlert, LuCopy } from 'react-icons/lu';
import { animate, exit, SPRING, EASE_OUT, useSlidingPill, useTicker } from './motion.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const AVATAR_TONES = ['teal', 'blue', 'violet', 'amber', 'rose', 'cyan', 'indigo', 'orange', 'pink'];
export function toneFor(text = '') {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

export function Avatar({ name, tone, size = '', className = '' }) {
  return <span className={`avatar ${size} tone-${tone || toneFor(name)} ${className}`} title={name}>{initials(name)}</span>;
}

export function Chip({ tone, children, className = '', dot, ...rest }) {
  return (
    <span className={`chip ${tone ? `tone-${tone}` : ''} ${className}`} {...rest}>
      {dot && <i className="dot" />}
      {children}
    </span>
  );
}

const LABEL_TONES = { Booking: 'teal', Question: 'violet', Pricing: 'blue', Complaint: 'amber', Urgent: 'red', 'Needs human': 'rose' };
export function LabelChip({ name, labels }) {
  const def = labels?.find((l) => l.name === name);
  return <Chip tone={def?.color || LABEL_TONES[name] || 'slate'} className="square">{name}</Chip>;
}

const TAG_TONES = { New: 'blue', VIP: 'amber', Regular: 'teal', Lapsed: 'slate', Bridal: 'pink', Membership: 'violet', 'Needs follow-up': 'red', 'Recall due': 'orange' };
export const tagTone = (t) => TAG_TONES[t] || 'slate';

export function Btn({ variant = '', size = '', icon: Icon, children, className = '', ...rest }) {
  return (
    <button type="button" className={`btn ${variant} ${size} ${className}`} {...rest}>
      {Icon && <Icon />}
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, wa, label }) {
  return <button type="button" aria-label={label} aria-pressed={!!on} className={`toggle ${on ? 'on' : ''} ${wa ? 'wa-on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Seg({ options, value, onChange }) {
  const ref = useRef(null);
  const pill = useSlidingPill(ref, 'button.on', [value, options.length], { axis: 'x' });
  return (
    <div className="seg" role="tablist" ref={ref}>
      <span className="seg-pill" ref={pill} />
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}{o.n != null && <span className="n">{o.n}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stat({ icon: Icon, label, value, unit, children }) {
  return (
    <div className="card stat">
      <div className="stat-label"><span className="stat-icon">{Icon && <Icon />}</span>{label}</div>
      <div className="stat-value"><b className="num"><Num value={value} /></b>{unit && <span className="unit">{unit}</span>}{children}</div>
    </div>
  );
}

export function Bar({ value, color = 'var(--accent)', thin }) {
  return <div className={`bar ${thin ? 'thin' : ''}`}><i style={{ width: `${Math.max(0, Math.min(1, value || 0)) * 100}%`, background: color }} /></div>;
}

/** Plays an exit animation on `ref` before calling onClose. */
function useAnimatedClose(onClose, ref, keyframes) {
  const closing = useRef(false);
  return useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    await exit(ref.current, keyframes, 170);
    onClose();
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Modal({ title, onClose, children, footer, wide, icon }) {
  const box = useRef(null);
  const overlay = useRef(null);
  const close = useAnimatedClose(onClose, box, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(.96)', filter: 'blur(3px)' }]);
  const closeAll = useCallback(() => { exit(overlay.current, [{ opacity: 1 }, { opacity: 0 }], 200); close(); }, [close]);
  useLayoutEffect(() => {
    animate(box.current, [{ opacity: 0, transform: 'translateY(18px) scale(.94)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: SPRING.bouncy.duration, easing: SPRING.bouncy.easing });
    const kids = box.current?.querySelectorAll('.modal-body > *');
    kids?.forEach((k, i) => animate(k, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 450, delay: 60 + i * 35, easing: EASE_OUT }));
  }, []);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && closeAll();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [closeAll]);
  return createPortal(
    <div className="overlay" ref={overlay} onMouseDown={(e) => e.target === e.currentTarget && closeAll()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} ref={box}>
        <div className="modal-head">{icon}<h2>{title}</h2><button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={closeAll} aria-label="Close"><LuX /></button></div>
        <ModalCloseCtx.Provider value={closeAll}><div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}</ModalCloseCtx.Provider>
      </div>
    </div>,
    document.body
  );
}
export const ModalCloseCtx = createContext(null);

export function Drawer({ onClose, children }) {
  const panel = useRef(null);
  const shade = useRef(null);
  const close = useAnimatedClose(onClose, panel, [{ transform: 'none', opacity: 1 }, { transform: 'translateX(60px)', opacity: 0 }]);
  const closeAll = useCallback(() => { exit(shade.current, [{ opacity: 1 }, { opacity: 0 }], 200); close(); }, [close]);
  useLayoutEffect(() => {
    animate(panel.current, [{ transform: 'translateX(70px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: SPRING.soft.duration, easing: SPRING.soft.easing });
    panel.current?.querySelectorAll('.drawer-body > *').forEach((k, i) => animate(k, [{ opacity: 0, transform: 'translateX(18px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 80 + i * 45, easing: EASE_OUT }));
  }, []);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && closeAll();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [closeAll]);
  return createPortal(
    <>
      <div className="overlay" ref={shade} style={{ background: 'rgba(12,14,20,.22)' }} onMouseDown={closeAll} />
      <aside className="drawer" ref={panel}><ModalCloseCtx.Provider value={closeAll}>{children}</ModalCloseCtx.Provider></aside>
    </>,
    document.body
  );
}

/** Dropdown menu anchored to its trigger. */
export function Menu({ trigger, children, align = 'right', up = false, width }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className="menu" style={{ [align]: 0, [up ? 'bottom' : 'top']: 'calc(100% + 6px)', width }} onClick={(e) => { if (e.target.closest('button,a') && !e.target.closest('[data-keep]')) setOpen(false); }}>
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </span>
  );
}

export function StatusTick({ status }) {
  return <StatusTickInner key={status} status={status} />;
}
function StatusTickInner({ status }) {
  if (status === 'read') return <LuCheckCheck className="status-tick read" aria-label="Read" />;
  if (status === 'delivered') return <LuCheckCheck className="status-tick" aria-label="Delivered" />;
  if (status === 'sent') return <LuCheck className="status-tick" aria-label="Sent" />;
  if (status === 'failed') return <LuTriangleAlert className="status-tick c-red" aria-label="Failed" />;
  if (status === 'queued') return <LuClock className="status-tick" aria-label="Queued" />;
  return null;
}

export function CopyField({ value, mono = true }) {
  const { toast } = useApp();
  return (
    <div className="input-wrap">
      <input className={`input ${mono ? 'mono' : ''}`} readOnly value={value || ''} style={{ paddingLeft: 12, paddingRight: 40 }} />
      <button type="button" className="btn ghost sm copy" onClick={() => { navigator.clipboard?.writeText(value || ''); toast('Copied'); }} aria-label="Copy"><LuCopy style={{ position: 'static', color: 'var(--muted)' }} /></button>
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', style }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}

export const pct = (v, d = 0) => `${((v || 0) * 100).toFixed(d)}%`;
export const num = (v) => (v ?? 0).toLocaleString('en-US');

/** Animated number: ticks from its previous value. Accepts "4.5%", "1,928", "2 min". */
export function Num({ value }) {
  const v = useTicker(value);
  return <>{v}</>;
}

/** Count badge that pops whenever the number changes. */
export function Badge({ n, className = 'badge-n' }) {
  const ref = useRef(null);
  const prev = useRef(n);
  useEffect(() => {
    if (prev.current !== n && ref.current) {
      ref.current.classList.remove('badge-pop');
      void ref.current.offsetWidth;
      ref.current.classList.add('badge-pop');
    }
    prev.current = n;
  }, [n]);
  return <span ref={ref} className={className}>{n}</span>;
}

/** Text that rolls in from below whenever it changes (clock minutes, statuses). */
export function Roll({ children }) {
  return <span className="roll" key={String(children)}>{children}</span>;
}

/**
 * Button for actions that talk to the server: idle → spinner → ✓ done → idle.
 * The ✓ state holds for a beat so the result registers.
 */
export function AsyncBtn({ onClick, children, doneLabel = 'Done', icon: Icon, variant = '', size = '', className = '', disabled, minMs = 450, ...rest }) {
  const [state, setState] = useState('idle');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = async (e) => {
    if (state !== 'idle') return;
    setState('busy');
    const t0 = performance.now();
    let ok = false;
    try { const r = await onClick?.(e); ok = r !== false && r !== null; } catch { ok = false; }
    const wait = Math.max(0, minMs - (performance.now() - t0));
    await new Promise((r) => setTimeout(r, wait));
    if (!alive.current) return;
    if (!ok) { setState('idle'); return; }
    setState('done');
    setTimeout(() => alive.current && setState('idle'), 1400);
  };
  return (
    <button type="button" className={`btn ${variant} ${size} ${className} ${state === 'done' ? 'is-done' : ''}`} disabled={disabled || state === 'busy'} onClick={run} {...rest}>
      {state === 'idle' && <span className="btn-state" key="i">{Icon && <Icon />}{children}</span>}
      {state === 'busy' && <span className="btn-state" key="b"><i className="spinner" />{children}</span>}
      {state === 'done' && (
        <span className="btn-state" key="d">
          <svg className="check-draw" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 12.5 9.5 18 20 6.5" /></svg>
          {doneLabel}
        </span>
      )}
    </button>
  );
}
