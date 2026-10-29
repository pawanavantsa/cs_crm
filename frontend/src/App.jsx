import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { installRipples, themeTransition, useSlidingPill, stagger, exit } from './motion.js';
import {
  LuActivity, LuInbox, LuUsers, LuCalendarDays, LuMegaphone, LuChartColumn, LuSettings, LuSearch, LuMoon, LuSun,
  LuBell, LuPlus, LuEllipsis, LuKeyboard, LuDownload, LuMonitor, LuRotateCcw, LuCircleCheck, LuTriangleAlert,
  LuUserPlus, LuFileText, LuMessageCircle, LuLogOut,
} from 'react-icons/lu';
import { FaWhatsapp } from 'react-icons/fa';
import { useApi, post, get, isDemo, logout, login, apiConfig, switchToDemo } from './api.js';
import { AppCtx, Avatar, Menu, Modal, Badge, Roll, useApp as useAppCtx } from './ui.jsx';
import { fmtTime, fmtDuration } from './lib/time.js';
import Today from './pages/Today.jsx';
import Inbox from './pages/Inbox.jsx';
import Contacts from './pages/Contacts.jsx';
import Schedule from './pages/Schedule.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { BookingModal, ContactModal, SimulateModal, BookingDetail, ContactDrawer } from './components/Modals.jsx';

const NAV = [
  { path: 'today', label: 'Today', icon: LuActivity },
  { path: 'inbox', label: 'Inbox', icon: LuInbox },
  { path: 'contacts', label: 'Contacts', icon: LuUsers },
  { path: 'schedule', label: 'Schedule', icon: LuCalendarDays },
  { path: 'campaigns', label: 'Campaigns', icon: LuMegaphone },
  { path: 'reports', label: 'Reports', icon: LuChartColumn },
  { path: 'settings', label: 'Settings', icon: LuSettings },
];

function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [page, id, sub] = h.split('/');
  return { page: page || 'today', id: id || null, sub: sub || null };
}

function applyTheme(t) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function Login() {
  const [url, setUrl] = useState(apiConfig.url || 'http://localhost:8000');
  const [u, setU] = useState('admin');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await login(url, u, p); window.location.reload(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="row" style={{ gap: 12 }}>
          <div className="brand-mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 5l14 14M19 5l-5.2 5.2M5 19l5.2-5.2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></div>
          <div><h2 style={{ fontSize: 18 }}>Sign in to Xeroura</h2><div className="muted">WhatsApp CRM</div></div>
        </div>
        <div className="field"><label>API URL</label><input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
        <div className="field"><label>Username</label><input className="input" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" /></div>
        <div className="field"><label>Password</label><input className="input" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" autoFocus /></div>
        {err && <div className="c-red" style={{ fontWeight: 650 }}>{err}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button className="btn ghost" type="button" onClick={() => { switchToDemo(); window.location.reload(); }}>Explore with demo data instead</button>
      </form>
    </div>
  );
}

export default function App() {
  const needsLogin = !isDemo() && !apiConfig.token;
  if (needsLogin) return <Login />;
  return <Shell />;
}

function Shell() {
  const [route, setRoute] = useState(parseHash);
  const boot = useApi('/bootstrap', { poll: 10000 });
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState(null);
  const [palette, setPalette] = useState(false);
  const [theme, setThemeState] = useState(() => { try { return localStorage.getItem('xcrm.theme') || 'system'; } catch { return 'system'; } });
  const [skew, setSkew] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    const unauth = () => { logout(); window.location.reload(); };
    window.addEventListener('xcrm:unauthorized', unauth);
    return () => window.removeEventListener('xcrm:unauthorized', unauth);
  }, []);
  const mainRef = useRef(null);
  const navRef = useRef(null);
  const navPill = useSlidingPill(navRef, 'a.active', [route.page]);
  useEffect(() => { installRipples(); }, []);
  useEffect(() => {
    let cur = parseHash();
    const on = async () => {
      const next = parseHash();
      if (next.page !== cur.page) {
        const el = mainRef.current?.querySelector('.content');
        await exit(el, [{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-6px)', filter: 'blur(4px)' }], 140);
      }
      cur = next;
      setRoute(next);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // Page enter: header, stat tiles, toolbars and cards rise in, one after another.
  useLayoutEffect(() => {
    const el = mainRef.current?.querySelector('.content');
    if (!el) return;
    stagger(el, '.page-head > *, .head-stats > *, .stats > *, .toolbar, .seg-chips, .staff-chips, .settings > *, .today-grid > *, .inbox > *, .rep-grid > *, .camp-grid > *, .content > .card, .content > div > .seg', { step: 45, max: 14, y: 16 });
  }, [route.page, !!boot.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { applyTheme(theme); try { localStorage.setItem('xcrm.theme', theme); } catch { /* */ } }, [theme]);
  useEffect(() => { if (boot.data?.now) setSkew(boot.data.now - Date.now()); }, [boot.data?.now]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === '?' ) setModal({ type: 'shortcuts' });
      if (e.key === 'g') window.__g = Date.now();
      else if (window.__g && Date.now() - window.__g < 800) {
        const m = { t: 'today', i: 'inbox', c: 'contacts', s: 'schedule', m: 'campaigns', r: 'reports' }[e.key];
        if (m) window.location.hash = `#/${m}`;
        window.__g = 0;
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const toast = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x))), 3000);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3260);
  }, []);

  const run = useCallback(async (fn, okMsg) => {
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      return r;
    } catch (e) {
      toast(e.message || 'Something went wrong', 'error');
      return null;
    }
  }, [toast]);

  const navigate = useCallback((p) => { window.location.hash = `#/${p}`; }, []);

  const b = boot.data;
  const ctx = useMemo(() => ({
    boot: b,
    tz: b?.workspace?.timezone || 'Asia/Kolkata',
    now: () => Date.now() + skew,
    toast, run, navigate,
    openModal: setModal,
    reloadBoot: boot.reload,
    theme, setTheme: (t) => { applyTheme(t); flushSync(() => setThemeState(t)); },
  }), [b, skew, toast, run, navigate, boot.reload, theme]);

  if (!b) {
    return (
      <div className="login">
        {boot.error ? (
          <div className="card">
            <h2>Can't reach the Xeroura CRM API</h2>
            <p className="muted">{boot.error.message}</p>
            <button className="btn primary" onClick={() => { logout(); window.location.hash = '#/login'; window.location.reload(); }}>Sign in again</button>
          </div>
        ) : <div className="muted">Loading…</div>}
      </div>
    );
  }

  const now = Date.now() + skew;
  const wa = b.whatsapp;
  const exportCsv = async () => { const r = await run(() => get('/contacts/export')); if (r) downloadText(r.filename, r.csv); };

  const pages = { today: Today, inbox: Inbox, contacts: Contacts, schedule: Schedule, campaigns: Campaigns, reports: Reports, settings: Settings };
  const Page = pages[route.page] || Today;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <aside className="side">
          <div className="brand">
            <div className="brand-mark" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 5l14 14M19 5l-5.2 5.2M5 19l5.2-5.2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
            </div>
            <div className="grow">
              <div className="brand-name">Xeroura</div>
              <div className="brand-sub ellipsis">{b.workspace.name}</div>
            </div>
          </div>
          <div className="side-label">Workspace</div>
          <nav className="nav" ref={navRef}>
            <span className="nav-pill" ref={navPill} />
            {NAV.map((n) => (
              <a key={n.path} href={`#/${n.path}`} className={route.page === n.path ? 'active' : ''}>
                <n.icon />{n.label}
                {n.path === 'inbox' && b.inbox_unread > 0 && <Badge n={b.inbox_unread} className="count" />}
              </a>
            ))}
          </nav>
          <div className="side-foot">
            <div className={`wa-card ${wa.connected ? '' : 'off'}`} onClick={() => navigate('settings/whatsapp')} role="button" tabIndex={0}>
              <span className="dot-wrap"><FaWhatsapp size={16} /></span>
              <div>
                <b>{wa.connected ? 'WhatsApp connected' : 'WhatsApp not connected'}</b>
                {wa.display_phone} · quality {wa.quality}{wa.demo_mode ? ' · demo' : ''}
              </div>
            </div>
            <div className="user-row">
              <Avatar name={b.me.name} tone="violet" />
              <div className="who grow"><b className="ellipsis">{b.me.name}</b><span>{b.me.role}</span></div>
              <Menu up align="left" width={220} trigger={({ toggle }) => <button className="menu-btn" onClick={toggle} aria-label="Account menu"><LuEllipsis /></button>}>
                <button onClick={() => navigate('settings')}><LuSettings />Settings</button>
                <button onClick={() => setModal({ type: 'shortcuts' })}><LuKeyboard />Keyboard shortcuts</button>
                <button onClick={exportCsv}><LuDownload />Export contacts (CSV)</button>
                <hr />
                <button onClick={(e) => themeTransition(e, () => ctx.setTheme('light'))}><LuSun />Light{theme === 'light' && <LuCircleCheck className="check" />}</button>
                <button onClick={(e) => themeTransition(e, () => ctx.setTheme('dark'))}><LuMoon />Dark{theme === 'dark' && <LuCircleCheck className="check" />}</button>
                <button onClick={(e) => themeTransition(e, () => ctx.setTheme('system'))}><LuMonitor />Match system{theme === 'system' && <LuCircleCheck className="check" />}</button>
                <hr />
                {isDemo()
                  ? <button className="danger" onClick={() => setModal({ type: 'reset' })}><LuRotateCcw />Reset demo data</button>
                  : <button onClick={() => { logout(); window.location.reload(); }}><LuLogOut />Sign out</button>}
              </Menu>
            </div>
          </div>
        </aside>

        <main className="main" ref={mainRef}>
          <header className="topbar">
            <button className="search-trigger" onClick={() => setPalette(true)}>
              <LuSearch size={16} />Search contacts, chats, pages…<kbd>⌘K</kbd>
            </button>
            <div className="top-right">
              <button
                className="clock"
                style={{ cursor: isDemo() ? 'pointer' : 'default' }}
                title={isDemo() ? 'Demo clock starts at 10:44 AM so the day looks busy. Click to switch to the real time.' : 'Business time'}
                onClick={() => isDemo() && run(() => post('/demo/clock', { mode: b.clock === 'demo' ? 'live' : 'demo' }).then(boot.reload))}
              >
                <span className="live-dot" /><Roll>{fmtTime(now, ctx.tz)}</Roll><small>{isDemo() && b.clock === 'demo' ? 'Demo day' : ctx.tz.split('/')[1]?.replace('_', ' ')}</small>
              </button>
              <button className="icon-btn" onClick={(e) => { const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; themeTransition(e, () => { applyTheme(next); flushSync(() => setThemeState(next)); }); }} aria-label="Toggle theme">{theme === 'dark' ? <LuSun size={17} /> : <LuMoon size={17} />}</button>
              <Notifications />
              <Menu width={230} trigger={({ toggle }) => <button className="btn dark" onClick={toggle}><LuPlus />New</button>}>
                <button onClick={() => setModal({ type: 'booking' })}><LuCalendarDays />New booking</button>
                <button onClick={() => setModal({ type: 'contact' })}><LuUserPlus />New contact</button>
                <button onClick={() => navigate('campaigns/new')}><LuMegaphone />New broadcast</button>
                <button onClick={() => navigate('campaigns/templates/new')}><LuFileText />New template</button>
                {(isDemo() || b.simulator) && <><hr /><button onClick={() => setModal({ type: 'simulate' })}><LuMessageCircle />Simulate customer message</button></>}
              </Menu>
            </div>
          </header>
          <Page route={route} key={route.page} />
        </main>
      </div>

      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {modal?.type === 'booking' && <BookingModal prefill={modal.prefill} onClose={() => setModal(null)} />}
      {modal?.type === 'contact' && <ContactModal onClose={() => setModal(null)} />}
      {modal?.type === 'booking-detail' && <BookingDetail id={modal.id} onClose={() => setModal(null)} />}
      {modal?.type === 'contact-drawer' && <ContactDrawer id={modal.id} onClose={() => setModal(null)} />}
      {modal?.type === 'simulate' && <SimulateModal prefill={modal.prefill} onClose={() => setModal(null)} />}
      {modal?.type === 'shortcuts' && (
        <Modal title="Keyboard shortcuts" onClose={() => setModal(null)}>
          {[['⌘ K', 'Search everything'], ['g then t / i / c / s / m / r', 'Go to Today, Inbox, Contacts, Schedule, Campaigns, Reports'], ['↑ ↓', 'Move through conversations'], ['/', 'Quick replies in the composer'], ['⌘ Enter', 'Send message'], ['?', 'This list']].map(([k, d]) => (
            <div key={k} className="row" style={{ justifyContent: 'space-between' }}><span>{d}</span><kbd>{k}</kbd></div>
          ))}
        </Modal>
      )}
      {modal?.type === 'reset' && (
        <Modal title="Reset demo data?" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn danger" onClick={async () => { await run(() => post('/demo/reset'), 'Demo data reset'); setModal(null); navigate('today'); }}><LuRotateCcw />Reset</button>
        </>}>
          <p className="muted" style={{ margin: 0 }}>Every contact, booking, conversation and setting goes back to the starting data. This can't be undone.</p>
        </Modal>
      )}
      {isDemo() && route.page !== 'settings' && (
        <div className="demo-banner">
          Demo data · stored in this browser
          <button className="btn sm" onClick={() => navigate('settings/data')}>Connect API</button>
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''} ${t.leaving ? 'leaving' : ''}`}>{t.kind === 'error' ? <LuTriangleAlert /> : <LuCircleCheck />}{t.msg}</div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

function Notifications() {
  const { data } = useApi('/inbox/stats');
  const { now } = useAppCtx();
  const n = data?.waiting || 0;
  const prev = useRef(n);
  const [ring, setRing] = useState(false);
  useEffect(() => {
    if (n > prev.current) { setRing(true); const t = setTimeout(() => setRing(false), 1100); prev.current = n; return () => clearTimeout(t); }
    prev.current = n;
    return undefined;
  }, [n]);
  return (
    <Menu width={300} trigger={({ toggle }) => (
      <button className={`icon-btn ${ring ? 'ring-bell' : ''}`} onClick={toggle} aria-label="Notifications"><LuBell size={17} />{n > 0 && <span className="pip" />}</button>
    )}>
      <div className="menu-title">Waiting on a reply</div>
      {!data?.waiting_list?.length && <div className="muted" style={{ padding: 10 }}>All caught up 🎉</div>}
      {data?.waiting_list?.slice(0, 6).map((w) => (
        <a key={w.id} href={`#/inbox/${w.id}`}>
          <Avatar name={w.name} size="sm" />
          <span className="grow ellipsis">{w.name}</span>
          <span className={w.urgent ? 'c-red' : 'c-amber'} style={{ fontSize: 12, fontWeight: 700 }}>{fmtDuration(now() - w.since).replace(' ', ' ')}</span>
        </a>
      ))}
      {data?.window_closed > 0 && <><hr /><div className="muted" style={{ padding: '4px 10px 6px', fontSize: 12 }}>{data.window_closed} chats are past the 24-hour window and need a template.</div></>}
    </Menu>
  );
}
