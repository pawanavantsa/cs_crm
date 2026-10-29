import { useRef, useState } from 'react';
import { useFlip } from '../motion.js';
import {
  LuCalendarDays, LuDoorOpen, LuMessageCircle, LuActivity, LuArrowUpRight, LuCheck, LuPhoneCall, LuClock,
  LuLogIn, LuLock, LuUndo2, LuEllipsis, LuUserX,
} from 'react-icons/lu';
import { FaWhatsapp } from 'react-icons/fa';
import { useApi, post } from '../api.js';
import { useApp, Avatar, Chip, Btn, Stat, Menu, LabelChip, pct, Num, Badge, AsyncBtn } from '../ui.jsx';
import { fmtTime, fmtLongDay, greeting, fmtListTime, fmtDuration } from '../lib/time.js';

const COLS = [
  { key: 'expected', label: 'Expected', tone: 'slate' },
  { key: 'waiting', label: 'Waiting', tone: 'amber' },
  { key: 'in_service', label: 'In service', tone: 'blue' },
  { key: 'done', label: 'Done', tone: 'wa' },
];

export default function Today() {
  const { boot, tz, now, run, openModal, navigate } = useApp();
  const { data } = useApi('/today');
  const boardRef = useRef(null);
  const waRef = useRef(null);
  useFlip(boardRef, data);
  useFlip(waRef, data);
  const [expanded, setExpanded] = useState({});
  const t = now();

  const [pinned, setPinned] = useState(() => new Set());
  // Keep a card the user just moved on screen, so it visibly lands in its new column.
  const act = (b, action, msg) => { setPinned((p) => new Set(p).add(b.id)); return run(() => post(`/bookings/${b.id}/action`, { action }), msg); };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <div className="eyebrow">{fmtLongDay(t, tz)} · {boot.workspace.name}</div>
          <h1>{greeting(t, tz)}, {boot.me.name.split(' ')[0]}</h1>
        </div>
        <div className="head-actions">
          <Btn icon={LuCalendarDays} onClick={() => openModal({ type: 'booking' })}>New booking</Btn>
          <AsyncBtn
            variant="wa"
            icon={FaWhatsapp}
            doneLabel="Reminders sent"
            disabled={!data?.tomorrow_unreminded}
            minMs={900}
            onClick={() => run(() => post('/reminders/tomorrow'), (r) => `Sent ${r.sent} reminders for tomorrow${r.skipped ? ` · ${r.skipped} skipped (no opt-in)` : ''}`)}
          >
            Remind tomorrow <span className="pill-count"><Num value={data?.tomorrow_unreminded ?? 0} /></span>
          </AsyncBtn>
        </div>
      </div>

      <div className="stats">
        <Stat icon={LuCalendarDays} label="Appointments today" value={data?.stats.appointments_today ?? '–'}>
          <Chip className="square">{data?.stats.seen ?? 0} done</Chip>
        </Stat>
        <Stat icon={LuDoorOpen} label="In the waiting area" value={data?.stats.waiting ?? '–'}>
          <Chip tone={data?.stats.avg_wait_min > 15 ? 'amber' : 'wa'} className="square">avg {data?.stats.avg_wait_min ?? 0} min</Chip>
        </Stat>
        <Stat icon={FaWhatsapp} label="Unread on WhatsApp" value={data?.stats.unread_whatsapp ?? '–'}>
          <Chip className="square">reply in ~{data?.stats.median_reply_min ?? 0} min</Chip>
        </Stat>
        <Stat icon={LuActivity} label="No-shows, last 30 days" value={data ? pct(data.stats.no_show_30d, 1) : '–'}>
          {data && <Chip tone="wa" className="square">was {pct(data.stats.no_show_before, 0)} before reminders</Chip>}
        </Stat>
      </div>

      <div className="today-grid">
        <section className="card flow">
          <div className="card-head">
            <LuActivity className="c-wa" /><h2>Customer flow</h2>
            <div className="right">
              {data && `${data.flow.waiting.length} waiting · ${data.resources_free} ${data.resources_free === 1 ? 'chair/room' : 'chairs/rooms'} free`}
              <a className="round-link" href="#/schedule" aria-label="Open schedule"><LuArrowUpRight size={15} /></a>
            </div>
          </div>
          <div className="flow-cols" ref={boardRef}>
            {COLS.map((c) => {
              const items = data?.flow[c.key] || [];
              const limit = c.key === 'done' ? 4 : 5;
              const shown = expanded[c.key] ? items : items.filter((x, i) => i < limit || pinned.has(x.id));
              return (
                <div className="flow-col" key={c.key} data-flip-group={c.key}>
                  <div className="flow-col-head"><i className={`dot c-${c.tone}`} />{c.label}<span className="n num"><Num value={items.length} /></span></div>
                  {!data && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 78 }} />)}
                  {shown.map((b) => (c.key === 'done'
                    ? <DoneRow key={b.id} b={b} tz={tz} onUndo={() => act(b, 'undo')} />
                    : <FlowCard key={b.id} b={b} col={c.key} tz={tz} now={t} act={act} />))}
                  {items.length > shown.length || expanded[c.key] ? (
                    <button className="more-link" onClick={() => setExpanded((e) => ({ ...e, [c.key]: !e[c.key] }))}>
                      {expanded[c.key] ? 'Show less' : `+${items.length - shown.length} more ${c.key === 'done' ? 'done' : 'today'}`}
                    </button>
                  ) : null}
                  {data && !items.length && <div className="faint" style={{ textAlign: 'center', padding: 18, fontSize: 12 }}>Nobody here</div>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <FaWhatsapp className="c-wa" /><h2>WhatsApp</h2>
            <div className="right">{data?.waiting_on_us ?? 0} waiting on us</div>
          </div>
          <div className="wa-list" ref={waRef}>
            {data?.whatsapp.map((c) => (
              <button key={c.id} data-flip={`c${c.id}`} className={`wa-item ${c.urgent && c.unread ? 'urgent' : ''}`} onClick={() => navigate(`inbox/${c.id}`)}>
                <Avatar name={c.contact.name} />
                <div className="grow">
                  <div className="top"><b className="ellipsis">{c.contact.name}</b><span className={`time ${c.unread ? 'new' : ''}`}>{c.last && fmtListTime(c.last.created_at, tz, t)}</span></div>
                  <div className="prev">
                    <span className="ellipsis" style={{ color: c.unread ? 'var(--text)' : undefined, fontWeight: c.unread ? 600 : 500 }}>
                      {c.last?.direction === 'out' ? 'You: ' : ''}{c.last?.kind === 'template' ? c.last.template_name : c.last?.body}
                    </span>
                    {c.unread > 0 ? <Badge n={c.unread} /> : !c.window_open && <LuLock size={12} className="faint" />}
                  </div>
                  {c.urgent && c.unread > 0 && <div style={{ marginTop: 5 }}><LabelChip name="Urgent" /></div>}
                </div>
              </button>
            ))}
            {data && !data.whatsapp.length && <div className="empty"><LuMessageCircle size={22} />No open chats</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function FlowCard({ b, col, tz, now, act }) {
  const { openModal } = useApp();
  const waitMin = b.arrived_at ? (now - b.arrived_at) / 60000 : 0;
  return (
    <div data-flip={`b${b.id}`} className={`pcard ${col === 'waiting' ? 'waiting' : ''} ${col === 'in_service' ? 'inservice' : ''}`}>
      <div className="who">
        <Avatar name={b.contact.name} size="sm" />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="ellipsis" style={{ cursor: 'pointer' }} onClick={() => openModal({ type: 'contact-drawer', id: b.contact.id })}>{b.contact.name}</b>
          <div className="meta"><i className={`dot c-${b.staff.color}`} />{fmtTime(b.start, tz)} · {b.staff.name.split(' ')[0]}</div>
        </div>
        <span className="more"><Menu width={190} trigger={({ toggle }) => <button className="btn ghost sm" onClick={toggle} aria-label="More"><LuEllipsis /></button>}>
          <button onClick={() => openModal({ type: 'contact-drawer', id: b.contact.id })}><LuLogIn />Open contact</button>
          {col !== 'expected' && <button onClick={() => act(b, 'undo')}><LuUndo2 />Move back</button>}
          {col === 'expected' && <button className="danger" onClick={() => act(b, 'no_show', `${b.contact.name} marked as no-show`)}><LuUserX />Mark no-show</button>}
        </Menu></span>
      </div>
      {col === 'in_service' && (
        <div>
          <div className="bar thin"><i style={{ width: `${(b.progress || 0) * 100}%`, background: 'var(--blue)' }} /></div>
          <div className="meta" style={{ marginTop: 5 }}>{b.service.name} · {b.staff.resource}</div>
        </div>
      )}
      <div className="foot">
        {col === 'expected' && (b.status === 'confirmed' ? <span className="meta c-wa" title="Confirmed on WhatsApp" style={{ fontWeight: 700 }}><LuCheck size={13} />Conf.</span> : <span className="meta" title={b.service.name}>{b.service.name}</span>)}
        {col === 'waiting' && <span className={`wait ${waitMin > 15 ? 'long' : ''}`}><LuClock />{Math.max(1, Math.round(waitMin))} min</span>}
        {col === 'expected' && <Btn size="sm" variant="soft" icon={LuDoorOpen} onClick={() => act(b, 'check_in', `${b.contact.name} checked in`)}>Check in</Btn>}
        {col === 'waiting' && <Btn size="sm" variant="dark" icon={LuPhoneCall} onClick={() => act(b, 'start', `${b.contact.name} is with ${b.staff.name.split(' ')[0]}`)}>Call in</Btn>}
        {col === 'in_service' && <Btn size="sm" variant="dark" icon={LuCheck} onClick={() => act(b, 'finish', `${b.contact.name} done`)}>Finish</Btn>}
      </div>
    </div>
  );
}

function DoneRow({ b, tz, onUndo }) {
  return (
    <div className="mini-row" data-flip={`b${b.id}`}>
      <Avatar name={b.contact.name} size="sm" />
      <div className="grow" style={{ minWidth: 0 }}>
        <b className="ellipsis" style={{ display: 'block', fontSize: 12.5 }}>{b.contact.name}</b>
        <div className="muted" style={{ fontSize: 11.5 }}><i className={`dot c-${b.staff.color}`} /> {fmtTime(b.start, tz)} · {b.staff.name.split(' ')[0]}</div>
      </div>
      <button className="btn ghost sm" title="Move back to In service" onClick={onUndo}><LuUndo2 /></button>
    </div>
  );
}

export { fmtDuration };
