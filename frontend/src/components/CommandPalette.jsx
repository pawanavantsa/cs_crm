import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, exit, SPRING, useSlidingPill } from '../motion.js';
import {
  LuSearch, LuActivity, LuInbox, LuUsers, LuCalendarDays, LuMegaphone, LuChartColumn, LuSettings, LuUserPlus, LuMessageCircle,
  LuFileText,
} from 'react-icons/lu';
import { get } from '../api.js';
import { useApp, Avatar } from '../ui.jsx';
import { fmtListTime } from '../lib/time.js';

const PAGES = [
  ['Today', 'today', LuActivity], ['Inbox', 'inbox', LuInbox], ['Contacts', 'contacts', LuUsers], ['Schedule', 'schedule', LuCalendarDays],
  ['Campaigns', 'campaigns', LuMegaphone], ['Templates', 'campaigns/templates', LuFileText], ['Reports', 'reports', LuChartColumn],
  ['Settings', 'settings', LuSettings], ['WhatsApp settings', 'settings/whatsapp', LuSettings], ['Auto-replies & AI', 'settings/automation', LuSettings],
];

export default function CommandPalette({ onClose }) {
  const { navigate, openModal, tz, now } = useApp();
  const [q, setQ] = useState('');
  const [res, setRes] = useState({ contacts: [], conversations: [] });
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!q.trim()) { setRes({ contacts: [], conversations: [] }); return undefined; }
    const t = setTimeout(async () => setRes(await get(`/search?q=${encodeURIComponent(q)}`)), 120);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo(() => {
    const s = q.toLowerCase();
    const out = [];
    res.contacts.forEach((c) => out.push({ key: `c${c.id}`, icon: <Avatar name={c.name} size="xs" />, label: c.name, hint: c.phone, run: () => openModal({ type: 'contact-drawer', id: c.id }) }));
    res.conversations.forEach((m, k) => out.push({ key: `m${m.id}-${k}`, icon: <LuMessageCircle />, label: `${m.contact}: ${m.body}`, hint: fmtListTime(m.created_at, tz, now()), run: () => navigate(`inbox/${m.id}`) }));
    PAGES.filter(([l]) => !s || l.toLowerCase().includes(s)).forEach(([l, p, Ic]) => out.push({ key: p, icon: <Ic />, label: l, hint: 'Go to', run: () => navigate(p) }));
    if (!s || 'new booking'.includes(s)) out.push({ key: 'nb', icon: <LuCalendarDays />, label: 'New booking', hint: 'Action', run: () => openModal({ type: 'booking' }) });
    if (!s || 'new contact'.includes(s)) out.push({ key: 'nc', icon: <LuUserPlus />, label: 'New contact', hint: 'Action', run: () => openModal({ type: 'contact' }) });
    return out;
  }, [q, res, navigate, openModal, tz, now]);

  useEffect(() => setI(0), [q]);
  const box = useRef(null);
  const list = useRef(null);
  const pill = useSlidingPill(list, '.palette-item.on', [i, items.length]);
  useLayoutEffect(() => {
    animate(box.current, [{ opacity: 0, transform: 'translateY(-10px) scale(.96)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: SPRING.bouncy.duration, easing: SPRING.bouncy.easing });
  }, []);
  const close = async () => { await exit(box.current, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px) scale(.97)' }], 140); onClose(); };
  const go = (it) => { onClose(); it.run(); };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Search" ref={box}>
        <div className="palette-input">
          <LuSearch size={18} className="faint" />
          <input
            autoFocus
            placeholder="Search contacts, messages, pages…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              if (e.key === 'Enter' && items[i]) go(items[i]);
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={list} style={{ position: 'relative' }}>
          <span className="sub-pill" ref={pill} style={{ borderRadius: 9 }} />
          {items.map((it, k) => (
            <button key={it.key} style={{ position: 'relative', zIndex: 1, animation: `fadeUp .4s var(--ease-out) ${Math.min(k, 10) * 22}ms backwards` }} className={`palette-item ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => go(it)}>
              {it.icon}<span className="ellipsis">{it.label}</span><small>{it.hint}</small>
            </button>
          ))}
          {!items.length && <div className="empty">No results</div>}
        </div>
      </div>
    </div>
  );
}
