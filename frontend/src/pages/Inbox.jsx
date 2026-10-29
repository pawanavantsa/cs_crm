import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LuSearch, LuHourglass, LuClock, LuInbox, LuCheck, LuTag, LuEllipsis, LuPin, LuLock, LuStickyNote, LuSendHorizontal,
  LuZap, LuSparkles, LuFileText, LuReply, LuCalendarDays, LuBell, LuTriangleAlert, LuUser, LuChevronRight,
  LuShieldCheck, LuBot, LuRotateCcw, LuCircleCheck, LuMailOpen, LuCalendarClock, LuPhone,
} from 'react-icons/lu';
import { FaWhatsapp } from 'react-icons/fa';
import { useApi, get, post, patch } from '../api.js';
import {
  useApp, Avatar, Chip, LabelChip, Btn, Menu, Modal, StatusTick, tagTone, Badge, AsyncBtn, Num,
} from '../ui.jsx';
import { fmtListTime, fmtTime, fmtRelDay, fmtDuration, dayKey, fmtDate } from '../lib/time.js';
import { windowLeft } from '../lib/whatsapp.js';
import { useFlip, useSlidingPill, typeInto, animate } from '../motion.js';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'resolved', label: 'Resolved' },
];

export default function Inbox({ route }) {
  const { navigate } = useApp();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 200); return () => clearTimeout(t); }, [q]);
  const list = useApi(`/conversations?filter=${filter}&q=${encodeURIComponent(debounced)}`);
  const stats = useApi('/inbox/stats');
  const activeId = route.id ? +route.id : null;
  const listRef = useRef(null);
  const tabsRef = useRef(null);
  useFlip(listRef, list.data);
  const tabPill = useSlidingPill(tabsRef, 'button.on', [filter, !!list.data], { axis: 'x' });

  useEffect(() => {
    const k = (e) => {
      if (e.target.matches('input, textarea, select') || !list.data) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = list.data.items;
      const i = items.findIndex((c) => c.id === activeId);
      const n = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) navigate(`inbox/${n.id}`);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [list.data, activeId, navigate]);

  const s = stats.data;
  return (
    <div className="content flush">
      <div className="page-head" style={{ alignItems: 'center' }}>
        <h1>Inbox</h1>
        <div className="head-stats">
          <div className="hstat"><b className="num"><Num value={s?.unread ?? '–'} /></b><span><FaWhatsapp className="c-wa" />Unread</span></div>
          <div className="hstat"><b className="num"><Num value={s?.waiting ?? '–'} /></b><span><LuHourglass className="c-amber" />Waiting on us</span></div>
          <div className="hstat"><b className="num"><Num value={s ? `${s.median_reply_min} min` : '–'} /></b><span><LuClock />Median reply</span></div>
          <div className="hstat"><b className="num"><Num value={s?.open ?? '–'} /></b><span><LuInbox />Open</span></div>
        </div>
      </div>
      <div className="inbox">
        <section className="card pane">
          <div className="list-tools">
            <div className="input-wrap"><LuSearch /><input className="input pill-input" placeholder="Search name, phone, message" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="filter-tabs" ref={tabsRef}>
              <span className="tab-pill" ref={tabPill} />
              {FILTERS.map((f) => (
                <button key={f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
                  {f.label}<span className={`n ${f.key === 'unread' && list.data?.counts.unread ? 'green' : ''}`}>{list.data?.counts[f.key] ?? ''}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="pane-scroll" ref={listRef}>
            {list.data?.items.map((c) => <ConvItem key={c.id} c={c} active={c.id === activeId} />)}
            {list.data && !list.data.items.length && <div className="empty"><LuInbox size={22} />Nothing here</div>}
            {!list.data && [0, 1, 2, 3, 4].map((i) => <div key={i} style={{ padding: 12 }}><div className="skeleton" style={{ height: 50 }} /></div>)}
          </div>
        </section>
        {activeId ? <Thread key={activeId} id={activeId} /> : <NoConversation stats={s} />}
      </div>
    </div>
  );
}

function previewText(last) {
  if (!last) return '';
  if (last.kind === 'template') return last.template_name;
  if (last.kind === 'button') return last.body;
  return last.body;
}

function ConvItem({ c, active }) {
  const { tz, now, boot } = useApp();
  const last = c.last;
  return (
    <a className={`conv-item ${active ? 'on' : ''}`} href={`#/inbox/${c.id}`} data-flip={`c${c.id}`}>
      <Avatar name={c.contact.name} />
      <div className="grow">
        <div className="top">
          <b className="ellipsis">{c.contact.name}</b>
          {c.waiting_since && <span className="unread-dot" title="Waiting on us" />}
          {c.pinned && <LuPin size={11} className="faint" />}
          <span className={`time ${c.unread ? 'new' : ''}`}>{last && fmtListTime(last.created_at, tz, now())}</span>
        </div>
        <div className="prev">
          {last?.direction === 'out' && <StatusTick status={last.status} />}
          {last?.kind === 'button' && <LuReply />}
          {last?.kind === 'template' && <LuFileText />}
          <span className={`ellipsis grow ${last?.kind === 'template' ? 'mono' : ''}`} style={{ color: c.unread ? 'var(--text)' : undefined, fontWeight: c.unread ? 600 : 500 }}>
            {last?.direction === 'out' && last.kind !== 'template' ? 'You: ' : ''}{previewText(last)}
          </span>
          {c.unread > 0 && <Badge n={c.unread} />}
        </div>
        <div className="tags">
          {!c.window_open && <Chip className="square outline"><LuLock />Template only</Chip>}
          {c.ai_mode === 'auto' && <Chip tone="accent" className="square"><LuBot />AI</Chip>}
          {c.labels.slice(0, 2).map((l) => <LabelChip key={l} name={l} labels={boot.workspace.labels} />)}
          {c.assignee ? <Avatar name={c.assignee.name} size="xs" tone="slate" /> : <span className="avatar xs" style={{ border: '1px dashed var(--border-strong)', color: 'var(--faint)', marginLeft: 'auto' }}><LuUser size={10} /></span>}
        </div>
      </div>
    </a>
  );
}

function NoConversation({ stats }) {
  const { boot, tz, now, navigate } = useApp();
  return (
    <>
      <section className="card pane" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="empty" style={{ maxWidth: 380 }}>
          <div className="icon-bubble"><FaWhatsapp size={28} /></div>
          <h3>Pick a conversation</h3>
          <p style={{ margin: 0 }}>Replies go out from {boot.workspace.name}'s WhatsApp number, {boot.whatsapp.display_phone}. Your whole team works from the same inbox.</p>
          <div className="row muted" style={{ marginTop: 10, fontSize: 12, gap: 14 }}>
            <span className="row" style={{ gap: 4 }}><kbd>↑</kbd><kbd>↓</kbd> move through the list</span>
            <span className="row" style={{ gap: 4 }}><kbd>/</kbd> quick replies</span>
          </div>
        </div>
      </section>
      <aside className="card pane ctx">
        <div className="side-panel">
          <div className="sp-section">
            <h4>Waiting on us</h4>
            {stats?.waiting_list.map((w) => (
              <button key={w.id} className="waiting-row" onClick={() => navigate(`inbox/${w.id}`)}>
                <Avatar name={w.name} size="sm" />
                <div><b>{w.name}</b><span className={w.urgent ? 'c-red' : ''}>Waiting {fmtDuration(now() - w.since)}</span></div>
                {w.urgent && <LabelChip name="Urgent" />}
                <LuChevronRight className="chev" />
              </button>
            ))}
            {stats && !stats.waiting_list.length && <div className="muted">Nobody is waiting 🎉</div>}
          </div>
          {stats?.window_closed > 0 && (
            <div className="info-box"><LuLock /><div><b>{stats.window_closed} conversations</b> are past the 24-hour window. Reopen them with an approved template.</div></div>
          )}
          <div className="info-box"><LuShieldCheck /><div>Private notes and alerts stay inside Xeroura. Use WhatsApp for bookings, reminders and directions.</div></div>
          <div className="faint" style={{ fontSize: 11.5 }}>Times shown in {tz.replace('_', ' ')}.</div>
        </div>
      </aside>
    </>
  );
}

function Thread({ id }) {
  const { boot, tz, now, run, openModal, navigate } = useApp();
  const conv = useApi(`/conversations/${id}`, { poll: 4000 });
  const [text, setText] = useState('');
  const [noteMode, setNoteMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [slash, setSlash] = useState(false);
  const scroller = useRef(null);
  const ta = useRef(null);
  const sendRef = useRef(null);
  const boxRef = useRef(null);
  const d = conv.data;
  const seen = useRef(null);
  const initial = useRef(null);
  const [held, setHeld] = useState(() => new Set());
  const stopTyping = useRef(null);

  // Auto-replies that arrive right after a customer message wait behind a typing indicator.
  useEffect(() => {
    if (!d) return undefined;
    const ids = d.messages.map((m) => m.id);
    if (!seen.current) { seen.current = new Set(ids); return undefined; }
    const fresh = d.messages.filter((m) => !seen.current.has(m.id));
    fresh.forEach((m) => seen.current.add(m.id));
    const hasInbound = fresh.some((m) => m.direction === 'in');
    const autos = fresh.filter((m) => m.direction === 'out' && ['ai', 'system'].includes(m.author) && m.kind !== 'template');
    if (hasInbound && autos.length) {
      setHeld(new Set(autos.map((m) => m.id)));
      const t = setTimeout(() => setHeld(new Set()), 1300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [d]);

  useEffect(() => { setText(''); setNoteMode(false); }, [id]);
  useEffect(() => { if (d?.unread > 0) post(`/conversations/${id}/read`).catch(() => {}); }, [d?.unread, id]);
  const msgCount = d?.messages.length;
  useEffect(() => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: seen.current ? 'smooth' : 'auto' }); }, [msgCount, id, held.size]);
  useEffect(() => () => stopTyping.current?.(), []);
  useEffect(() => {
    const el = ta.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(160, el.scrollHeight)}px`; }
  }, [text]);

  const groups = useMemo(() => {
    if (!d) return [];
    const out = [];
    let lastDay = null;
    for (const m of d.messages) {
      const k = dayKey(m.created_at, tz);
      if (k !== lastDay) { out.push({ sep: true, key: `sep-${k}`, ts: m.created_at }); lastDay = k; }
      out.push(m);
    }
    return out;
  }, [d, tz]);

  if (d && !initial.current) {
    const ids = d.messages.map((m) => m.id);
    initial.current = { last: ids.slice(-10), older: new Set(ids.slice(0, -10)) };
  }
  if (!d) return <section className="card pane"><div style={{ padding: 20 }}><div className="skeleton" style={{ height: 40 }} /></div></section>;

  const left = windowLeft(d.last_inbound_at, now());
  const open = left > 0;
  const contact = d.contact;
  const update = (body, msg) => run(() => patch(`/conversations/${id}`, body), msg);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const btn = sendRef.current;
    btn?.classList.remove('launch'); void btn?.offsetWidth; btn?.classList.add('launch');
    const r = await run(() => post(`/conversations/${id}/messages`, noteMode ? { body, note: true } : { body }));
    setSending(false);
    if (r) { setText(''); setNoteMode(false); }
  };

  const suggest = async () => {
    setSuggesting(true);
    const [r] = await Promise.all([run(() => post(`/conversations/${id}/suggest`)), new Promise((ok) => setTimeout(ok, 650))]);
    setSuggesting(false);
    if (r?.suggestion) {
      stopTyping.current?.();
      setText('');
      const box = boxRef.current;
      box?.classList.remove('ai-filled'); void box?.offsetWidth; box?.classList.add('ai-filled');
      stopTyping.current = typeInto(r.suggestion, setText, { cps: 110 });
      ta.current?.focus();
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); send(); }
    if (e.key === '/' && !text) { e.preventDefault(); setSlash(true); }
    if (e.key === 'Escape') setSlash(false);
  };

  return (
    <>
      <section className="card pane thread-pane">
        <div className="thread-head">
          <Avatar name={contact.name} />
          <div className="name grow">
            <b className="ellipsis" style={{ cursor: 'pointer' }} onClick={() => openModal({ type: 'contact-drawer', id: contact.id })}>{contact.name}</b>
            <span>{contact.phone}{contact.language && contact.language !== 'English' ? ` · ${contact.language}` : ''}</span>
          </div>
          <Menu width={220} trigger={({ toggle }) => (
            <button className="btn sm" onClick={toggle}>
              {d.assignee ? <Avatar name={d.assignee.name} size="xs" tone="slate" /> : <LuUser />}
              {d.assignee ? (d.assignee.id === boot.me.id ? 'You' : d.assignee.name.split(' ')[0]) : 'Assign'}
            </button>
          )}>
            <div className="menu-title">Assign to</div>
            {boot.staff.filter((s) => s.active).map((s) => (
              <button key={s.id} onClick={() => update({ assignee_id: s.id }, `Assigned to ${s.name}`)}>
                <Avatar name={s.name} size="xs" tone="slate" />{s.name}{s.id === boot.me.id && <span className="faint">(you)</span>}
                {d.assignee?.id === s.id && <LuCheck className="check" />}
              </button>
            ))}
            <hr /><button onClick={() => update({ assignee_id: null })}>Unassign</button>
          </Menu>
          <Menu width={200} trigger={({ toggle }) => <button className="btn sm" onClick={toggle} aria-label="Labels"><LuTag /></button>}>
            <div className="menu-title">Labels</div>
            {boot.workspace.labels.map((l) => {
              const on = d.labels.includes(l.name);
              return (
                <button key={l.name} data-keep onClick={() => update({ labels: on ? d.labels.filter((x) => x !== l.name) : [...d.labels, l.name], urgent: l.name === 'Urgent' ? !on : d.urgent })}>
                  <i className={`dot c-${l.color}`} />{l.name}{on && <LuCheck className="check" />}
                </button>
              );
            })}
          </Menu>
          {d.status === 'open'
            ? <AsyncBtn size="sm" variant="wa-soft" icon={LuCheck} doneLabel="Resolved" onClick={() => update({ status: 'resolved' }, 'Conversation resolved')}>Resolve</AsyncBtn>
            : <Btn size="sm" icon={LuRotateCcw} onClick={() => update({ status: 'open' }, 'Reopened')}>Reopen</Btn>}
          <Menu width={230} trigger={({ toggle }) => <button className="btn sm" onClick={toggle} aria-label="More"><LuEllipsis /></button>}>
            <button onClick={() => update({ pinned: !d.pinned })}><LuPin />{d.pinned ? 'Unpin' : 'Pin to top'}</button>
            <button onClick={() => openModal({ type: 'contact-drawer', id: contact.id })}><LuUser />Open contact</button>
            <button onClick={() => setTplOpen(true)}><LuFileText />Send a template</button>
            <hr />
            <div className="menu-title">AI replies</div>
            {[['auto', 'Auto-reply when confident'], ['assist', 'Suggest only'], ['off', 'Off (human only)']].map(([v, l]) => (
              <button key={v} onClick={() => update({ ai_mode: v }, `AI: ${l.toLowerCase()}`)}><LuBot />{l}{d.ai_mode === v && <LuCheck className="check" />}</button>
            ))}
          </Menu>
        </div>
        <div className="thread-sub" style={{ paddingTop: 0 }}>
          {open
            ? <Chip tone="wa"><LuClock />Reply window {fmtDuration(left)} left</Chip>
            : <Chip tone="amber"><LuLock />Window closed · templates only</Chip>}
          {contact.opt_in === 'opted_in' && <Chip tone="wa"><FaWhatsapp />WhatsApp opted in</Chip>}
          {contact.opt_in === 'opted_out' && <Chip tone="red">Opted out</Chip>}
          {d.labels.map((l) => <LabelChip key={l} name={l} labels={boot.workspace.labels} />)}
          {d.pinned && <Chip className="outline"><LuPin />Pinned</Chip>}
          {boot.workspace.ai.enabled && d.ai_mode === 'auto' && <Chip tone="accent"><LuBot />AI auto-reply on</Chip>}
        </div>

        <div className="thread" ref={scroller}>
          {groups.map((m) => {
            if (m.sep) return <div key={m.key} className="day-sep">{fmtRelDay(m.ts, tz, now()) === 'Today' ? 'Today' : fmtDate(m.ts, tz, { weekday: 'short', month: 'short', day: 'numeric' })}</div>;
            if (held.has(m.id)) return null;
            const init = initial.current;
            const order = init.last.indexOf(m.id);
            const style = init.older.has(m.id) ? { animation: 'none' } : order >= 0 ? { animationDelay: `${100 + order * 45}ms` } : undefined;
            return <Message key={m.id} m={m} tz={tz} style={style} />;
          })}
          {held.size > 0 && <div className={`typing ${[...held].some((hid) => d.messages.find((x) => x.id === hid)?.author === 'ai') ? 'ai' : ''}`}><i /><i /><i /></div>}
          {!d.messages.length && <div className="event">No messages yet — send a template to start the conversation.</div>}
        </div>

        <div className="composer">
          {open || noteMode ? (
            <>
              <div className="snippets">
                {boot.workspace.ai.enabled && (
                  <button className={`snippet ai ${suggesting ? 'thinking' : ''}`} onClick={suggest} disabled={suggesting}><LuSparkles />{suggesting ? 'Thinking…' : 'Suggest reply'}</button>
                )}
                {boot.quick_replies.slice(0, 5).map((r) => (
                  <button key={r.id} className="snippet" onClick={() => { setText((t) => (t ? `${t} ${r.body}` : r.body)); ta.current?.focus(); }}><LuZap />{r.title}</button>
                ))}
              </div>
              <div className="compose-row">
                <div ref={boxRef} className={`compose-box ${noteMode ? 'note' : ''}`} style={{ position: 'relative' }}>
                  {slash && (
                    <div className="menu" style={{ bottom: 'calc(100% + 6px)', left: 0, width: 320 }}>
                      <div className="menu-title">Quick replies</div>
                      {boot.quick_replies.map((r) => (
                        <button key={r.id} onClick={() => { setText(r.body); setSlash(false); ta.current?.focus(); }}><LuZap />{r.title}</button>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={ta}
                    rows={1}
                    value={text}
                    placeholder={noteMode ? 'Private note — only your team sees this' : `Message ${contact.name.split(' ')[0]} on WhatsApp…  ( / for quick replies)`}
                    onChange={(e) => { setText(e.target.value); if (slash && e.target.value) setSlash(false); }}
                    onKeyDown={onKey}
                    onBlur={() => setTimeout(() => setSlash(false), 150)}
                  />
                  <div className="compose-tools">
                    <button className={`btn ghost sm ${noteMode ? 'soft' : ''}`} onClick={() => setNoteMode((n) => !n)} title="Private note"><LuStickyNote />Note</button>
                    <button className="btn ghost sm" onClick={() => setTplOpen(true)} title="Send template"><LuFileText />Template</button>
                    <span className="faint" style={{ marginLeft: 'auto', fontSize: 11 }}>Enter to send · Shift+Enter new line</span>
                  </div>
                </div>
                <button ref={sendRef} className="send-btn" onClick={send} disabled={!text.trim() || sending} aria-label="Send" style={noteMode ? { background: 'var(--amber)' } : undefined}>
                  {noteMode ? <LuStickyNote /> : <LuSendHorizontal />}
                </button>
              </div>
            </>
          ) : (
            <div className="closed-banner">
              <LuLock size={16} />
              <div>The 24-hour window closed {d.last_inbound_at ? fmtRelDay(d.last_inbound_at + 864e5, tz, now()).toLowerCase() : ''}. Send an approved template — free replies reopen once {contact.name.split(' ')[0]} answers.</div>
              <Btn size="sm" variant="wa" icon={FaWhatsapp} onClick={() => setTplOpen(true)}>Send template</Btn>
              <Btn size="sm" icon={LuStickyNote} onClick={() => setNoteMode(true)}>Note</Btn>
            </div>
          )}
        </div>
      </section>
      <ContextPanel d={d} />
      {tplOpen && <TemplatePicker conv={d} onClose={() => setTplOpen(false)} />}
    </>
  );
}

function Message({ m, tz, style }) {
  if (m.kind === 'event') {
    return <div className="event" style={style}>{/window/i.test(m.body) ? <LuLock /> : <LuCircleCheck />}{m.body}</div>;
  }
  const out = m.direction === 'out';
  const cls = ['bubble', out ? 'out' : 'in', m.kind === 'note' ? 'note' : '', m.author === 'ai' ? 'ai' : '', m.kind === 'button' ? 'button' : '', m.status === 'failed' ? 'failed' : ''].join(' ');
  return (
    <div className={cls} style={style}>
      {m.kind === 'note' && <div className="who"><LuStickyNote />Note · {m.author_name}</div>}
      {m.author === 'ai' && <div className="who"><LuBot />{m.author_name || 'Xeroura AI'}</div>}
      {m.author === 'system' && m.kind !== 'template' && <div className="who"><LuZap />{m.author_name || 'Automation'}</div>}
      {m.kind === 'template' && <div className="tpl-label"><LuFileText />Template · {m.template?.name}</div>}
      {m.kind === 'template' && m.template?.header && <div className="tpl-head">{m.template.header}</div>}
      {m.kind === 'button' && <LuReply size={13} />}
      {m.body}
      {m.kind === 'template' && m.template?.footer && <div className="tpl-foot">{m.template.footer}</div>}
      <div className="meta">
        {out && m.author === 'agent' && m.author_name && m.kind !== 'note' && <span>{m.author_name.split(' ')[0]} ·</span>}
        {fmtTime(m.created_at, tz)}
        {out && m.kind !== 'note' && <StatusTick status={m.status} />}
      </div>
      {m.status === 'failed' && <div className="c-red" style={{ fontSize: 11.5, fontWeight: 700 }}>{m.error || 'Not delivered'}</div>}
      {m.kind === 'template' && m.template?.buttons?.length > 0 && (
        <div className="tpl-buttons">{m.template.buttons.map((b) => <div key={b}><LuReply />{b}</div>)}</div>
      )}
    </div>
  );
}

function ContextPanel({ d }) {
  const { boot, tz, now, run, openModal } = useApp();
  const c = d.contact;
  const [note, setNote] = useState(c.notes || '');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setNote(c.notes || ''); }, [c.id, c.notes]);
  const nb = c.next_booking;
  const remind = () => run(() => post(`/bookings/${nb.id}/remind`), 'Reminder sent on WhatsApp');
  const reminderText = {
    none: 'No reminder sent yet', sent: 'Reminder sent', delivered: 'Reminder delivered', read: 'Reminder read',
    confirmed: 'Confirmed by customer', reschedule: 'Asked to reschedule', failed: "Reminder couldn't be delivered",
  };
  return (
    <aside className="card pane ctx thread-pane" style={{ animationDelay: '60ms' }}>
      <div className="pane-scroll side-panel">
        <div className="row" style={{ gap: 12 }}>
          <Avatar name={c.name} size="lg" />
          <div className="grow">
            <b style={{ fontSize: 16, display: 'block' }}>{c.name}</b>
            <span className="muted" style={{ fontSize: 12.5 }}>{c.visits} visits{c.owner ? ` · usually ${c.owner.name.split(' ')[0]}` : ''}</span>
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: -6 }}>
          {c.tags.map((t) => <Chip key={t} tone={tagTone(t)} className="square">{t}</Chip>)}
        </div>
        {c.opt_in === 'opted_in' && c.opt_in_at && <div className="row muted" style={{ fontSize: 12, marginTop: -8 }}><Chip tone="wa"><FaWhatsapp />Opted in</Chip>since {fmtDate(c.opt_in_at, tz, { month: 'short', day: 'numeric', year: 'numeric' })}</div>}

        <div className="sp-section">
          <h4>Next appointment</h4>
          {nb ? (
            <div className="appt-card">
              <div className="row"><span className="when">{fmtRelDay(nb.start, tz, now())}</span><Chip className="square" style={{ marginLeft: 'auto' }} tone={nb.status === 'confirmed' ? 'wa' : 'slate'} dot>{nb.status === 'confirmed' ? 'Confirmed' : 'Booked'}</Chip></div>
              <div className="muted">{fmtTime(nb.start, tz)} · {nb.service.name}</div>
              <div className="kv"><Avatar name={nb.staff.name} size="xs" tone={nb.staff.color} />{nb.staff.name}{nb.staff.resource ? ` · ${nb.staff.resource}` : ''}</div>
              <div className={`kv ${nb.reminder === 'confirmed' ? 'c-wa' : nb.reminder === 'failed' || nb.reminder === 'reschedule' ? 'c-amber' : ''}`}>
                {nb.reminder === 'read' || nb.reminder === 'confirmed' ? <LuCheck /> : <LuBell />}
                {reminderText[nb.reminder]}{nb.reminder_at && nb.reminder !== 'none' ? ` · ${fmtListTime(nb.reminder_at, tz, now())}` : ''}
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {c.opt_in === 'opted_in' && nb.reminder !== 'confirmed' && (
                  <AsyncBtn size="sm" variant="wa" icon={FaWhatsapp} doneLabel="Sent" minMs={700} onClick={remind}>{nb.reminder === 'none' ? 'Send reminder' : 'Remind again'}</AsyncBtn>
                )}
                <Btn size="sm" icon={LuCalendarClock} onClick={() => openModal({ type: 'booking', prefill: { reschedule: nb } })}>Reschedule</Btn>
              </div>
            </div>
          ) : <div className="muted" style={{ fontSize: 12.5 }}>Nothing booked.</div>}
          <Btn variant="dark" size="sm" icon={LuCalendarDays} style={{ marginTop: 10 }} onClick={() => openModal({ type: 'booking', prefill: { contact: c } })}>Book appointment</Btn>
        </div>

        <div className="sp-section">
          <h4>Last visit</h4>
          {c.last_visit ? (
            <div className="kv" style={{ alignItems: 'flex-start' }}><LuCalendarDays style={{ marginTop: 2 }} /><div><b style={{ color: 'var(--text)' }}>{fmtDate(c.last_visit.start, tz, { month: 'short', day: 'numeric', year: 'numeric' })}</b> · {c.last_visit.service} with {c.last_visit.staff.split(' ')[0]}<div className="faint">{c.visits} visits · {c.no_shows} no-shows</div></div></div>
          ) : <div className="muted" style={{ fontSize: 12.5 }}>First-time customer</div>}
        </div>

        <div className="sp-section">
          <h4>Alerts</h4>
          <div className="kv" style={{ fontSize: 11.5, marginBottom: 6 }}><LuLock />Never shared on WhatsApp</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {c.alerts.length ? c.alerts.map((a) => <Chip key={a} tone="red" className="square lg"><LuTriangleAlert />{a}</Chip>) : <span className="muted" style={{ fontSize: 12.5 }}>None</span>}
          </div>
        </div>

        <div className="sp-section">
          <h4>Internal note</h4>
          <textarea
            className="note-area"
            value={note}
            placeholder="Preferences, context for the team…"
            onChange={(e) => setNote(e.target.value)}
            onBlur={async () => { if (note !== (c.notes || '')) { await run(() => patch(`/contacts/${c.id}`, { notes: note })); setSaved(true); setTimeout(() => setSaved(false), 2000); } }}
          />
          <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>{saved ? 'Saved ✓' : 'Saved when you click away.'}</div>
        </div>
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => openModal({ type: 'contact-drawer', id: c.id })}><LuUser />Open contact</button>
        <div className="kv"><LuPhone />{c.phone}</div>
        <span className="sr">{boot.workspace.name}</span>
      </div>
    </aside>
  );
}

function TemplatePicker({ conv, onClose }) {
  const { boot, run } = useApp();
  const approved = boot.templates.filter((t) => t.status === 'approved');
  const [sel, setSel] = useState(approved[0]?.id);
  const t = approved.find((x) => x.id === sel);
  return (
    <Modal wide title={`Send a template to ${conv.contact.name.split(' ')[0]}`} icon={<FaWhatsapp className="c-wa" size={18} />} onClose={onClose} footer={<>
      <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Variables are filled from the contact and their next booking.</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn wa" disabled={!t} onClick={async () => { const r = await run(() => post(`/conversations/${conv.id}/messages`, { template_id: t.id }), 'Template sent'); if (r) onClose(); }}><LuSendHorizontal />Send</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14 }}>
        <div className="col" style={{ gap: 4 }}>
          {approved.map((x) => (
            <button key={x.id} className={`palette-item ${x.id === sel ? 'on' : ''}`} onClick={() => setSel(x.id)}>
              <LuFileText /><span className="mono ellipsis">{x.name}</span>
              <small>{x.category}</small>
            </button>
          ))}
        </div>
        {t && (
          <div className="wa-preview">
            <div className="bubble out" style={{ maxWidth: '100%' }}>
              <div className="tpl-label"><LuFileText />Template · {t.name}</div>
              {t.header && <div className="tpl-head">{t.header}</div>}
              {t.body}
              {t.footer && <div className="tpl-foot">{t.footer.replace('{{business_name}}', boot.workspace.name)}</div>}
              {t.buttons.length > 0 && <div className="tpl-buttons">{t.buttons.map((b) => <div key={b}><LuReply />{b}</div>)}</div>}
            </div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>{t.category === 'marketing' ? 'Marketing templates are billed per conversation by Meta.' : 'Utility template — used for bookings and reminders.'}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export { LuMailOpen, get };
