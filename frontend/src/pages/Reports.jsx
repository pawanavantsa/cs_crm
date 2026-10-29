import { useEffect, useRef, useState } from 'react';
import {
  LuCalendarCheck, LuUserX, LuClock, LuCircleCheck, LuDownload, LuSend, LuCheckCheck, LuEye, LuCheck, LuRefreshCw,
  LuPhone, LuGlobe, LuFootprints, LuInbox, LuBot,
} from 'react-icons/lu';
import { FaWhatsapp } from 'react-icons/fa';
import { useApi } from '../api.js';
import { useApp, Chip, Btn, Stat, Seg, Avatar, Bar, pct, num, Num } from '../ui.jsx';
import { fmtDate, parseDayKey, zonedToUtc } from '../lib/time.js';
import { downloadText } from '../App.jsx';

const CAT = ['var(--cat1)', 'var(--cat2)', 'var(--cat3)', 'var(--cat4)', 'var(--cat5)', 'var(--cat6)'];

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const keyTs = (k, tz) => { const p = parseDayKey(k); return zonedToUtc(p.y, p.m, p.d, 12, 0, tz); };

export default function Reports() {
  const { tz, boot } = useApp();
  const [weeks, setWeeks] = useState(12);
  const { data } = useApi(`/reports?weeks=${weeks}`, { poll: 30000 });
  const exportCsv = () => {
    if (!data) return;
    const rows = [['Week', 'Visits done', 'Booked', 'No-show rate']];
    data.visits_weekly.forEach((w, i) => rows.push([w.week, w.done, w.booked, (data.no_show.weekly[i].rate * 100).toFixed(1)]));
    rows.push([]);
    rows.push(['Team member', 'Visits', 'Booked capacity', 'No-show rate', 'Avg start delay (min)']);
    data.staff.forEach((s) => rows.push([s.staff.name, s.visits, (s.capacity * 100).toFixed(0), (s.no_show_rate * 100).toFixed(1), s.avg_start_delay]));
    downloadText(`report-${data.from}-to-${data.to}.csv`, rows.map((r) => r.join(',')).join('\n'));
  };
  const d = data;
  return (
    <div className="content">
      <div className="page-head">
        <div><div className="eyebrow">{d ? `${fmtDate(keyTs(d.from, tz), tz)} – ${fmtDate(keyTs(d.to, tz), tz)} · last ${weeks} weeks` : ' '}</div><h1>Reports</h1></div>
        <div className="head-actions">
          <Seg value={weeks} onChange={setWeeks} options={[{ value: 4, label: '4 weeks' }, { value: 12, label: '12 weeks' }]} />
          <Btn icon={LuDownload} onClick={exportCsv}>Export CSV</Btn>
        </div>
      </div>
      <div className="stats">
        <Stat icon={LuCalendarCheck} label="Visits completed" value={d ? num(d.stats.visits) : '–'} />
        <Stat icon={LuUserX} label="No-show rate" value={d ? pct(d.stats.no_show_rate, 1) : '–'}>
          {d && <Chip tone={d.stats.no_show_delta < 0 ? 'wa' : 'red'} className="square">{d.stats.no_show_delta < 0 ? '▼' : '▲'} {Math.abs(d.stats.no_show_delta * 100).toFixed(1)} pts</Chip>}
        </Stat>
        <Stat icon={FaWhatsapp} label="Median WhatsApp reply" value={d ? d.stats.median_reply_min : '–'} unit="min" />
        <Stat icon={LuCircleCheck} label="Reminders confirmed" value={d ? pct(d.stats.reminders_confirmed) : '–'} />
      </div>
      {!d ? <div className="skeleton" style={{ height: 400 }} /> : (
        <>
          <div className="rep-grid">
            <section className="card">
              <div className="card-head"><h2>No-show rate</h2><Chip tone="wa" className="square"><FaWhatsapp />Reminders</Chip></div>
              <div className="chart-wrap">
                <div className="row" style={{ gap: 18, margin: '6px 0 8px', flexWrap: 'wrap' }}>
                  <div><div className="muted" style={{ fontSize: 11.5 }}>Before reminders</div><b style={{ fontSize: 22 }} className="num"><Num value={pct(d.no_show.before, 1)} /></b></div>
                  <span className="faint">→</span>
                  <div><div className="muted" style={{ fontSize: 11.5 }}>Since reminders</div><b style={{ fontSize: 22 }} className="num"><Num value={pct(d.no_show.after, 1)} /></b></div>
                  {d.no_show.before > 0 && <Chip tone="wa" className="square">{Math.round((1 - d.no_show.after / d.no_show.before) * 100)}% fewer</Chip>}
                  <div className="legend" style={{ marginLeft: 'auto' }}><span><i style={{ background: 'var(--red)' }} />Weekly no-show rate</span><span><i style={{ background: 'var(--faint)' }} />Before-reminders average</span></div>
                </div>
                <NoShowChart data={d.no_show} tz={tz} />
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>WhatsApp reminders started {fmtDate(d.no_show.reminders_started, tz, { month: 'short', day: 'numeric' })}: sent {boot.workspace.reminders.hours_before} h before each visit with Confirm and Reschedule buttons.</div>
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h2>Reminder funnel</h2></div>
              <div className="card-head" style={{ paddingTop: 2 }}><span className="sub">WhatsApp reminders sent, last {weeks} weeks</span></div>
              <div className="chart-wrap funnel-big" style={{ paddingTop: 14 }}>
                {[['Sent', d.funnel.sent, LuSend, 'teal'], ['Delivered', d.funnel.delivered, LuCheckCheck, 'blue'], ['Read', d.funnel.read, LuEye, 'violet'], ['Confirmed', d.funnel.confirmed, LuCheck, 'wa']].map(([l, v, Ic, tone]) => (
                  <div key={l} className="item">
                    <span className={`ic tone-${tone}`}><Ic /></span>
                    <div>
                      <div className="line">{l}<b className="num"><Num value={num(v)} /><span>{pct(d.funnel.sent ? v / d.funnel.sent : 0)}</span></b></div>
                      <Bar value={d.funnel.sent ? v / d.funnel.sent : 0} color={`var(--${tone})`} />
                    </div>
                  </div>
                ))}
                <div className="callout muted"><LuRefreshCw className="c-amber" />{d.funnel.reschedule} asked to reschedule · {d.funnel.failed} couldn't be delivered</div>
              </div>
            </section>
          </div>

          <div className="rep-grid">
            <section className="card">
              <div className="card-head"><h2>Visits per week</h2></div>
              <div className="chart-wrap">
                <div className="big-num" style={{ marginTop: 8 }}><b className="num"><Num value={num(d.stats.visits)} /></b><span>completed of {num(d.visits_booked_total)} booked</span></div>
                <div className="legend" style={{ margin: '6px 0 4px' }}><span><i style={{ background: 'var(--cat1)' }} />Completed</span><span><i style={{ background: 'var(--seq-2)' }} />Booked</span></div>
                <VisitsChart data={d.visits_weekly} tz={tz} />
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h2>Service mix</h2></div>
              <div className="card-head" style={{ paddingTop: 2 }}><span className="sub">Completed visits by service</span></div>
              <div className="chart-wrap"><ServiceMix mix={d.service_mix} /></div>
            </section>
          </div>

          <div className="rep-grid">
            <section className="card">
              <div className="card-head"><h2>Busiest hours</h2></div>
              <div className="card-head" style={{ paddingTop: 2 }}><span className="sub">Bookings by weekday and hour</span></div>
              <div className="chart-wrap"><Heatmap h={d.heatmap} /></div>
            </section>
            <section className="card">
              <div className="card-head"><h2>How customers book</h2></div>
              <div className="chart-wrap">
                <Sources sources={d.sources} />
              </div>
            </section>
          </div>

          <div className="rep-grid">
            <section className="card">
              <div className="card-head"><h2>Team</h2></div>
              <div className="table-wrap" style={{ padding: '6px 6px 8px' }}>
                <table className="t">
                  <thead><tr><th>Team member</th><th>Visits</th><th style={{ width: '30%' }}>Booked capacity</th><th>No-show</th><th>Avg start delay</th></tr></thead>
                  <tbody>
                    {d.staff.map((s) => (
                      <tr key={s.staff.id} style={{ cursor: 'default' }}>
                        <td><div className="person"><Avatar name={s.staff.name} size="sm" tone={s.staff.color} /><div><b>{s.staff.name}</b><span>{s.staff.role}</span></div></div></td>
                        <td className="num">{num(s.visits)}</td>
                        <td><div className="row"><div className="grow"><Bar value={s.capacity} color="var(--cat1)" /></div><span className="num" style={{ width: 34, textAlign: 'right' }}>{pct(s.capacity)}</span></div></td>
                        <td className="num">{pct(s.no_show_rate, 1)}</td>
                        <td className="num">{s.avg_start_delay} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h2>Inbox health</h2></div>
              <div className="chart-wrap">
                <div className="big-num" style={{ marginTop: 8 }}><b className="num"><Num value={`${d.inbox.median_reply_min} min`} /></b><span>median first reply on WhatsApp</span></div>
                <InboxBar inbox={d.inbox} />
                <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, margin: '14px 0 8px' }}>Conversations by label</div>
                <div className="col" style={{ gap: 7 }}>
                  {d.inbox.labels.map((l) => {
                    const max = Math.max(1, ...d.inbox.labels.map((x) => x.count));
                    return (
                      <div key={l.name} className="funnel-row" style={{ gridTemplateColumns: '96px 1fr 30px' }}>
                        <Chip tone={l.color} className="square" style={{ justifySelf: 'start' }}>{l.name}</Chip>
                        <Bar value={l.count / max} color="var(--cat2)" />
                        <span className="v num">{l.count}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="callout muted" style={{ marginTop: 12 }}><LuBot className="c-violet" />{d.inbox.ai_handled} replies written by Xeroura AI</div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function NoShowChart({ data, tz }) {
  const [ref, w] = useWidth();
  const [hov, setHov] = useState(null);
  const h = 190, pl = 34, pr = 8, pt = 10, pb = 24;
  const pts = data.weekly;
  const max = Math.max(0.2, ...pts.map((p) => p.rate)) * 1.1;
  const x = (i) => pl + (i * (w - pl - pr)) / Math.max(1, pts.length - 1);
  const y = (v) => pt + (1 - v / max) * (h - pt - pb);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.rate)}`).join(' ');
  const area = `${line} L${x(pts.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const startIdx = pts.findIndex((p) => keyTs(p.week, tz) + 6 * 864e5 >= data.reminders_started);
  const ticks = [0, max / 2, max].map((v) => Math.round(v * 20) / 20);
  return (
    <div ref={ref} className="chart-rel" onMouseLeave={() => setHov(null)}>
      <svg width={w} height={h} role="img" aria-label="Weekly no-show rate">
        <defs><linearGradient id="nsg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--red)" stopOpacity=".18" /><stop offset="1" stopColor="var(--red)" stopOpacity="0" /></linearGradient></defs>
        {ticks.map((t) => <g key={t}><line x1={pl} x2={w - pr} y1={y(t)} y2={y(t)} stroke="var(--border)" /><text x={pl - 6} y={y(t) + 4} fontSize="10.5" textAnchor="end" fill="var(--faint)">{Math.round(t * 100)}%</text></g>)}
        <line x1={pl} x2={w - pr} y1={y(data.before)} y2={y(data.before)} stroke="var(--faint)" strokeDasharray="4 4" />
        {startIdx > 0 && <g><line x1={x(startIdx)} x2={x(startIdx)} y1={pt} y2={h - pb} stroke="var(--wa)" strokeDasharray="3 3" strokeWidth="1.5" /><text x={x(startIdx) + 5} y={pt + 10} fontSize="10.5" fill="var(--wa-ink)" fontWeight="700">Reminders on</text></g>}
        <path d={area} fill="url(#nsg)" className="fade-area" />
        <path key={pts.length} d={line} fill="none" stroke="var(--red)" strokeWidth="2" strokeLinejoin="round" pathLength="1" className="draw-line" />
        {pts.map((p, i) => (i % Math.ceil(pts.length / 6) === 0 || i === pts.length - 1) && <text key={p.week} x={x(i)} y={h - 6} fontSize="10.5" textAnchor={i === pts.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'} fill="var(--faint)">{fmtDate(keyTs(p.week, tz), tz)}</text>)}
        {hov != null && <><line className="crosshair" x1={x(hov)} x2={x(hov)} y1={pt} y2={h - pb} stroke="var(--border-strong)" /><circle cx={x(hov)} cy={y(pts[hov].rate)} r="4.5" fill="var(--red)" stroke="var(--surface)" strokeWidth="2" /></>}
        {pts.map((p, i) => <rect key={i} x={x(i) - (w - pl) / pts.length / 2} y={pt} width={(w - pl) / pts.length} height={h - pt - pb} fill="transparent" onMouseEnter={() => setHov(i)} />)}
      </svg>
      {hov != null && <div className="tip" style={{ left: x(hov), top: y(pts[hov].rate) }}>Week of {fmtDate(keyTs(pts[hov].week, tz), tz)} · <b>{pct(pts[hov].rate, 1)}</b> no-shows</div>}
    </div>
  );
}

function VisitsChart({ data, tz }) {
  const [ref, w] = useWidth();
  const [hov, setHov] = useState(null);
  const h = 200, pl = 34, pr = 4, pt = 8, pb = 24;
  const max = Math.max(...data.map((d) => d.booked)) * 1.1 || 1;
  const step = (w - pl - pr) / data.length;
  const bw = Math.min(42, step * 0.62);
  const y = (v) => pt + (1 - v / max) * (h - pt - pb);
  const nice = Math.ceil(max / 2 / 50) * 50;
  return (
    <div ref={ref} className="chart-rel" onMouseLeave={() => setHov(null)}>
      <svg width={w} height={h} role="img" aria-label="Visits per week">
        <defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--seq-2)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--cat1)" strokeWidth="2.5" /></pattern></defs>
        {[0, nice, nice * 2].map((t) => t <= max && <g key={t}><line x1={pl} x2={w - pr} y1={y(t)} y2={y(t)} stroke="var(--border)" /><text x={pl - 6} y={y(t) + 4} fontSize="10.5" textAnchor="end" fill="var(--faint)">{t}</text></g>)}
        {data.map((d, i) => {
          const cx = pl + step * i + step / 2;
          return (
            <g key={d.week} onMouseEnter={() => setHov(i)}>
              <rect x={cx - step / 2} y={pt} width={step} height={h - pt - pb} fill="transparent" />
              <rect className="grow-bar" style={{ animationDelay: `${i * 45}ms` }} x={cx - bw / 2} y={y(d.booked)} width={bw} height={y(0) - y(d.booked)} rx="4" fill="var(--seq-2)" opacity={hov === null || hov === i ? 1 : 0.6} />
              <rect className="grow-bar" style={{ animationDelay: `${120 + i * 45}ms` }} x={cx - bw / 2} y={y(d.done) + 2} width={bw} height={Math.max(0, y(0) - y(d.done) - 2)} rx="4" fill={d.partial ? 'url(#hatch)' : 'var(--cat1)'} opacity={hov === null || hov === i ? 1 : 0.6} />
              {(i % Math.ceil(data.length / 7) === 0 || d.partial) && <text x={cx} y={h - 6} fontSize="10.5" textAnchor="middle" fill={d.partial ? 'var(--text)' : 'var(--faint)'} fontWeight={d.partial ? 800 : 500}>{d.partial ? 'This wk' : fmtDate(keyTs(d.week, tz), tz)}</text>}
            </g>
          );
        })}
      </svg>
      {hov != null && <div className="tip" style={{ left: pl + step * hov + step / 2, top: y(data[hov].booked) }}>{data[hov].partial ? 'This week' : `Week of ${fmtDate(keyTs(data[hov].week, tz), tz)}`} · <b>{data[hov].done}</b> done of {data[hov].booked}</div>}
    </div>
  );
}

function ServiceMix({ mix }) {
  const [hov, setHov] = useState(null);
  const top = mix.slice(0, 6);
  const rest = mix.slice(6).reduce((a, s) => a + s.count, 0);
  const rows = [...top.map((s, i) => ({ ...s, fill: CAT[i] })), ...(rest ? [{ id: 'other', name: 'Other services', count: rest, fill: 'var(--cat-other)' }] : [])];
  const total = rows.reduce((a, s) => a + s.count, 0) || 1;
  const R = 62, r = 44, C = 80;
  let acc = 0;
  const gap = 0.012;
  const arc = (a0, a1, rr) => [Math.cos(2 * Math.PI * a0 - Math.PI / 2) * rr + C, Math.sin(2 * Math.PI * a0 - Math.PI / 2) * rr + C, Math.cos(2 * Math.PI * a1 - Math.PI / 2) * rr + C, Math.sin(2 * Math.PI * a1 - Math.PI / 2) * rr + C];
  return (
    <div className="row" style={{ gap: 18, alignItems: 'center', paddingTop: 8 }}>
      <svg width="160" height="160" role="img" aria-label="Service mix donut" style={{ flex: 'none' }}>
        <defs><mask id="donutMask"><circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="#fff" strokeWidth={R - r + 4} pathLength="1" className="donut-sweep" transform={`rotate(-90 ${C} ${C})`} /></mask></defs>
        <g mask="url(#donutMask)">
        {rows.map((s, i) => {
          const a0 = acc + gap / 2;
          acc += s.count / total;
          const a1 = Math.max(a0 + 0.001, acc - gap / 2);
          const [x0, y0, x1, y1] = arc(a0, a1, R);
          const [x2, y2, x3, y3] = arc(a1, a0, r);
          const large = a1 - a0 > 0.5 ? 1 : 0;
          return <path key={s.id} d={`M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`} fill={s.fill} className={`donut-seg ${hov === i ? 'hot' : ''}`} opacity={hov === null || hov === i ? 1 : 0.35} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} />;
        })}
        </g>
        <text x={C} y={C - 2} textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--text)"><Num value={num(hov != null ? rows[hov].count : total)} /></text>
        <text x={C} y={C + 15} textAnchor="middle" fontSize="11" fill="var(--muted)">{hov != null ? pct(rows[hov].count / total) : 'visits'}</text>
      </svg>
      <div className="mix-list">
        {rows.map((s, i) => (
          <div key={s.id} className="mix-row" onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} style={{ opacity: hov === null || hov === i ? 1 : 0.5 }}>
            <i className="dot" style={{ background: s.fill, width: 9, height: 9 }} /><span className="ellipsis">{s.name}</span><span className="v num">{num(s.count)}</span><span className="p num">{pct(s.count / total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Heatmap({ h }) {
  const [hov, setHov] = useState(null);
  const steps = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];
  const color = (v) => steps[Math.min(4, Math.floor((v / (h.max || 1)) * 4.999))];
  const label = (hr) => (hr === 12 ? '12p' : hr > 12 ? `${hr - 12}p` : `${hr}a`);
  return (
    <div className="chart-rel" style={{ paddingTop: 8 }}>
      <div className="heat" style={{ gridTemplateColumns: `36px repeat(${h.hours.length}, 1fr)` }}>
        <span />
        {h.hours.map((hr) => <span key={hr} style={{ textAlign: 'center' }}>{label(hr)}</span>)}
        {h.days.map((d, di) => [
          <span key={d} style={{ alignSelf: 'center' }}>{d}</span>,
          ...h.hours.map((hr, hi) => {
            const v = h.cells[di][hi];
            const closed = h.closed[di][hi];
            const peak = h.busiest && h.busiest.day === d && h.busiest.hour === hr;
            return (
              <div
                key={`${d}${hr}`}
                className={`cell ${closed && !v ? 'closed' : ''} ${peak ? 'peak' : ''}`}
                style={{ ...(closed && !v ? {} : { background: color(v) }), animationDelay: `${(di + hi) * 28}ms` }}
                onMouseEnter={() => setHov({ d, hr, v })}
                onMouseLeave={() => setHov(null)}
                title={`${d} ${label(hr)} · ${v} bookings`}
              />
            );
          }),
        ])}
      </div>
      <div className="row muted" style={{ marginTop: 12, fontSize: 12 }}>
        <LuClock size={14} className="c-teal" />
        {hov ? <span><b style={{ color: 'var(--text)' }}>{hov.d} {label(hov.hr)}</b> · {hov.v} bookings</span> : h.busiest && <span>Busiest: <b style={{ color: 'var(--text)' }}>{h.busiest.day} {label(h.busiest.hour)}</b> · {h.busiest.count} bookings</span>}
        <span className="row" style={{ marginLeft: 'auto', gap: 4, fontSize: 11 }}>Fewer {steps.map((s) => <i key={s} style={{ width: 12, height: 10, borderRadius: 3, background: s, display: 'inline-block' }} />)} More</span>
      </div>
    </div>
  );
}

function Sources({ sources }) {
  const total = sources.reduce((a, s) => a + s.count, 0) || 1;
  const meta = { whatsapp: ['WhatsApp', FaWhatsapp], phone: ['Phone', LuPhone], website: ['Website', LuGlobe], walk_in: ['Walk-in', LuFootprints] };
  const sorted = [...sources].sort((a, b) => b.count - a.count);
  const wa = sources.find((s) => s.source === 'whatsapp');
  return (
    <>
      <div className="big-num" style={{ margin: '8px 0 12px' }}><b className="num"><Num value={pct(wa.count / total)} /></b><span>of {num(total)} bookings came from WhatsApp</span></div>
      <div className="col" style={{ gap: 8 }}>
        {sorted.map((s) => {
          const [label, Ic] = meta[s.source];
          return (
            <div key={s.source} className={`source-row ${s.source === 'whatsapp' ? 'top' : ''}`}>
              <span className="ic"><Ic size={15} /></span>
              <div>
                <div className="line">{label}<b className="num"><Num value={num(s.count)} /><span>{pct(s.count / total)}</span></b></div>
                <Bar value={s.count / sorted[0].count} color={s.source === 'whatsapp' ? 'var(--wa)' : 'var(--cat1)'} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function InboxBar({ inbox }) {
  const segs = [['Replied', Math.max(0, inbox.open - inbox.waiting), 'var(--cat1)'], ['Waiting on us', inbox.waiting, 'var(--cat3)'], ['Resolved', inbox.resolved, 'var(--cat2)']];
  const total = segs.reduce((a, s) => a + s[1], 0) || 1;
  return (
    <>
      <div style={{ display: 'flex', gap: 2, height: 10, borderRadius: 999, overflow: 'hidden', margin: '12px 0 8px' }}>
        {segs.map(([l, v, c]) => v > 0 && <i key={l} style={{ flex: v / total, background: c }} title={`${l}: ${v}`} />)}
      </div>
      <div className="legend">{segs.map(([l, v, c]) => <span key={l}><i style={{ background: c }} />{l} {v}</span>)}</div>
    </>
  );
}

export { LuInbox };
