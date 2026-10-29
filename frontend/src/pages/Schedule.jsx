import { useEffect, useMemo, useRef, useState } from 'react';
import { AsyncBtn, Num } from '../ui.jsx';
import {
  LuCalendarDays, LuChartColumn, LuClock, LuCircleCheck, LuChevronLeft, LuChevronRight, LuCheck, LuBell, LuCheckCheck,
  LuTriangleAlert, LuCalendarClock,
} from 'react-icons/lu';
import { FaWhatsapp } from 'react-icons/fa';
import { useApi, post } from '../api.js';
import { useApp, Avatar, Chip, Btn, Stat, Seg, Toggle, Bar, pct } from '../ui.jsx';
import { fmtTime, fmtLongDay, addDaysKey, parseDayKey, zonedToUtc, minutesOfDay, weekdayOfKey, fmtDate } from '../lib/time.js';

const PX = 1.35; // pixels per minute
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const STATUS_LABEL = { booked: 'Booked', confirmed: 'Confirmed', arrived: 'Waiting', in_service: 'In service', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' };

export default function Schedule() {
  const { boot, tz, now, run, openModal } = useApp();
  const [date, setDate] = useState(null);
  const [view, setView] = useState('day');
  const [cancelled, setCancelled] = useState(false);
  const [hidden, setHidden] = useState(new Set());
  const [dir, setDir] = useState('next');
  const { data } = useApi(`/schedule?view=${view}${date ? `&date=${date}` : ''}${cancelled ? '&cancelled=1' : ''}`);
  const providers = boot.staff.filter((s) => !s.is_agent && s.active);
  const shown = providers.filter((s) => !hidden.has(s.id));
  const day = date || data?.today;
  const isToday = day && data && day === data.today;

  const shift = (n) => { setDir(n > 0 ? 'next' : 'prev'); setDate(addDaysKey(day, view === 'week' ? 7 * n : n)); };
  const s = data?.stats;
  const dayTs = day ? (() => { const p = parseDayKey(day); return zonedToUtc(p.y, p.m, p.d, 12, 0, tz); })() : now();

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="page-head">
        <div><div className="eyebrow">{boot.workspace.name}</div><h1>Schedule</h1></div>
        <div className="head-actions">
          <AsyncBtn variant="wa" icon={FaWhatsapp} doneLabel="Reminders sent" minMs={900} disabled={!data?.tomorrow_unreminded} onClick={() => run(() => post('/reminders/tomorrow'), (r) => `Sent ${r.sent} reminders`)}>
            Send reminders for tomorrow <span className="pill-count"><Num value={data?.tomorrow_unreminded ?? 0} /></span>
          </AsyncBtn>
          <Btn variant="primary" icon={LuCalendarDays} onClick={() => openModal({ type: 'booking', prefill: { date: day } })}>New booking</Btn>
        </div>
      </div>
      <div className="stats">
        <Stat icon={LuCalendarDays} label="Appointments today" value={s?.appointments_today ?? '–'} />
        <Stat icon={LuChartColumn} label="Booked capacity" value={s ? pct(s.booked_capacity) : '–'} />
        <Stat icon={LuClock} label="Open slots left today" value={s?.open_slots ?? '–'} />
        <Stat icon={LuCircleCheck} label="Confirmed for tomorrow" value={s && s.tomorrow_total ? pct(s.confirmed_tomorrow / s.tomorrow_total) : '–'}>
          {s && <Chip tone="amber" className="square">{s.confirmed_tomorrow} of {s.tomorrow_total}</Chip>}
        </Stat>
      </div>
      <div className="staff-chips">
        {providers.map((p) => (
          <button key={p.id} className={`staff-chip ${hidden.has(p.id) ? 'off' : ''}`} onClick={() => setHidden((h) => { const n = new Set(h); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}>
            <i className={`dot c-${p.color}`} />{p.name}
          </button>
        ))}
        <span className="row muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}><Toggle on={cancelled} onChange={setCancelled} label="Show cancelled" />Show cancelled</span>
      </div>
      <section className="card sched" style={{ minHeight: 560 }}>
        <div className="sched-head">
          <div>
            <div className="row"><h2>{view === 'week' && data ? `Week of ${fmtDate(dayTsOf(data.days[0], tz), tz, { month: 'long', day: 'numeric' })}` : fmtLongDay(dayTs, tz)}</h2>{isToday && view === 'day' && <Chip tone="wa" className="square">Today</Chip>}</div>
            <div className="muted" style={{ fontSize: 12 }}>{data ? `${data.bookings.filter((b) => b.status !== 'cancelled').length} bookings · ${shown.length} of ${providers.length} team members` : ' '}</div>
          </div>
          <div className="row" style={{ marginLeft: 'auto' }}>
            <Btn size="sm" variant="ghost" icon={LuChevronLeft} onClick={() => shift(-1)} aria-label="Previous" />
            <Btn size="sm" onClick={() => setDate(null)}>Today</Btn>
            <Btn size="sm" variant="ghost" icon={LuChevronRight} onClick={() => shift(1)} aria-label="Next" />
            <Seg value={view} onChange={setView} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />
          </div>
        </div>
        {data && view === 'day' && <div key={`d${day}`} className={`slide-${dir}`} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}><DayGrid data={data} day={day} providers={shown} isToday={isToday} /></div>}
        {data && view === 'week' && <div key={`w${data.days[0]}`} className={`slide-${dir}`}><WeekGrid data={data} providers={shown} /></div>}
        {!data && <div style={{ padding: 16 }}><div className="skeleton" style={{ height: 400 }} /></div>}
      </section>
    </div>
  );
}

function dayTsOf(key, tz) { const p = parseDayKey(key); return zonedToUtc(p.y, p.m, p.d, 12, 0, tz); }

function DayGrid({ data, day, providers, isToday }) {
  const { boot, tz, now, openModal } = useApp();
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const hrs = boot.workspace.hours[DAYS[weekdayOfKey(day)]];
  const allHours = Object.values(boot.workspace.hours).filter(Boolean);
  const startMin = Math.min(...allHours.map((h) => h[0])) - 30;
  const endMin = Math.max(...allHours.map((h) => h[1])) + 30;
  const height = (endMin - startMin) * PX;
  const p = parseDayKey(day);
  const dayStart = zonedToUtc(p.y, p.m, p.d, 0, 0, tz);
  const nowMin = isToday ? minutesOfDay(now(), tz) : null;
  const slot = boot.workspace.slot_minutes || 15;
  const lunch = boot.workspace.lunch;
  const showNow = nowMin != null && nowMin > startMin && nowMin < endMin;

  useEffect(() => {
    if (ref.current && nowMin) ref.current.scrollTop = Math.max(0, (nowMin - startMin) * PX - 180);
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  const hourMarks = [];
  for (let m = Math.ceil(startMin / 60) * 60; m <= endMin; m += 30) hourMarks.push(m);
  const cols = `64px repeat(${providers.length}, minmax(150px, 1fr))`;
  const top = (ts) => (minutesOfDay(ts, tz) - startMin) * PX;

  const slotAt = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const m = Math.floor(((e.clientY - rect.top) / PX + startMin) / slot) * slot;
    return m;
  };

  return (
    <div className="sched-grid" ref={ref}>
      <div className="sched-cols" style={{ gridTemplateColumns: cols }}>
        <div className="sched-colhead" style={{ borderLeft: 0 }} />
        {providers.map((s) => (
          <div key={s.id} className="sched-colhead" style={{ borderLeft: '1px solid var(--border)' }}>
            <div className="row"><Avatar name={s.name} size="sm" tone={s.color} /><div className="grow" style={{ minWidth: 0 }}><b className="ellipsis">{s.name}</b><span>{s.role}{s.resource ? ` · ${s.resource}` : ''}</span></div></div>
            <div className="util"><Bar thin value={data.utilization[s.id]} color={`var(--${s.color})`} /><span className="num">{pct(data.utilization[s.id])} booked</span></div>
          </div>
        ))}
        <div className="sched-body" style={{ height }}>
          {hourMarks.map((m) => m % 60 === 0 && (
            <span key={m} className="hour-label" style={{ top: (m - startMin) * PX }}>{fmtTime(dayStart + m * 60000, tz).replace(':00', '')}</span>
          ))}
          {showNow && <span className="now-pill" style={{ top: (nowMin - startMin) * PX }}>{fmtTime(now(), tz).replace(/ [AP]M/, '')}</span>}
        </div>
        {providers.map((s) => {
          const mine = data.bookings.filter((b) => b.staff_id === s.id);
          return (
            <div
              key={s.id}
              className="sched-col"
              style={{ height }}
              onMouseMove={(e) => { if (e.target === e.currentTarget) setHover({ staff: s.id, m: slotAt(e) }); else setHover(null); }}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const m = slotAt(e);
                openModal({ type: 'booking', prefill: { staff_id: s.id, start: dayStart + m * 60000 } });
              }}
            >
              {hourMarks.map((m) => <div key={m} className={`hour-line ${m % 60 ? 'half' : ''}`} style={{ top: (m - startMin) * PX }} />)}
              {hrs ? (
                <>
                  <div className="closed-band" style={{ top: 0, height: (hrs[0] - startMin) * PX }} />
                  <div className="closed-band" style={{ top: (hrs[1] - startMin) * PX, bottom: 0 }} />
                  {lunch && <div className="lunch" style={{ top: (lunch[0] - startMin) * PX, height: (lunch[1] - lunch[0]) * PX }}>LUNCH</div>}
                </>
              ) : <div className="closed-band" style={{ top: 0, bottom: 0, display: 'grid', placeItems: 'center', color: 'var(--faint)', fontWeight: 700 }}>Closed</div>}
              {showNow && <div className="now-line" style={{ top: (nowMin - startMin) * PX }} />}
              {hover?.staff === s.id && <div className="slot-hover" style={{ display: 'block', top: (hover.m - startMin) * PX, height: slot * 2 * PX }}>+ {fmtTime(dayStart + hover.m * 60000, tz)}</div>}
              {mine.map((b, bi) => {
                const h = Math.max(22, ((b.end - b.start) / 60000) * PX - 3);
                return (
                  <div key={b.id} className={`bk st-${b.status}`} style={{ top: top(b.start) + 1, height: h, animationDelay: `${Math.min(bi, 12) * 35 + providers.indexOf(s) * 40}ms` }} onClick={() => openModal({ type: 'booking-detail', id: b.id })} title={`${b.contact.name} · ${b.service.name}`}>
                    <i className={`stripe bg-${b.service.color}`} />
                    <b className="ellipsis">{b.contact.name}{b.status === 'confirmed' && <LuCheckCheck className="c-wa" />}{b.status === 'done' && <LuCheck />}{b.reminder === 'reschedule' && <LuTriangleAlert className="c-amber" />}</b>
                    {h > 30 && <span className="s ellipsis">{fmtTime(b.start, tz)} – {fmtTime(b.end, tz)} · {STATUS_LABEL[b.status]}</span>}
                    {h > 50 && <span className="s ellipsis">{b.service.name}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ data, providers }) {
  const { tz, openModal } = useApp();
  const ids = new Set(providers.map((p) => p.id));
  const byDay = useMemo(() => {
    const m = {};
    for (const k of data.days) m[k] = [];
    for (const b of data.bookings) {
      if (!ids.has(b.staff_id)) continue;
      const k = data.days.find((d) => fmtDate(b.start, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }) === fmtDate(dayTsOf(d, tz), tz, { year: 'numeric', month: '2-digit', day: '2-digit' }));
      if (k) m[k].push(b);
    }
    return m;
  }, [data, tz, providers]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="week-grid" style={{ overflow: 'auto' }}>
      {data.days.map((k) => (
        <div key={k} className={`week-day ${k === data.today ? 'today' : ''}`} style={{ animationDelay: `${data.days.indexOf(k) * 45}ms` }}>
          <div className="dh"><span>{fmtDate(dayTsOf(k, tz), tz, { weekday: 'short', day: 'numeric' })}</span><span className="muted num">{byDay[k].length}</span></div>
          {byDay[k].slice(0, 14).map((b) => (
            <div key={b.id} className="week-item" onClick={() => openModal({ type: 'booking-detail', id: b.id })}>
              <i className={`dot c-${b.staff.color}`} /><span className="num muted">{fmtTime(b.start, tz).replace(' AM', 'a').replace(' PM', 'p')}</span><span className="ellipsis">{b.contact.name}</span>
            </div>
          ))}
          {byDay[k].length > 14 && <span className="faint" style={{ fontSize: 11, textAlign: 'center' }}>+{byDay[k].length - 14} more</span>}
          {!byDay[k].length && <span className="faint" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 20 }}>No bookings</span>}
        </div>
      ))}
    </div>
  );
}

export { LuBell, LuCalendarClock };
