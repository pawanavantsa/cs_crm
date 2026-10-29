import { useEffect, useRef, useState } from 'react';
import { useSlidingPill, themeTransition } from '../motion.js';
import {
  LuStore, LuBell, LuReply, LuUsers, LuShieldCheck, LuPalette, LuDatabase, LuCheck, LuMapPin, LuPhone, LuClock,
  LuSend, LuX, LuZap, LuBot, LuPlus, LuTrash2, LuDownload, LuRotateCcw, LuLink, LuSun, LuMoon, LuMonitor, LuScissors,
  LuCircleCheck, LuTriangleAlert, LuPlug, LuBadgeCheck,
} from 'react-icons/lu';
import { FaWhatsapp } from 'react-icons/fa';
import { useApi, get, post, patch, del, apiConfig, isDemo, login, switchToDemo } from '../api.js';
import { useApp, Stat, Toggle, Btn, Chip, Avatar, CopyField, Modal, pct, AsyncBtn } from '../ui.jsx';
import { TIMEZONES, fmtTime } from '../lib/time.js';
import { downloadText } from '../App.jsx';

const SECTIONS = [
  ['business', 'Business', LuStore],
  ['whatsapp', 'WhatsApp', FaWhatsapp],
  ['reminders', 'Reminders', LuBell],
  ['automation', 'Auto-replies & AI', LuReply],
  ['team', 'Team & services', LuUsers],
  ['privacy', 'Privacy', LuShieldCheck],
  ['appearance', 'Appearance', LuPalette],
  ['data', 'Data & API', LuDatabase],
];
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const COLORS = ['teal', 'blue', 'violet', 'amber', 'rose', 'cyan', 'indigo', 'orange', 'pink', 'slate'];

const minToStr = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const strToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export default function Settings({ route }) {
  const { boot, navigate } = useApp();
  const sec = SECTIONS.some((s) => s[0] === route.id) ? route.id : 'business';
  const contacts = useApi('/contacts?page_size=1');
  const ws = boot.workspace;
  const navRef = useRef(null);
  const subPill = useSlidingPill(navRef, 'button.on', [sec]);
  const weekly = Object.values(ws.hours).filter(Boolean).reduce((a, h) => a + (h[1] - h[0]), 0) / 60;
  return (
    <div className="content">
      <div className="page-head"><div><div className="eyebrow">{ws.name}</div><h1>Settings</h1></div></div>
      <div className="stats three">
        <Stat icon={LuUsers} label="Team members" value={boot.staff.filter((s) => s.active).length} />
        <Stat icon={FaWhatsapp} label="Contacts opted in" value={contacts.data ? pct(contacts.data.stats.opt_in_rate) : '–'} />
        <Stat icon={LuClock} label="Open hours a week" value={Math.round(weekly)} unit="h" />
      </div>
      <div className="settings">
        <nav className="card subnav" ref={navRef}>
          <span className="sub-pill" ref={subPill} />
          {SECTIONS.map(([k, l, Ic]) => (
            <button key={k} className={sec === k ? 'on' : ''} onClick={() => navigate(`settings/${k}`)}>
              <Ic />{l}{k === 'whatsapp' && boot.whatsapp.connected && <span className="ok" />}
            </button>
          ))}
          <div className="saved"><LuCheck />Changes save as you make them</div>
        </nav>
        <div key={sec} className="section-in">
          {sec === 'business' && <Business />}
          {sec === 'whatsapp' && <WhatsApp />}
          {sec === 'reminders' && <Reminders />}
          {sec === 'automation' && <Automation />}
          {sec === 'team' && <Team />}
          {sec === 'privacy' && <Privacy />}
          {sec === 'appearance' && <Appearance />}
          {sec === 'data' && <Data />}
        </div>
      </div>
    </div>
  );
}

function useSave() {
  const { run, reloadBoot } = useApp();
  return async (body, msg) => { const r = await run(() => patch('/settings/workspace', body), msg); reloadBoot(); return r; };
}

function Head({ title, sub }) {
  return <div className="set-head"><h2>{title}</h2><p>{sub}</p></div>;
}

function Business() {
  const { boot } = useApp();
  const save = useSave();
  const ws = boot.workspace;
  const [f, setF] = useState({ name: ws.name, phone: ws.phone, address: ws.address, email: ws.email, timezone: ws.timezone, slot_minutes: ws.slot_minutes, industry: ws.industry, tagline: ws.tagline });
  useEffect(() => { setF({ name: ws.name, phone: ws.phone, address: ws.address, email: ws.email, timezone: ws.timezone, slot_minutes: ws.slot_minutes, industry: ws.industry, tagline: ws.tagline }); }, [ws]);
  const blur = (k) => () => { if (f[k] !== ws[k]) save({ [k]: f[k] }, 'Saved'); };
  const inp = (k, props = {}) => <input className="input" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} onBlur={blur(k)} {...props} />;
  const hours = ws.hours;
  return (
    <>
      <Head title="Business" sub="Your details, used across Xeroura and in customer messages." />
      <div className="set-grid">
        <div>
          <section className="card set-card">
            <div className="h"><div><h3>Business details</h3><p>Changes save as soon as you leave a field.</p></div></div>
            <div className="grid2">
              <div className="field"><label>Business name</label>{inp('name')}</div>
              <div className="field"><label>Front desk phone</label>{inp('phone')}</div>
            </div>
            <div className="field"><label>Address</label>{inp('address')}<span className="hint">Shown in confirmations and directions.</span></div>
            <div className="grid2">
              <div className="field"><label>Industry</label>{inp('industry')}</div>
              <div className="field"><label>Email</label>{inp('email')}</div>
            </div>
            <div className="grid2">
              <div className="field"><label>Time zone</label>
                <select className="select" value={f.timezone} onChange={(e) => { setF({ ...f, timezone: e.target.value }); save({ timezone: e.target.value }, 'Time zone updated'); }}>
                  {[...new Set([ws.timezone, ...TIMEZONES])].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select><span className="hint">Reminders go out in this time zone.</span>
              </div>
              <div className="field"><label>Default slot length</label>
                <select className="select" value={f.slot_minutes} onChange={(e) => { setF({ ...f, slot_minutes: +e.target.value }); save({ slot_minutes: +e.target.value }, 'Saved'); }}>
                  {[5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </select><span className="hint">New bookings snap to this grid.</span>
              </div>
            </div>
          </section>
          <section className="card set-card">
            <div className="h"><div><h3>Opening hours</h3><p>Used for the schedule, away messages and open-slot counts.</p></div></div>
            {DAYS.map(([k, l]) => {
              const h = hours[k];
              return (
                <div key={k} className="hours-row">
                  <b>{l}</b>
                  <Toggle on={!!h} onChange={(on) => save({ hours: { ...hours, [k]: on ? [540, 1080] : null } })} label={`${l} open`} />
                  {h ? <>
                    <input type="time" className="input" value={minToStr(h[0])} onChange={(e) => save({ hours: { ...hours, [k]: [strToMin(e.target.value), h[1]] } })} />
                    <span className="faint">–</span>
                    <input type="time" className="input" value={minToStr(h[1])} onChange={(e) => save({ hours: { ...hours, [k]: [h[0], strToMin(e.target.value)] } })} />
                  </> : <span className="muted" style={{ gridColumn: '3 / -1' }}>Closed</span>}
                </div>
              );
            })}
            <div className="hours-row">
              <b>Lunch</b>
              <Toggle on={!!ws.lunch} onChange={(on) => save({ lunch: on ? [780, 840] : null })} label="Lunch break" />
              {ws.lunch ? <>
                <input type="time" className="input" value={minToStr(ws.lunch[0])} onChange={(e) => save({ lunch: [strToMin(e.target.value), ws.lunch[1]] })} />
                <span className="faint">–</span>
                <input type="time" className="input" value={minToStr(ws.lunch[1])} onChange={(e) => save({ lunch: [ws.lunch[0], strToMin(e.target.value)] })} />
              </> : <span className="muted" style={{ gridColumn: '3 / -1' }}>No break</span>}
            </div>
          </section>
        </div>
        <section className="card set-card">
          <div className="h"><div><h3>Customers see</h3><p>Your WhatsApp business profile</p></div></div>
          <div className="profile-prev">
            <div className="logo">{ws.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
            <b style={{ fontSize: 15 }}>{ws.name} <LuBadgeCheck className="c-wa" style={{ verticalAlign: -2 }} /></b>
            <span className="muted" style={{ fontSize: 12 }}>Business account · {ws.industry}</span>
            <div className="profile-lines">
              <div className="kv"><LuMapPin />{ws.address}</div>
              <div className="kv"><LuPhone />{ws.phone}</div>
              <div className="kv"><LuClock />{(() => { const h = ws.hours.mon; return h ? `Open today ${fmtTime(Date.UTC(2020, 0, 1, 0, h[0]), 'UTC')} – ${fmtTime(Date.UTC(2020, 0, 1, 0, h[1]), 'UTC')}` : 'Closed today'; })()}</div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function WhatsApp() {
  const { boot, run, reloadBoot, toast } = useApp();
  const wa = boot.whatsapp;
  const [f, setF] = useState({ phone_number_id: wa.phone_number_id, waba_id: wa.waba_id, verify_token: wa.verify_token, access_token: '', app_secret: '', display_phone: wa.display_phone });
  const [to, setTo] = useState('');
  const [testOpen, setTestOpen] = useState(false);
  const webhook = isDemo() ? 'https://<your-domain>/api/webhooks/whatsapp/' : `${apiConfig.url}/api/webhooks/whatsapp/`;
  const saveCreds = async () => {
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
    const r = await run(() => patch('/settings/whatsapp', body), 'WhatsApp settings saved');
    if (r) { setF((x) => ({ ...x, access_token: '', app_secret: '' })); reloadBoot(); }
    return r;
  };
  return (
    <>
      <Head title="WhatsApp" sub="Your WhatsApp Business number and how Xeroura talks to the Cloud API." />
      <section className="card set-card">
        <div className="h"><h3>Connection</h3><div className="right">{wa.demo_mode ? <Chip tone="amber">Demo mode</Chip> : <Chip tone="wa"><LuCircleCheck />Live</Chip>}</div></div>
        <div className="row" style={{ gap: 12 }}>
          <span className="avatar lg" style={{ background: 'var(--wa)', color: '#fff', borderRadius: 12 }}><FaWhatsapp size={22} /></span>
          <div className="grow"><b style={{ fontSize: 14 }}>{wa.verified_name} <LuBadgeCheck className="c-blue" style={{ verticalAlign: -2 }} /></b><div className="muted">{wa.display_phone}</div></div>
          {wa.connected ? <Chip tone="wa" dot>Connected</Chip> : <Chip tone="red" dot>Disconnected</Chip>}
        </div>
        <div className="tile-row">
          <div className="tile"><div className="l">Quality rating</div><div className="v quality"><i /><i /><i style={{ opacity: wa.quality === 'high' ? 1 : 0.3 }} />{wa.quality[0].toUpperCase() + wa.quality.slice(1)}</div></div>
          <div className="tile"><div className="l">Messaging limit</div><div className="v">{wa.messaging_limit}<span className="muted" style={{ fontWeight: 600, fontSize: 12 }}>conversations / 24 h</span></div></div>
          <div className="tile"><div className="l">WhatsApp Business Account ID</div><div className="v mono ellipsis">{wa.waba_id}</div></div>
          <div className="tile"><div className="l">Phone number ID</div><div className="v mono ellipsis">{wa.phone_number_id}</div></div>
        </div>
        <div className="row">
          <Btn variant="wa" icon={LuSend} onClick={() => setTestOpen(true)}>Send test message</Btn>
          {wa.connected && <Btn variant="danger-ghost" icon={LuX} onClick={() => run(() => post('/settings/whatsapp/disconnect'), 'Disconnected').then(reloadBoot)}>Disconnect</Btn>}
        </div>
      </section>
      <section className="card set-card">
        <div className="h"><div><h3>Cloud API credentials</h3><p>From Meta for Developers → your app → WhatsApp → API Setup. Tokens are stored on the server and never shown again.</p></div></div>
        <div className="grid2">
          <div className="field"><label>Phone number ID</label><input className="input mono" value={f.phone_number_id} onChange={(e) => setF({ ...f, phone_number_id: e.target.value })} /></div>
          <div className="field"><label>WhatsApp Business Account ID</label><input className="input mono" value={f.waba_id} onChange={(e) => setF({ ...f, waba_id: e.target.value })} /></div>
        </div>
        <div className="grid2">
          <div className="field"><label>Permanent access token {wa.access_token_set && <Chip tone="wa" className="square">set</Chip>}</label><input className="input mono" type="password" placeholder={wa.access_token_set ? '•••••••• (leave blank to keep)' : 'EAAG…'} value={f.access_token} onChange={(e) => setF({ ...f, access_token: e.target.value })} /><span className="hint">System-user token with whatsapp_business_messaging.</span></div>
          <div className="field"><label>App secret {wa.app_secret_set && <Chip tone="wa" className="square">set</Chip>}</label><input className="input mono" type="password" placeholder={wa.app_secret_set ? '•••••••• (leave blank to keep)' : 'Optional — verifies webhook signatures'} value={f.app_secret} onChange={(e) => setF({ ...f, app_secret: e.target.value })} /><span className="hint">Used to check X-Hub-Signature-256 on every webhook.</span></div>
        </div>
        <div className="row"><AsyncBtn variant="primary" doneLabel="Saved" onClick={saveCreds}>Save credentials</AsyncBtn></div>
      </section>
      <section className="card set-card">
        <div className="h"><div><h3>Webhook</h3><p>Where Meta sends new messages and delivery receipts.</p></div></div>
        <div className="grid2">
          <div className="field"><label>Callback URL</label><CopyField value={webhook} /><span className="hint">Paste into Meta App Dashboard → WhatsApp → Configuration.</span></div>
          <div className="field"><label>Verify token</label><div className="row"><input className="input mono" value={f.verify_token} onChange={(e) => setF({ ...f, verify_token: e.target.value })} onBlur={() => f.verify_token !== wa.verify_token && run(() => patch('/settings/whatsapp', { verify_token: f.verify_token }), 'Verify token saved').then(reloadBoot)} /><Btn size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(f.verify_token); toast('Copied'); }}>Copy</Btn></div><span className="hint">Any string you choose. Meta echoes it back once to prove the URL is yours.</span></div>
        </div>
        <div className="field"><label>Subscribed fields</label><div className="row" style={{ flexWrap: 'wrap' }}>{wa.subscribed_fields.map((x) => <Chip key={x} className="mono outline"><LuCheck />{x}</Chip>)}</div></div>
      </section>
      <section className="card set-card">
        <div className="h"><h3>Go live</h3>{wa.demo_mode && <Chip tone="amber">Demo mode</Chip>}</div>
        {[
          ['Create a Meta app with the WhatsApp product and add your business number', true],
          ['Paste the phone number ID and a permanent access token above', !!wa.access_token_set],
          ['Set the callback URL and verify token in Meta, then subscribe to messages', wa.connected && !wa.demo_mode],
          ['Get booking_confirmation and booking_reminder templates approved', boot.templates.filter((t) => ['booking_confirmation', 'booking_reminder'].includes(t.name) && t.status === 'approved').length === 2],
          ['Send a test message to your own phone', false],
        ].map(([t, ok], i) => (
          <div key={t} className="setting-row"><span className={`avatar sm ${ok ? 'tone-wa' : 'tone-slate'}`}>{ok ? <LuCheck size={12} /> : i + 1}</span><span className="grow">{t}</span></div>
        ))}
      </section>
      {testOpen && (
        <Modal title="Send a test message" icon={<FaWhatsapp className="c-wa" />} onClose={() => setTestOpen(false)} footer={<>
          <button className="btn" onClick={() => setTestOpen(false)}>Cancel</button>
          <button className="btn wa" onClick={async () => { const r = await run(() => post('/settings/whatsapp/test', { to }), (x) => x.message || 'Test sent'); if (r) setTestOpen(false); }}><LuSend />Send</button>
        </>}>
          <div className="field"><label>Your WhatsApp number</label><input className="input" placeholder="+91 98xxx xxxxx" value={to} onChange={(e) => setTo(e.target.value)} /><span className="hint">Sends the hello_world template so it works outside the 24-hour window.</span></div>
        </Modal>
      )}
    </>
  );
}

function Reminders() {
  const { boot } = useApp();
  const save = useSave();
  const r = boot.workspace.reminders;
  return (
    <>
      <Head title="Reminders" sub="Automatic WhatsApp reminders with Confirm and Reschedule buttons." />
      <section className="card set-card">
        <div className="setting-row"><div className="t"><b>Send appointment reminders</b><span>Customers tap Confirm or Reschedule; bookings update automatically.</span></div><Toggle wa on={r.enabled} onChange={(v) => save({ reminders: { enabled: v } }, v ? 'Reminders on' : 'Reminders off')} /></div>
        <div className="setting-row"><div className="t"><b>When</b><span>How long before the appointment.</span></div>
          <select className="select" style={{ width: 200 }} value={r.hours_before} onChange={(e) => save({ reminders: { hours_before: +e.target.value } }, 'Saved')}>
            {[2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{h} hours before</option>)}
          </select>
        </div>
        <div className="setting-row"><div className="t"><b>Template</b><span>Must be an approved utility template.</span></div>
          <select className="select mono" style={{ width: 240 }} value={r.template} onChange={(e) => save({ reminders: { template: e.target.value } }, 'Saved')}>
            {boot.templates.filter((t) => t.status === 'approved' && t.category === 'utility').map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
        <div className="setting-row"><div className="t"><b>Quiet hours</b><span>Reminders due overnight wait until opening time.</span></div><Chip tone="wa"><LuCheck />On</Chip></div>
      </section>
      <div className="info-box"><LuBell /><div>The Django backend runs <span className="mono">python manage.py send_reminders</span> every 15 minutes (see the README for the cron / Celery beat line). In demo mode use <b>Remind tomorrow</b> on Today.</div></div>
    </>
  );
}

function Automation() {
  const { boot, run, reloadBoot } = useApp();
  const save = useSave();
  const ar = boot.workspace.auto_replies;
  const ai = boot.workspace.ai;
  const [g, setG] = useState(ar.greeting_message);
  const [a, setA] = useState(ar.away_message);
  const [ins, setIns] = useState(ai.instructions);
  const [kw, setKw] = useState('');
  const [kwReply, setKwReply] = useState(boot.quick_replies[0]?.id);
  const [qr, setQr] = useState(null);
  return (
    <>
      <Head title="Auto-replies & AI" sub="What happens automatically when a customer messages you." />
      <section className="card set-card">
        <div className="h"><div><h3><LuBot style={{ verticalAlign: -2 }} /> Xeroura AI</h3><p>Claude drafts replies from your business details, services, hours and quick replies. It hands over to a human for complaints, refunds and anything it isn't sure about.</p></div><div className="right"><Toggle on={ai.enabled} onChange={(v) => save({ ai: { enabled: v } }, v ? 'AI on' : 'AI off')} /></div></div>
        <div className="setting-row"><div className="t"><b>Default for new chats</b><span>You can change it per conversation from the chat menu.</span></div>
          <select className="select" style={{ width: 240 }} value={ai.mode} onChange={(e) => save({ ai: { mode: e.target.value } }, 'Saved')}>
            <option value="assist">Suggest replies only</option><option value="auto">Auto-reply when confident</option>
          </select>
        </div>
        <div className="field"><label>Instructions for the AI</label><textarea className="textarea" value={ins} onChange={(e) => setIns(e.target.value)} onBlur={() => ins !== ai.instructions && save({ ai: { instructions: ins } }, 'Saved')} /></div>
        <div className="field"><label>Hand over to a human when the message mentions</label><input className="input" defaultValue={ai.handoff_keywords.join(', ')} onBlur={(e) => save({ ai: { handoff_keywords: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) } }, 'Saved')} /></div>
      </section>
      <section className="card set-card">
        <div className="setting-row"><div className="t"><b>Greeting for first-time contacts</b><span>Sent once, the first time someone messages you.</span></div><Toggle wa on={ar.greeting_enabled} onChange={(v) => save({ auto_replies: { greeting_enabled: v } })} /></div>
        <textarea className="textarea" value={g} onChange={(e) => setG(e.target.value)} onBlur={() => g !== ar.greeting_message && save({ auto_replies: { greeting_message: g } }, 'Saved')} />
        <div className="setting-row"><div className="t"><b>Away message</b><span>Sent outside opening hours.</span></div><Toggle wa on={ar.away_enabled} onChange={(v) => save({ auto_replies: { away_enabled: v } })} /></div>
        <textarea className="textarea" value={a} onChange={(e) => setA(e.target.value)} onBlur={() => a !== ar.away_message && save({ auto_replies: { away_message: a } }, 'Saved')} />
      </section>
      <section className="card set-card">
        <div className="h"><div><h3>Keyword replies</h3><p>When a message contains a keyword, reply with a quick reply instantly.</p></div></div>
        {ar.keywords.map((k) => (
          <div key={k.id} className="setting-row">
            <Chip className="mono lg outline">{k.keyword}</Chip><span className="faint">→</span>
            <span className="grow">{boot.quick_replies.find((q) => q.id === k.reply_id)?.title || 'Missing reply'}</span>
            <Toggle wa on={k.enabled} onChange={(v) => save({ auto_replies: { keywords: ar.keywords.map((x) => (x.id === k.id ? { ...x, enabled: v } : x)) } })} />
            <button className="btn ghost sm" onClick={() => save({ auto_replies: { keywords: ar.keywords.filter((x) => x.id !== k.id) } }, 'Removed')}><LuTrash2 /></button>
          </div>
        ))}
        <div className="row">
          <input className="input" style={{ width: 160 }} placeholder="keyword" value={kw} onChange={(e) => setKw(e.target.value)} />
          <select className="select" value={kwReply} onChange={(e) => setKwReply(+e.target.value)}>{boot.quick_replies.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}</select>
          <Btn icon={LuPlus} disabled={!kw.trim()} onClick={() => { save({ auto_replies: { keywords: [...ar.keywords, { id: Date.now(), keyword: kw.trim().toLowerCase(), reply_id: +kwReply, enabled: true }] } }, 'Keyword added'); setKw(''); }}>Add</Btn>
        </div>
      </section>
      <section className="card set-card">
        <div className="h"><div><h3>Quick replies</h3><p>Snippets in the composer (type / to search). The AI uses them as its knowledge base.</p></div><div className="right"><Btn size="sm" icon={LuPlus} onClick={() => setQr({})}>Add</Btn></div></div>
        {boot.quick_replies.map((q) => (
          <div key={q.id} className="setting-row" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => setQr(q)}>
            <LuZap className="c-amber" style={{ marginTop: 3, flex: 'none' }} />
            <div className="t grow"><b>{q.title}</b><span>{q.body}</span></div>
          </div>
        ))}
      </section>
      {qr && <QuickReplyModal q={qr} onClose={() => setQr(null)} onSaved={reloadBoot} run={run} />}
    </>
  );
}

function QuickReplyModal({ q, onClose, onSaved, run }) {
  const [t, setT] = useState(q.title || '');
  const [b, setB] = useState(q.body || '');
  return (
    <Modal title={q.id ? 'Edit quick reply' : 'New quick reply'} icon={<LuZap className="c-amber" />} onClose={onClose} footer={<>
      {q.id && <button className="btn danger-ghost" style={{ marginRight: 'auto' }} onClick={async () => { await run(() => del(`/quick-replies/${q.id}`), 'Deleted'); onSaved(); onClose(); }}><LuTrash2 />Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!t || !b} onClick={async () => { const r = await run(() => (q.id ? patch(`/quick-replies/${q.id}`, { title: t, body: b }) : post('/quick-replies', { title: t, body: b })), 'Saved'); if (r) { onSaved(); onClose(); } }}>Save</button>
    </>}>
      <div className="field"><label>Title</label><input className="input" value={t} onChange={(e) => setT(e.target.value)} /></div>
      <div className="field"><label>Message</label><textarea className="textarea" rows={5} value={b} onChange={(e) => setB(e.target.value)} /></div>
    </Modal>
  );
}

function Team() {
  const { boot, run, reloadBoot } = useApp();
  const [edit, setEdit] = useState(null);
  const [svc, setSvc] = useState(null);
  return (
    <>
      <Head title="Team & services" sub="Everyone who works in Xeroura, and what customers can book." />
      <section className="card set-card">
        <div className="h"><div><h3>People</h3><p>{boot.staff.filter((s) => s.active).length} active · front desk members answer the inbox</p></div><div className="right"><Btn size="sm" icon={LuPlus} onClick={() => setEdit({})}>Add team member</Btn></div></div>
        {boot.staff.map((s) => (
          <div key={s.id} className="setting-row" style={{ opacity: s.active ? 1 : 0.5 }}>
            <Avatar name={s.name} tone={s.color} />
            <div className="t grow"><b>{s.name}{s.id === boot.me.id && <span className="faint"> (you)</span>}</b><span>{s.role}{s.resource ? ` · ${s.resource}` : ''} · {s.email}</span></div>
            {s.is_agent ? <Chip tone="accent" className="square">Inbox</Chip> : <Chip className="square">Takes bookings</Chip>}
            <Btn size="sm" variant="ghost" onClick={() => setEdit(s)}>Edit</Btn>
          </div>
        ))}
      </section>
      <section className="card set-card">
        <div className="h"><div><h3>Services</h3><p>Duration sets the booking length; price is used by quick replies and the AI.</p></div><div className="right"><Btn size="sm" icon={LuPlus} onClick={() => setSvc({})}>Add service</Btn></div></div>
        {boot.services.map((s) => (
          <div key={s.id} className="setting-row" style={{ cursor: 'pointer' }} onClick={() => setSvc(s)}>
            <i className={`dot c-${s.color}`} style={{ width: 10, height: 10 }} />
            <div className="t grow"><b>{s.name}</b><span>{s.minutes} min · {s.staff.map((id) => boot.staff.find((x) => x.id === id)?.name.split(' ')[0]).filter(Boolean).join(', ') || 'Anyone'}</span></div>
            <b className="num">{s.price ? `₹${s.price.toLocaleString('en-IN')}` : 'Free'}</b>
          </div>
        ))}
      </section>
      {edit && <StaffModal s={edit} onClose={() => setEdit(null)} run={run} onSaved={reloadBoot} />}
      {svc && <ServiceModal s={svc} staff={boot.staff.filter((x) => !x.is_agent)} onClose={() => setSvc(null)} run={run} onSaved={reloadBoot} />}
    </>
  );
}

function StaffModal({ s, onClose, run, onSaved }) {
  const [f, setF] = useState({ name: s.name || '', role: s.role || '', email: s.email || '', resource: s.resource || '', color: s.color || 'teal', is_agent: !!s.is_agent, active: s.active ?? true });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={s.id ? `Edit ${s.name}` : 'Add team member'} icon={<LuUsers />} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!f.name} onClick={async () => { const r = await run(() => (s.id ? patch(`/staff/${s.id}`, { ...f, resource: f.resource || null }) : post('/staff', { ...f, resource: f.resource || null })), 'Saved'); if (r) { onSaved(); onClose(); } }}>Save</button>
    </>}>
      <div className="grid2"><div className="field"><label>Name</label><input className="input" value={f.name} onChange={set('name')} /></div><div className="field"><label>Role</label><input className="input" value={f.role} onChange={set('role')} placeholder="Stylist, Therapist, Front desk…" /></div></div>
      <div className="grid2"><div className="field"><label>Email</label><input className="input" value={f.email} onChange={set('email')} /></div><div className="field"><label>Chair / room</label><input className="input" value={f.resource} onChange={set('resource')} placeholder="Leave empty for front desk" /></div></div>
      <div className="field"><label>Colour</label><div className="row">{COLORS.map((c) => <button key={c} type="button" className={`avatar sm bg-${c}`} style={{ border: 0, boxShadow: f.color === c ? '0 0 0 2px var(--surface), 0 0 0 4px var(--text)' : 'none' }} onClick={() => setF({ ...f, color: c })} aria-label={c} />)}</div></div>
      <div className="setting-row"><div className="t"><b>Works the inbox</b><span>Front desk — doesn't take bookings.</span></div><Toggle on={f.is_agent} onChange={(v) => setF({ ...f, is_agent: v })} /></div>
      <div className="setting-row"><div className="t"><b>Active</b></div><Toggle on={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
    </Modal>
  );
}

function ServiceModal({ s, staff, onClose, run, onSaved }) {
  const [f, setF] = useState({ name: s.name || '', minutes: s.minutes || 30, price: s.price || 0, color: s.color || 'teal', staff: s.staff || [] });
  return (
    <Modal title={s.id ? `Edit ${s.name}` : 'Add service'} icon={<LuScissors />} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!f.name} onClick={async () => { const r = await run(() => (s.id ? patch(`/services/${s.id}`, f) : post('/services', f)), 'Saved'); if (r) { onSaved(); onClose(); } }}>Save</button>
    </>}>
      <div className="field"><label>Name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="grid2">
        <div className="field"><label>Duration (minutes)</label><input type="number" min="5" step="5" className="input" value={f.minutes} onChange={(e) => setF({ ...f, minutes: +e.target.value })} /></div>
        <div className="field"><label>Price (₹)</label><input type="number" min="0" className="input" value={f.price} onChange={(e) => setF({ ...f, price: +e.target.value })} /></div>
      </div>
      <div className="field"><label>Who offers it</label><div className="row" style={{ flexWrap: 'wrap' }}>{staff.map((p) => {
        const on = f.staff.includes(p.id);
        return <button key={p.id} type="button" className={`staff-chip ${on ? '' : 'off'}`} onClick={() => setF({ ...f, staff: on ? f.staff.filter((x) => x !== p.id) : [...f.staff, p.id] })}><i className={`dot c-${p.color}`} />{p.name}</button>;
      })}</div></div>
      <div className="field"><label>Colour</label><div className="row">{COLORS.map((c) => <button key={c} type="button" className={`avatar sm bg-${c}`} style={{ border: 0, boxShadow: f.color === c ? '0 0 0 2px var(--surface), 0 0 0 4px var(--text)' : 'none' }} onClick={() => setF({ ...f, color: c })} aria-label={c} />)}</div></div>
    </Modal>
  );
}

function Privacy() {
  const { boot } = useApp();
  const save = useSave();
  const p = boot.workspace.privacy;
  return (
    <>
      <Head title="Privacy" sub="Consent and what leaves Xeroura." />
      <section className="card set-card">
        <div className="setting-row"><div className="t"><b>Require WhatsApp opt-in</b><span>Broadcasts and reminders only go to contacts who opted in. Customers who message you first are opted in automatically; replying STOP opts them out.</span></div><Toggle on={p.require_opt_in} onChange={(v) => save({ privacy: { require_opt_in: v } })} /></div>
        <div className="setting-row"><div className="t"><b>Keep notes and alerts internal</b><span>Internal notes and alerts are never included in WhatsApp messages or AI prompts that go to customers.</span></div><Toggle on={p.hide_notes_in_whatsapp} onChange={(v) => save({ privacy: { hide_notes_in_whatsapp: v } })} /></div>
        <div className="setting-row"><div className="t"><b>Message retention</b><span>Older conversations are deleted automatically.</span></div>
          <select className="select" style={{ width: 160 }} value={p.retention_days} onChange={(e) => save({ privacy: { retention_days: +e.target.value } }, 'Saved')}>
            {[90, 365, 730, 1825].map((d) => <option key={d} value={d}>{d >= 365 ? `${d / 365} year${d > 365 ? 's' : ''}` : `${d} days`}</option>)}
          </select>
        </div>
      </section>
    </>
  );
}

function Appearance() {
  const { theme, setTheme } = useApp();
  const cards = [['light', 'Light', LuSun, ['#11141a', '#f3f4f0']], ['dark', 'Dark', LuMoon, ['#0a0c10', '#161a21']], ['system', 'Match system', LuMonitor, ['#11141a', 'linear-gradient(90deg,#f3f4f0 50%,#161a21 50%)']]];
  return (
    <>
      <Head title="Appearance" sub="How Xeroura looks on this device." />
      <section className="card set-card">
        <div className="h"><h3>Theme</h3></div>
        <div className="theme-cards">
          {cards.map(([k, l, Ic, [side, main]]) => (
            <button key={k} className={`theme-card ${theme === k ? 'on' : ''}`} onClick={(e) => themeTransition(e, () => setTheme(k))}>
              <div className="sw"><span style={{ background: side }} /><span style={{ background: main }} /></div>
              <span className="row"><Ic size={14} />{l}{theme === k && <LuCheck className="c-wa" style={{ marginLeft: 'auto' }} />}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function Data() {
  const { boot, run, openModal } = useApp();
  const [url, setUrl] = useState(apiConfig.url || 'http://localhost:8000');
  const [u, setU] = useState('admin');
  const [p, setP] = useState('');
  const exportCsv = async () => { const r = await run(() => get('/contacts/export')); if (r) downloadText(r.filename, r.csv); };
  return (
    <>
      <Head title="Data & API" sub="Export your records, connect the backend, or start the demo over." />
      <section className="card set-card">
        <div className="h"><h3>Your data</h3></div>
        <div className="setting-row"><div className="t"><b>Contacts</b><span>Every contact with details, tags and WhatsApp consent.</span></div><Btn size="sm" icon={LuDownload} onClick={exportCsv}>Export CSV</Btn></div>
        {isDemo() && <div className="setting-row"><div className="t"><b>Stored in this browser</b><span>Demo mode: nothing leaves this device until you connect your API.</span></div><b className="num">{boot.storage_kb} KB</b></div>}
        {isDemo() && (
          <div className="danger-zone">
            <div><b>Reset demo data</b><span>Every contact, booking, conversation and setting goes back to the starting data.</span></div>
            <Btn variant="danger" icon={LuRotateCcw} onClick={() => openModal({ type: 'reset' })}>Reset demo data</Btn>
          </div>
        )}
      </section>
      <section className="card set-card">
        <div className="h"><div><h3><LuPlug style={{ verticalAlign: -2 }} /> Backend connection</h3><p>{isDemo() ? 'Running in demo mode. Connect the Django API to use your real WhatsApp number.' : `Connected to ${apiConfig.url}`}</p></div><div className="right">{isDemo() ? <Chip tone="amber">Demo</Chip> : <Chip tone="wa"><LuLink />Live</Chip>}</div></div>
        {isDemo() ? (
          <>
            <div className="field"><label>API URL</label><input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
            <div className="grid2">
              <div className="field"><label>Username</label><input className="input" value={u} onChange={(e) => setU(e.target.value)} /></div>
              <div className="field"><label>Password</label><input className="input" type="password" value={p} onChange={(e) => setP(e.target.value)} /></div>
            </div>
            <div className="row"><Btn variant="primary" icon={LuLink} onClick={async () => { const r = await run(() => login(url, u, p), 'Connected'); if (r) { window.location.hash = '#/today'; window.location.reload(); } }}>Connect</Btn></div>
          </>
        ) : (
          <div className="row"><Btn icon={LuTriangleAlert} onClick={() => { switchToDemo(); window.location.reload(); }}>Switch back to demo mode</Btn></div>
        )}
      </section>
    </>
  );
}
