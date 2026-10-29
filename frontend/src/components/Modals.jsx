import { useEffect, useMemo, useState } from 'react';
import {
  LuCalendarDays, LuUserPlus, LuSearch, LuMessageCircle, LuCheck, LuDoorOpen, LuPhoneCall, LuUserX, LuX, LuUndo2,
  LuCalendarClock, LuBell, LuTriangleAlert, LuPencil, LuStickyNote,
} from 'react-icons/lu';
import { FaWhatsapp } from 'react-icons/fa';
import { useApi, get, post, patch } from '../api.js';
import { useApp, Modal, Drawer, Avatar, Chip, Btn, Toggle, tagTone, AsyncBtn } from '../ui.jsx';
import {
  dayKey, parseDayKey, zonedToUtc, fmtTime, fmtRelDay, fmtDate, weekdayOfKey, minutesOfDay,
} from '../lib/time.js';
import { OptChip } from '../pages/Contacts.jsx';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function ContactPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  useEffect(() => {
    if (!q.trim()) { setRes([]); return undefined; }
    const t = setTimeout(async () => { const r = await get(`/contacts?q=${encodeURIComponent(q)}&page_size=6`); setRes(r.items); }, 150);
    return () => clearTimeout(t);
  }, [q]);
  if (value) {
    return (
      <div className="row" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '6px 8px' }}>
        <Avatar name={value.name} size="sm" /><b className="grow">{value.name}</b><span className="muted">{value.phone}</span>
        <button className="btn ghost sm" onClick={() => onChange(null)} aria-label="Change"><LuX /></button>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <div className="input-wrap"><LuSearch /><input autoFocus className="input" placeholder="Search by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {res.length > 0 && (
        <div className="menu" style={{ left: 0, right: 0, top: 'calc(100% + 4px)' }}>
          {res.map((c) => <button key={c.id} onClick={() => onChange(c)}><Avatar name={c.name} size="xs" />{c.name}<span className="faint" style={{ marginLeft: 'auto' }}>{c.phone}</span></button>)}
        </div>
      )}
    </div>
  );
}

export function BookingModal({ prefill = {}, onClose }) {
  const { boot, tz, now, run, toast } = useApp();
  const re = prefill.reschedule;
  const providers = boot.staff.filter((s) => !s.is_agent && s.active);
  const [contact, setContact] = useState(re?.contact || prefill.contact || null);
  const [newC, setNewC] = useState(null);
  const [serviceId, setServiceId] = useState(re?.service?.id || boot.services[0].id);
  const svc = boot.services.find((s) => s.id === +serviceId);
  const eligible = providers.filter((p) => !svc?.staff?.length || svc.staff.includes(p.id));
  const [staffId, setStaffId] = useState(re?.staff?.id || prefill.staff_id || eligible[0]?.id);
  const startTs = re?.start || prefill.start;
  const [date, setDate] = useState(prefill.date || dayKey(startTs || now(), tz));
  const [minute, setMinute] = useState(startTs ? minutesOfDay(startTs, tz) : null);
  const [source, setSource] = useState('phone');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(true);
  const day = useApi(`/schedule?date=${date}`);

  useEffect(() => { if (!eligible.some((p) => p.id === +staffId)) setStaffId(eligible[0]?.id); }, [serviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const slots = useMemo(() => {
    const hrs = boot.workspace.hours[DAYS[weekdayOfKey(date)]];
    if (!hrs || !svc) return [];
    const step = boot.workspace.slot_minutes || 15;
    const { y, m, d } = parseDayKey(date);
    const busy = (day.data?.bookings || []).filter((b) => b.staff_id === +staffId && !['cancelled', 'no_show'].includes(b.status) && b.id !== re?.id);
    const lunch = boot.workspace.lunch;
    const out = [];
    for (let t = hrs[0]; t + svc.minutes <= hrs[1]; t += step) {
      const s = zonedToUtc(y, m, d, Math.floor(t / 60), t % 60, tz);
      const e = s + svc.minutes * 60000;
      const clash = busy.some((b) => b.start < e && b.end > s);
      const inLunch = lunch && t < lunch[1] && t + svc.minutes > lunch[0];
      out.push({ t, s, free: !clash && !inLunch && s > now() - 5 * 60000 });
    }
    return out;
  }, [date, staffId, svc, day.data, boot.workspace, tz, now, re]);

  const chosen = slots.find((s) => s.t === minute);
  const save = async () => {
    if (!chosen) { toast('Pick a time', 'error'); return false; }
    if (re) {
      const r = await run(() => patch(`/bookings/${re.id}`, { start: chosen.s, staff_id: +staffId, service_id: +serviceId }), `Moved to ${fmtRelDay(chosen.s, tz, now())} ${fmtTime(chosen.s, tz)}`);
      if (r) setTimeout(onClose, 650);
      return r || false;
    }
    const body = { staff_id: +staffId, service_id: +serviceId, start: chosen.s, source, note, send_confirmation: confirm };
    if (contact) body.contact_id = contact.id; else if (newC?.name && newC?.phone) body.contact = { ...newC, opt_in: 'pending', source };
    else { toast('Choose or add a contact', 'error'); return false; }
    const r = await run(() => post('/bookings', body), `Booked ${fmtRelDay(chosen.s, tz, now())} at ${fmtTime(chosen.s, tz)}`);
    if (r) setTimeout(onClose, 650);
    return r || false;
  };

  return (
    <Modal wide title={re ? `Reschedule ${re.contact.name}` : 'New booking'} icon={<LuCalendarDays />} onClose={onClose} footer={<>
      {!re && (contact?.opt_in === 'opted_in') && <span className="row muted" style={{ marginRight: 'auto', fontSize: 12.5 }}><Toggle wa on={confirm} onChange={setConfirm} label="Send confirmation" /> Send WhatsApp confirmation</span>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <AsyncBtn variant="primary" icon={LuCheck} doneLabel={re ? 'Moved' : 'Booked'} minMs={600} onClick={save} disabled={!chosen}>{re ? 'Move booking' : 'Book'}{chosen ? ` · ${fmtTime(chosen.s, tz)}` : ''}</AsyncBtn>
    </>}>
      {!re && (
        <div className="field">
          <label>Customer</label>
          {newC ? (
            <div className="grid2">
              <input autoFocus className="input" placeholder="Full name" value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} />
              <div className="row"><input className="input" placeholder="+91 98xxx xxxxx" value={newC.phone} onChange={(e) => setNewC({ ...newC, phone: e.target.value })} /><button className="btn ghost sm" onClick={() => setNewC(null)}><LuX /></button></div>
            </div>
          ) : (
            <>
              <ContactPicker value={contact} onChange={setContact} />
              {!contact && <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setNewC({ name: '', phone: '' })}><LuUserPlus />New customer</button>}
            </>
          )}
        </div>
      )}
      <div className="grid2">
        <div className="field"><label>Service</label>
          <select className="select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {boot.services.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.minutes} min{s.price ? ` · ₹${s.price.toLocaleString('en-IN')}` : ''}</option>)}
          </select>
        </div>
        <div className="field"><label>With</label>
          <select className="select" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {eligible.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.role}</option>)}
          </select>
        </div>
      </div>
      <div className="grid2">
        <div className="field"><label>Date</label><input type="date" className="input" value={date} min={dayKey(now(), tz)} onChange={(e) => { setDate(e.target.value); setMinute(null); }} /></div>
        {!re && <div className="field"><label>Booked via</label>
          <select className="select" value={source} onChange={(e) => setSource(e.target.value)}><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option><option value="walk_in">Walk-in</option><option value="website">Website</option></select>
        </div>}
      </div>
      <div className="field">
        <label>Time {svc && <span className="faint">· {fmtDate(zonedToUtc(...Object.values(parseDayKey(date)), 12, 0, tz), tz, { weekday: 'long', month: 'short', day: 'numeric' })}</span>}</label>
        {!slots.length && <div className="muted">Closed on this day.</div>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {slots.map((s) => (
            <button key={s.t} type="button" disabled={!s.free} className={`btn sm ${minute === s.t ? 'primary' : ''}`} style={{ opacity: s.free ? 1 : 0.35, minWidth: 74 }} onClick={() => setMinute(s.t)}>{fmtTime(s.s, tz)}</button>
          ))}
        </div>
      </div>
      {!re && <div className="field"><label>Note (optional)</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to the team only" /></div>}
    </Modal>
  );
}

export function ContactModal({ onClose }) {
  const { boot, run, openModal } = useApp();
  const [f, setF] = useState({ name: '', phone: '', email: '', tags: ['New'], opt_in: 'pending', owner_id: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const r = await run(() => post('/contacts', { ...f, owner_id: f.owner_id ? +f.owner_id : null }), `${f.name} added`);
    if (r) { onClose(); openModal({ type: 'contact-drawer', id: r.id }); }
  };
  return (
    <Modal title="New contact" icon={<LuUserPlus />} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!f.name || !f.phone} onClick={save}>Add contact</button>
    </>}>
      <div className="grid2"><div className="field"><label>Name</label><input autoFocus className="input" value={f.name} onChange={set('name')} /></div><div className="field"><label>WhatsApp number</label><input className="input" value={f.phone} onChange={set('phone')} placeholder="+91 98xxx xxxxx" /><span className="hint">Include the country code.</span></div></div>
      <div className="grid2"><div className="field"><label>Email</label><input className="input" value={f.email} onChange={set('email')} /></div>
        <div className="field"><label>Usually with</label><select className="select" value={f.owner_id} onChange={set('owner_id')}><option value="">—</option>{boot.staff.filter((s) => !s.is_agent).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div></div>
      <div className="field"><label>WhatsApp consent</label>
        <select className="select" value={f.opt_in} onChange={set('opt_in')}>
          <option value="pending">Pending — ask them to message us first</option>
          <option value="opted_in">Opted in — they agreed to WhatsApp messages</option>
          <option value="opted_out">Opted out</option>
        </select>
        <span className="hint">Meta requires consent before you send templates or broadcasts.</span>
      </div>
      <div className="field"><label>Tags</label><div className="row" style={{ flexWrap: 'wrap' }}>{['New', 'Regular', 'VIP', 'Membership', 'Bridal', 'Needs follow-up'].map((t) => {
        const on = f.tags.includes(t);
        return <button key={t} type="button" className={`seg-chip ${on ? 'on' : ''}`} onClick={() => setF({ ...f, tags: on ? f.tags.filter((x) => x !== t) : [...f.tags, t] })}><i className={`dot c-${tagTone(t)}`} />{t}</button>;
      })}</div></div>
    </Modal>
  );
}

export function SimulateModal({ prefill = {}, onClose }) {
  const { run, navigate } = useApp();
  const [contact, setContact] = useState(prefill.contact || null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('Hi! Do you have any slots this Saturday afternoon?');
  const send = async () => {
    const r = await run(() => post('/demo/inbound', contact ? { contact_id: contact.id, body } : { phone, name, body }), 'Message received');
    if (r) { onClose(); navigate(`inbox/${r.conversation.id}`); }
  };
  return (
    <Modal title="Simulate a customer message" icon={<FaWhatsapp className="c-wa" />} onClose={onClose} footer={<>
      <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Runs the same steps as the WhatsApp webhook.</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn wa" disabled={!body || (!contact && !phone)} onClick={send}><LuMessageCircle />Receive</button>
    </>}>
      <div className="field"><label>From an existing contact</label><ContactPicker value={contact} onChange={setContact} /></div>
      {!contact && <div className="grid2"><div className="field"><label>…or a new number</label><input className="input" placeholder="+91 98xxx xxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} /></div><div className="field"><label>Profile name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div></div>}
      <div className="field"><label>Message</label><textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} /><span className="hint">Try “where can I park?”, “do you take UPI?”, “Confirm”, or “I want to talk to a person”.</span></div>
    </Modal>
  );
}

const STATUS = { booked: ['slate', 'Booked'], confirmed: ['wa', 'Confirmed'], arrived: ['amber', 'Waiting'], in_service: ['blue', 'In service'], done: ['teal', 'Done'], no_show: ['red', 'No-show'], cancelled: ['slate', 'Cancelled'] };
const REM = { none: 'No reminder yet', sent: 'Reminder sent', delivered: 'Reminder delivered', read: 'Reminder read', confirmed: 'Confirmed on WhatsApp', reschedule: 'Asked to reschedule', failed: "Reminder couldn't be delivered" };

export function BookingDetail({ id, onClose }) {
  const { tz, now, run, openModal, navigate } = useApp();
  const [b, setB] = useState(null);
  const load = async () => setB(await get(`/bookings/${id}`).catch(() => null));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return null;
  const act = async (action, msg) => { const r = await run(() => post(`/bookings/${b.id}/action`, { action }), msg); if (r) setB(r); };
  const [tone, label] = STATUS[b.status];
  const openChat = async () => { const r = await run(() => post('/conversations', { contact_id: b.contact.id })); if (r) { onClose(); navigate(`inbox/${r.id}`); } };
  return (
    <Modal title={`${b.service.name} · ${b.contact.name}`} icon={<i className={`dot c-${b.service.color}`} style={{ width: 10, height: 10 }} />} onClose={onClose} footer={<>
      {['booked', 'confirmed'].includes(b.status) && <button className="btn danger-ghost" style={{ marginRight: 'auto' }} onClick={() => act('cancel', 'Booking cancelled')}><LuX />Cancel booking</button>}
      <button className="btn" onClick={openChat}><FaWhatsapp className="c-wa" />Open chat</button>
      {['booked', 'confirmed'].includes(b.status) && <button className="btn" onClick={() => { onClose(); openModal({ type: 'booking', prefill: { reschedule: b } }); }}><LuCalendarClock />Reschedule</button>}
      {['booked', 'confirmed'].includes(b.status) && <button className="btn dark" onClick={() => act('check_in', 'Checked in')}><LuDoorOpen />Check in</button>}
      {b.status === 'arrived' && <button className="btn dark" onClick={() => act('start', 'Started')}><LuPhoneCall />Call in</button>}
      {b.status === 'in_service' && <button className="btn dark" onClick={() => act('finish', 'Done')}><LuCheck />Finish</button>}
      {['done', 'no_show', 'cancelled', 'arrived', 'in_service'].includes(b.status) && <button className="btn" onClick={() => act('undo')}><LuUndo2 />Undo</button>}
    </>}>
      <div className="row"><Avatar name={b.contact.name} size="lg" /><div className="grow"><b style={{ fontSize: 15, cursor: 'pointer' }} onClick={() => { onClose(); openModal({ type: 'contact-drawer', id: b.contact.id }); }}>{b.contact.name}</b><div className="muted">{b.contact.phone}</div></div><Chip tone={tone} dot className="lg">{label}</Chip></div>
      <div className="grid2">
        <div className="appt-card"><div className="muted" style={{ fontSize: 11.5 }}>When</div><b>{fmtRelDay(b.start, tz, now())} · {fmtTime(b.start, tz)} – {fmtTime(b.end, tz)}</b></div>
        <div className="appt-card"><div className="muted" style={{ fontSize: 11.5 }}>With</div><b className="row" style={{ gap: 6 }}><Avatar name={b.staff.name} size="xs" tone={b.staff.color} />{b.staff.name}</b>{b.staff.resource && <span className="muted" style={{ fontSize: 12 }}>{b.staff.resource}</span>}</div>
      </div>
      <div className="kv"><LuBell />{REM[b.reminder]}{b.reminder_at && b.reminder !== 'none' ? ` · ${fmtRelDay(b.reminder_at, tz, now())} ${fmtTime(b.reminder_at, tz)}` : ''}
        {b.contact.opt_in === 'opted_in' && ['booked', 'confirmed'].includes(b.status) && b.reminder !== 'confirmed' && b.start > now() && <Btn size="sm" variant="wa-soft" icon={FaWhatsapp} style={{ marginLeft: 'auto' }} onClick={async () => { const r = await run(() => post(`/bookings/${b.id}/remind`), 'Reminder sent'); if (r) setB(r); }}>{b.reminder === 'none' ? 'Send reminder' : 'Remind again'}</Btn>}
      </div>
      {b.reminder === 'reschedule' && <div className="closed-banner"><LuTriangleAlert />{b.contact.name.split(' ')[0]} tapped Reschedule on the reminder — reach out with a new time.</div>}
      <div className="kv"><LuPencil />Booked via {b.source.replace('_', '-')} · {fmtDate(b.created_at, tz)}</div>
      {b.note && <div className="kv"><LuStickyNote />{b.note}</div>}
    </Modal>
  );
}

export function ContactDrawer({ id, onClose }) {
  const { boot, tz, now, run, openModal, navigate } = useApp();
  const { data: c, setData } = useApi(`/contacts/${id}`);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(null);
  useEffect(() => { if (c && !f) setF({ name: c.name, phone: c.phone, email: c.email || '' }); }, [c]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <Drawer onClose={onClose}><div className="drawer-body"><div className="skeleton" style={{ height: 80 }} /></div></Drawer>;
  const save = async (body, msg) => { const r = await run(() => patch(`/contacts/${c.id}`, body), msg); if (r) setData(r); };
  const openChat = async () => { const r = await run(() => post('/conversations', { contact_id: c.id })); if (r) { onClose(); navigate(`inbox/${r.id}`); } };
  const allTags = ['New', 'Regular', 'VIP', 'Membership', 'Lapsed', 'Bridal', 'Needs follow-up'];
  return (
    <Drawer onClose={onClose}>
      <div className="modal-head">
        <Avatar name={c.name} size="lg" />
        <div className="grow"><h2>{c.name}</h2><div className="muted">{c.phone}{c.email ? ` · ${c.email}` : ''}</div></div>
        <button className="btn ghost sm" onClick={onClose} aria-label="Close"><LuX /></button>
      </div>
      <div className="drawer-body">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Btn size="sm" variant="wa" icon={FaWhatsapp} disabled={c.opt_in === 'opted_out'} onClick={openChat}>Message</Btn>
          <Btn size="sm" icon={LuCalendarDays} onClick={() => { onClose(); openModal({ type: 'booking', prefill: { contact: c } }); }}>Book</Btn>
          <Btn size="sm" variant="ghost" icon={LuPencil} onClick={() => setEdit((e) => !e)}>Edit</Btn>
          <span style={{ marginLeft: 'auto' }}><OptChip v={c.opt_in} /></span>
        </div>
        {edit && f && (
          <div className="col" style={{ gap: 10 }}>
            <div className="grid2"><div className="field"><label>Name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div><div className="field"><label>Phone</label><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div></div>
            <div className="field"><label>Email</label><input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div className="field"><label>WhatsApp consent</label><select className="select" value={c.opt_in} onChange={(e) => save({ opt_in: e.target.value }, 'Consent updated')}><option value="opted_in">Opted in</option><option value="pending">Pending</option><option value="opted_out">Opted out</option></select></div>
            <div className="row"><Btn size="sm" variant="primary" onClick={async () => { await save(f, 'Saved'); setEdit(false); }}>Save</Btn></div>
          </div>
        )}
        <div className="stats three" style={{ margin: 0 }}>
          <div className="tile"><div className="l">Visits</div><div className="v num">{c.visits}</div></div>
          <div className="tile"><div className="l">No-shows</div><div className="v num">{c.no_shows}</div></div>
          <div className="tile"><div className="l">Customer since</div><div className="v">{fmtDate(c.created_at, tz, { month: 'short', year: 'numeric' })}</div></div>
        </div>
        <div className="sp-section"><h4>Tags</h4><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{allTags.map((t) => {
          const on = c.tags.includes(t);
          return <button key={t} type="button" className={`seg-chip ${on ? 'on' : ''}`} onClick={() => save({ tags: on ? c.tags.filter((x) => x !== t) : [...c.tags, t] })}><i className={`dot c-${tagTone(t)}`} />{t}</button>;
        })}</div></div>
        <div className="sp-section"><h4>Usually with</h4>
          <select className="select" value={c.owner_id || ''} onChange={(e) => save({ owner_id: e.target.value ? +e.target.value : null }, 'Saved')}>
            <option value="">—</option>{boot.staff.filter((s) => !s.is_agent).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="sp-section"><h4>Alerts <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>· internal only</span></h4>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {c.alerts.map((a) => <Chip key={a} tone="red" className="square lg"><LuTriangleAlert />{a}<button className="btn ghost sm" style={{ padding: 0 }} onClick={() => save({ alerts: c.alerts.filter((x) => x !== a) })}><LuX /></button></Chip>)}
            <input className="input" style={{ width: 200 }} placeholder="Add alert + Enter" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) { save({ alerts: [...c.alerts, e.target.value.trim()] }); e.target.value = ''; } }} />
          </div>
        </div>
        <div className="sp-section"><h4>Internal note</h4><textarea className="note-area" defaultValue={c.notes} onBlur={(e) => e.target.value !== c.notes && save({ notes: e.target.value }, 'Note saved')} /></div>
        <div className="sp-section"><h4>Bookings</h4>
          <div className="col" style={{ gap: 6 }}>
            {c.bookings.map((b) => (
              <button key={b.id} className="mini-row" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => { onClose(); openModal({ type: 'booking-detail', id: b.id }); }}>
                <i className={`dot c-${b.service.color}`} />
                <div className="grow"><b style={{ fontSize: 12.5 }}>{b.service.name}</b><div className="muted" style={{ fontSize: 11.5 }}>{fmtRelDay(b.start, tz, now())} {fmtTime(b.start, tz)} · {b.staff.name.split(' ')[0]}</div></div>
                <Chip tone={STATUS[b.status][0]} className="square">{STATUS[b.status][1]}</Chip>
              </button>
            ))}
            {!c.bookings.length && <span className="muted">No bookings yet.</span>}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
