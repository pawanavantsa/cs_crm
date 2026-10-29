import { useEffect, useRef, useState } from 'react';
import { useFlip } from '../motion.js';
import {
  LuUsers, LuUserPlus, LuDownload, LuSearch, LuArrowUpDown, LuChevronLeft, LuChevronRight, LuEllipsis, LuHourglass,
  LuRefreshCw, LuSquareCheck, LuCalendarDays, LuMessageCircle, LuUserX,
} from 'react-icons/lu';
import { FaWhatsapp } from 'react-icons/fa';
import { useApi, get, post, patch } from '../api.js';
import { useApp, Avatar, Chip, Btn, Stat, Seg, Menu, tagTone, pct, Num } from '../ui.jsx';
import { fmtDate, fmtRelDay, fmtTime } from '../lib/time.js';
import { downloadText } from '../App.jsx';

const TAGS = ['New', 'Regular', 'VIP', 'Membership', 'Lapsed', 'Bridal', 'Needs follow-up', 'Recall due'];

export function OptChip({ v }) {
  if (v === 'opted_in') return <Chip tone="wa"><FaWhatsapp />Opted in</Chip>;
  if (v === 'pending') return <Chip tone="amber"><LuHourglass />Pending</Chip>;
  return <Chip tone="red"><LuUserX />Opted out</Chip>;
}

const STATUS_CHIP = {
  booked: ['slate', 'Booked'], confirmed: ['wa', 'Confirmed'], arrived: ['amber', 'Waiting'], in_service: ['blue', 'In service'],
};

export default function Contacts() {
  const { boot, tz, now, run, openModal, navigate } = useApp();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [opt, setOpt] = useState('all');
  const [tag, setTag] = useState('all');
  const [owner, setOwner] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(new Set());
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 200); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ q: dq, opt_in: opt, tag, owner_id: owner, sort: sort.key, dir: sort.dir, page, page_size: 25 }).toString();
  const { data } = useApi(`/contacts?${qs}`);
  const bodyRef = useRef(null);
  useFlip(bodyRef, data);
  const providers = boot.staff.filter((s) => !s.is_agent);

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  const th = (key, label) => <th><button onClick={() => sortBy(key)}>{label}<LuArrowUpDown size={12} className={sort.key === key ? '' : 'faint'} /></button></th>;
  const allShown = data?.items.every((c) => sel.has(c.id));
  const exportCsv = async () => { const r = await run(() => get('/contacts/export')); if (r) downloadText(r.filename, r.csv); };
  const message = async (c) => { const r = await run(() => post('/conversations', { contact_id: c.id })); if (r) navigate(`inbox/${r.id}`); };

  return (
    <div className="content">
      <div className="page-head">
        <div><div className="eyebrow">{boot.workspace.name}</div><h1>Contacts</h1></div>
        <div className="head-actions">
          <Btn icon={LuDownload} onClick={exportCsv}>Export CSV</Btn>
          <Btn variant="primary" icon={LuUserPlus} onClick={() => openModal({ type: 'contact' })}>New contact</Btn>
        </div>
      </div>
      <div className="stats">
        <Stat icon={LuUsers} label="Contacts" value={data?.stats.total ?? '–'} />
        <Stat icon={LuUserPlus} label="New this month" value={data?.stats.new_this_month ?? '–'}><Chip className="square">since the 1st</Chip></Stat>
        <Stat icon={FaWhatsapp} label="WhatsApp opt-in rate" value={data ? pct(data.stats.opt_in_rate) : '–'} />
        <Stat icon={LuRefreshCw} label="Recall due" value={data?.stats.recall_due ?? '–'}><Chip tone="orange" className="square">no visit in 45 days</Chip></Stat>
      </div>

      <div className="toolbar">
        <div className="input-wrap" style={{ width: 280 }}><LuSearch /><input className="input pill-input" placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Seg value={opt} onChange={(v) => { setOpt(v); setPage(1); }} options={[
          { value: 'all', label: 'All' }, { value: 'opted_in', label: 'Opted in', n: data?.opt_counts.opted_in },
          { value: 'pending', label: 'Pending', n: data?.opt_counts.pending }, { value: 'opted_out', label: 'Opted out', n: data?.opt_counts.opted_out },
        ]} />
        <div style={{ marginLeft: 'auto' }} className="row">
          <select className="select pill-input" style={{ width: 170 }} value={owner} onChange={(e) => { setOwner(e.target.value); setPage(1); }}>
            <option value="">All team members</option>
            {providers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="select pill-input" style={{ width: 140 }} value={sort.key} onChange={(e) => setSort({ key: e.target.value, dir: e.target.value === 'name' ? 'asc' : 'desc' })}>
            <option value="name">Name</option><option value="last_visit">Last visit</option><option value="next">Next booking</option><option value="visits">Visits</option><option value="created">Newest</option>
          </select>
        </div>
      </div>
      <div className="seg-chips">
        <button className={`seg-chip ${tag === 'all' ? 'on' : ''}`} onClick={() => { setTag('all'); setPage(1); }}>All <span className="n">{data?.stats.total}</span></button>
        {TAGS.map((t) => (
          <button key={t} className={`seg-chip ${tag === t ? 'on' : ''}`} onClick={() => { setTag(t); setPage(1); }}>
            <i className={`dot c-${tagTone(t)}`} />{t}<span className="n"><Num value={data?.tag_counts[t] ?? 0} /></span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <span className="muted">Showing <b style={{ color: 'var(--text)' }}><Num value={data?.items.length ?? 0} /></b> of <Num value={data?.total ?? 0} /></span>
          {sel.size > 0 && (
            <>
              <Chip tone="accent" className="lg">{sel.size} selected</Chip>
              <Menu width={200} align="left" trigger={({ toggle }) => <Btn size="sm" onClick={toggle}>Add tag</Btn>}>
                {TAGS.filter((t) => t !== 'Recall due').map((t) => (
                  <button key={t} onClick={async () => {
                    await run(async () => { for (const id of sel) { const c = data.items.find((x) => x.id === id) || (await get(`/contacts/${id}`)); if (!c.tags.includes(t)) await patch(`/contacts/${id}`, { tags: [...c.tags, t] }); } }, `Tagged ${sel.size} contacts`);
                    setSel(new Set());
                  }}><i className={`dot c-${tagTone(t)}`} />{t}</button>
                ))}
              </Menu>
              <Btn size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Btn>
            </>
          )}
          <Btn size="sm" icon={LuSquareCheck} style={{ marginLeft: 'auto' }} onClick={() => setSel((s) => { const n = new Set(s); data.items.forEach((c) => (allShown ? n.delete(c.id) : n.add(c.id))); return n; })}>{allShown ? 'Unselect shown' : 'Select all shown'}</Btn>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                {th('name', 'Contact')}
                <th>Tags</th>
                <th>Usually with</th>
                {th('last_visit', 'Last visit')}
                {th('next', 'Next booking')}
                {th('visits', 'Visits')}
                <th>WhatsApp</th>
                <th style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {data?.items.map((c) => (
                <tr key={c.id} data-flip={`r${c.id}`} onClick={() => openModal({ type: 'contact-drawer', id: c.id })}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="cb" checked={sel.has(c.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} /></td>
                  <td><div className="person"><Avatar name={c.name} /><div><b>{c.name}</b><span>{c.phone}</span></div></div></td>
                  <td><div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{c.tags.length ? c.tags.slice(0, 3).map((t) => <Chip key={t} tone={tagTone(t)} className="square">{t}</Chip>) : <span className="faint">—</span>}</div></td>
                  <td>{c.owner ? <div className="row" style={{ gap: 7 }}><Avatar name={c.owner.name} size="xs" tone={c.owner.color} />{c.owner.name}</div> : <span className="faint">—</span>}</td>
                  <td className="num">{c.last_visit ? fmtDate(c.last_visit.start, tz) : <span className="faint">—</span>}</td>
                  <td>
                    {c.next_booking ? (
                      <div className="row" style={{ gap: 8 }}>
                        <div><b style={{ display: 'block', fontSize: 12.5 }}>{fmtRelDay(c.next_booking.start, tz, now())}</b><span className="muted" style={{ fontSize: 11.5 }}>{fmtTime(c.next_booking.start, tz)}</span></div>
                        <Chip className="square" dot tone={STATUS_CHIP[c.next_booking.status]?.[0]}>{STATUS_CHIP[c.next_booking.status]?.[1]}</Chip>
                      </div>
                    ) : c.recall_due !== undefined && c.last_visit && now() - c.last_visit.start > 45 * 864e5 ? <Chip tone="orange" className="square">Recall due</Chip> : <span className="faint">—</span>}
                  </td>
                  <td className="num">{c.visits}</td>
                  <td><OptChip v={c.opt_in} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ gap: 2 }}>
                      <button className="btn ghost sm" disabled={c.opt_in !== 'opted_in'} title="Message on WhatsApp" onClick={() => message(c)}><FaWhatsapp className="c-wa" /></button>
                      <Menu width={190} trigger={({ toggle }) => <button className="btn ghost sm" onClick={toggle} aria-label="More"><LuEllipsis /></button>}>
                        <button onClick={() => openModal({ type: 'booking', prefill: { contact: c } })}><LuCalendarDays />Book appointment</button>
                        <button onClick={() => message(c)}><LuMessageCircle />Open chat</button>
                        <hr />
                        {c.opt_in !== 'opted_out'
                          ? <button className="danger" onClick={() => run(() => patch(`/contacts/${c.id}`, { opt_in: 'opted_out' }), `${c.name} opted out`)}><LuUserX />Mark opted out</button>
                          : <button onClick={() => run(() => patch(`/contacts/${c.id}`, { opt_in: 'pending' }), 'Marked pending')}><LuHourglass />Ask to opt in again</button>}
                      </Menu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data && <div style={{ padding: 16 }} className="col">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 40 }} />)}</div>}
          {data && !data.items.length && <div className="empty">No contacts match.</div>}
        </div>
        {data && data.total > data.page_size && (
          <div className="pager">
            <span>Page {page} of {Math.ceil(data.total / data.page_size)}</span>
            <div className="row">
              <Btn size="sm" icon={LuChevronLeft} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn>
              <Btn size="sm" disabled={page >= Math.ceil(data.total / data.page_size)} onClick={() => setPage(page + 1)}>Next<LuChevronRight /></Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
