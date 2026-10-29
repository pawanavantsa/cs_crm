import { useEffect, useRef, useState } from 'react';
import { useFlip } from '../motion.js';
import {
  LuSend, LuEye, LuReply, LuCalendarDays, LuFileText, LuMegaphone, LuTag, LuClock, LuUsers, LuLock, LuX, LuCopy,
  LuPencil, LuEllipsis, LuTrash2, LuPlus, LuCalendarCheck,
} from 'react-icons/lu';
import { FaWhatsapp } from 'react-icons/fa';
import { useApi, post, patch, del } from '../api.js';
import { useApp, Chip, Btn, Stat, Seg, Menu, Modal, pct, num, AsyncBtn, Num } from '../ui.jsx';
import { fmtDate, fmtTime, fmtRelDay, zonedToUtc } from '../lib/time.js';

const STATUS = { scheduled: ['blue', 'Scheduled'], draft: ['slate', 'Draft'], sending: ['amber', 'Sending'], sent: ['wa', 'Sent'] };

function Highlight({ text, name }) {
  if (!text) return null;
  const parts = text.split(/(\{\{\d+\}\})/);
  return parts.map((p, i) => (/^\{\{\d+\}\}$/.test(p) ? <span key={i} className="hl">{p}</span> : p.split(name).flatMap((q, j, arr) => (j < arr.length - 1 ? [q, <span key={`${i}-${j}`} className="hl">{name}</span>] : [q]))));
}

export default function Campaigns({ route }) {
  const { tz, now, run, navigate } = useApp();
  const tab = route.id === 'templates' ? 'templates' : 'broadcasts';
  const { data } = useApi('/campaigns');
  const tpls = useApi('/templates');
  const [editing, setEditing] = useState(null);
  const [tplEdit, setTplEdit] = useState(null);
  const gridRef = useRef(null);
  useFlip(gridRef, `${tab}${data?.items.map((c) => c.status).join()}${tpls.data?.length}`);

  useEffect(() => {
    if (route.id === 'new') setEditing({});
    if (route.id === 'templates' && route.sub === 'new') setTplEdit({});
  }, [route.id, route.sub]);

  const s = data?.stats;
  return (
    <div className="content">
      <div className="page-head">
        <div><div className="eyebrow">WhatsApp broadcasts and templates</div><h1>Campaigns</h1></div>
        <div className="head-actions">
          <Btn icon={LuFileText} onClick={() => setTplEdit({})}>New template</Btn>
          <Btn variant="primary" icon={LuMegaphone} onClick={() => setEditing({})}>New broadcast</Btn>
        </div>
      </div>
      <div className="stats">
        <Stat icon={LuSend} label="Messages sent" value={s ? num(s.messages_sent) : '–'} />
        <Stat icon={LuEye} label="Read rate" value={s ? pct(s.read_rate) : '–'} />
        <Stat icon={LuReply} label="Reply rate" value={s ? pct(s.reply_rate) : '–'} />
        <Stat icon={LuCalendarCheck} label="Bookings from broadcasts" value={s?.bookings ?? '–'} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <Seg value={tab} onChange={(v) => navigate(v === 'templates' ? 'campaigns/templates' : 'campaigns')} options={[{ value: 'broadcasts', label: 'Broadcasts', n: data?.items.length }, { value: 'templates', label: 'Templates', n: tpls.data?.length }]} />
      </div>
      {tab === 'broadcasts' && (
        <div className="camp-grid" ref={gridRef}>
          {data?.items.map((c) => <CampaignCard key={c.id} c={c} tz={tz} now={now()} run={run} onEdit={() => setEditing(c)} />)}
          {!data && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 300 }} />)}
        </div>
      )}
      {tab === 'templates' && (
        <div className="camp-grid" ref={gridRef}>
          {tpls.data?.map((t) => <TemplateCard key={t.id} t={t} onEdit={() => setTplEdit(t)} />)}
        </div>
      )}
      {editing && <CampaignModal c={editing} audiences={data?.audiences || ['all']} templates={tpls.data || []} onClose={() => { setEditing(null); if (route.id === 'new') navigate('campaigns'); }} />}
      {tplEdit && <TemplateModal t={tplEdit} onClose={() => { setTplEdit(null); if (route.sub === 'new') navigate('campaigns/templates'); }} />}
    </div>
  );
}

function CampaignCard({ c, tz, now, run, onEdit }) {
  const [tone, label] = STATUS[c.status];
  const st = c.stats;
  const aud = c.audience.type === 'all' ? 'All contacts' : c.audience.value;
  return (
    <article className="card camp" data-flip={`k${c.id}`}>
      <div className="title">
        <span className="ic"><FaWhatsapp /></span>
        <div className="grow"><b>{c.name}</b><span className="mono muted">{c.template?.name}</span></div>
        <Chip key={c.status} tone={tone} dot className="square badge-pop">{label}</Chip>
      </div>
      <div className="facts">
        <span><LuTag />{aud}</span>
        {c.status === 'scheduled' && <span><LuClock /><b>Sends {fmtRelDay(c.scheduled_at, tz, now).toLowerCase()}</b>&nbsp;{fmtTime(c.scheduled_at, tz)}</span>}
        {c.status === 'draft' && <span><LuCalendarDays />Not scheduled</span>}
        {c.status === 'sent' && <span><LuCalendarDays />Sent {fmtDate(c.sent_at, tz)}</span>}
        <span><LuUsers /><b>{num(c.audience_count)}</b>&nbsp;recipients{c.status === 'draft' ? ' if sent now' : ''}</span>
      </div>
      {c.excluded > 0 && (
        <div className="excluded"><LuLock /><span><b>{c.excluded} excluded</b> — no WhatsApp consent{c.status !== 'sent' && c.excluded_detail ? ` (${c.excluded_detail.opted_out} opted out, ${c.excluded_detail.pending} pending)` : ''}</span></div>
      )}
      {st ? (
        <div className="col" style={{ gap: 7, padding: '4px 0' }}>
          {[['Sent', st.sent, 'var(--teal)'], ['Delivered', st.delivered, 'var(--wa)'], ['Read', st.read, 'var(--blue)'], ['Replied', st.replied, 'var(--violet)'], ['Booked', st.booked, 'var(--orange)']].map(([l, v, col]) => (
            <div key={l} className="funnel-row"><span className="lbl">{l}</span><div className="bar"><i style={{ width: `${(v / st.sent) * 100}%`, background: col }} /></div><span className="v num"><Num value={num(v)} /></span><span className="p num">{pct(v / st.sent)}</span></div>
          ))}
        </div>
      ) : c.preview && (
        <div className="wa-preview">
          <div className="bubble out">
            {c.preview.header && <div className="tpl-head">{c.preview.header}</div>}
            <Highlight text={c.preview.body} name={c.preview.sample_name} />
            {c.preview.buttons?.length > 0 && <div className="tpl-buttons">{c.preview.buttons.map((b) => <div key={b}><LuReply />{b}</div>)}</div>}
          </div>
        </div>
      )}
      <div className="actions">
        {c.status === 'scheduled' && <Btn size="sm" icon={LuX} variant="ghost" onClick={() => run(() => post(`/campaigns/${c.id}/cancel`), 'Schedule cancelled')}>Cancel schedule</Btn>}
        {c.status === 'draft' && <AsyncBtn size="sm" variant="wa" icon={LuSend} doneLabel="Sent" minMs={1100} onClick={() => run(() => post(`/campaigns/${c.id}/send`), (r) => `Sent to ${r.audience_count} contacts`)}>Send now</AsyncBtn>}
        {c.status !== 'sent' && <Btn size="sm" variant="ghost" icon={LuPencil} onClick={onEdit}>Edit</Btn>}
        {c.status === 'sent' && <Btn size="sm" variant="ghost" icon={LuCopy} onClick={() => run(() => post(`/campaigns/${c.id}/duplicate`), 'Duplicated as a draft')}>Duplicate</Btn>}
        <div className="right">
          {st && <span className="row" style={{ gap: 5 }}><LuCalendarCheck className="c-orange" size={14} /><b style={{ color: 'var(--text)' }}>{st.booked}</b> booked</span>}
          <Menu width={180} trigger={({ toggle }) => <button className="btn ghost sm" onClick={toggle} aria-label="More"><LuEllipsis /></button>}>
            <button onClick={() => run(() => post(`/campaigns/${c.id}/duplicate`), 'Duplicated')}><LuCopy />Duplicate</button>
            {c.status !== 'sent' && <button className="danger" onClick={() => run(() => del(`/campaigns/${c.id}`), 'Deleted')}><LuTrash2 />Delete</button>}
          </Menu>
        </div>
      </div>
    </article>
  );
}

function TemplateCard({ t, onEdit }) {
  const { run } = useApp();
  const tone = { approved: 'wa', pending: 'amber', rejected: 'red' }[t.status];
  return (
    <article className="card tpl-card" data-flip={`t${t.id}`}>
      <div className="row">
        <span className="mono" style={{ fontWeight: 700 }}>{t.name}</span>
        <Chip className="square" style={{ marginLeft: 'auto' }}>{t.category}</Chip>
        <Chip tone={tone} dot className="square">{t.status}</Chip>
      </div>
      <div className="wa-preview">
        <div className="bubble out">
          {t.header && <div className="tpl-head">{t.header}</div>}
          <Highlight text={t.body} name="§" />
          {t.footer && <div className="tpl-foot">{t.footer}</div>}
          {t.buttons.length > 0 && <div className="tpl-buttons">{t.buttons.map((b) => <div key={b}><LuReply />{b}</div>)}</div>}
        </div>
      </div>
      <div className="row muted" style={{ fontSize: 12, flexWrap: 'wrap' }}>
        {t.variables.map((v, i) => <span key={v} className="chip square outline">{`{{${i + 1}}}`} {v.replace('_', ' ')}</span>)}
      </div>
      <div className="row">
        <Btn size="sm" variant="ghost" icon={LuPencil} onClick={onEdit}>Edit</Btn>
        <Btn size="sm" variant="danger-ghost" icon={LuTrash2} onClick={() => run(() => del(`/templates/${t.id}`), 'Template deleted')}>Delete</Btn>
        <span className="faint" style={{ marginLeft: 'auto', fontSize: 11.5 }}>{t.language.toUpperCase()}</span>
      </div>
    </article>
  );
}

function CampaignModal({ c, audiences, templates, onClose }) {
  const { run, tz } = useApp();
  const approved = templates.filter((t) => t.status === 'approved');
  const [name, setName] = useState(c.name || '');
  const [tpl, setTpl] = useState(c.template_id || approved[0]?.id || '');
  const [aud, setAud] = useState(c.audience ? (c.audience.type === 'all' ? 'all' : c.audience.value) : 'all');
  const [when, setWhen] = useState(c.scheduled_at ? toLocalInput(c.scheduled_at, tz) : '');
  const t = templates.find((x) => x.id === +tpl);
  const save = async (sendNow) => {
    const body = { name: name || t?.name.replace(/_/g, ' '), template_id: +tpl, audience: aud === 'all' ? { type: 'all' } : { type: 'tag', value: aud }, scheduled_at: when ? fromLocalInput(when, tz) : null };
    const r = await run(() => (c.id ? patch(`/campaigns/${c.id}`, body) : post('/campaigns', body)), sendNow ? null : (when ? 'Broadcast scheduled' : 'Draft saved'));
    if (r && sendNow) await run(() => post(`/campaigns/${r.id}/send`), (x) => `Sent to ${x.audience_count} contacts`);
    if (r) onClose();
  };
  return (
    <Modal wide title={c.id ? 'Edit broadcast' : 'New broadcast'} icon={<LuMegaphone />} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn" onClick={() => save(false)} disabled={!tpl}>{when ? 'Schedule' : 'Save draft'}</button>
      {!when && <button className="btn wa" onClick={() => save(true)} disabled={!tpl}><LuSend />Send now</button>}
    </>}>
      <div className="grid2">
        <div className="col" style={{ gap: 12 }}>
          <div className="field"><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Win-back · lapsed 90 days" /></div>
          <div className="field"><label>Template</label>
            <select className="select" value={tpl} onChange={(e) => setTpl(e.target.value)}>
              {approved.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.category}</option>)}
            </select>
            <span className="hint">Broadcasts can only use templates approved by Meta.</span>
          </div>
          <div className="field"><label>Audience</label>
            <select className="select" value={aud} onChange={(e) => setAud(e.target.value)}>
              {audiences.map((a) => <option key={a} value={a}>{a === 'all' ? 'All contacts' : a}</option>)}
            </select>
            <span className="hint">Only contacts who opted in to WhatsApp receive it.</span>
          </div>
          <div className="field"><label>Send at (optional)</label><input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} /><span className="hint">Leave empty to save a draft or send now. Time zone: {tz}.</span></div>
        </div>
        <div className="wa-preview">
          {t && <div className="bubble out">{t.header && <div className="tpl-head">{t.header}</div>}<Highlight text={t.body} name="§" />{t.buttons.length > 0 && <div className="tpl-buttons">{t.buttons.map((b) => <div key={b}><LuReply />{b}</div>)}</div>}</div>}
          <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>Highlighted variables are filled per contact.</div>
        </div>
      </div>
    </Modal>
  );
}

function TemplateModal({ t, onClose }) {
  const { run, reloadBoot } = useApp();
  const [f, setF] = useState({ name: t.name || '', category: t.category || 'utility', language: t.language || 'en', header: t.header || '', body: t.body || '', footer: t.footer || '', buttons: (t.buttons || []).join(', '), variables: (t.variables || []).join(', ') });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const count = (f.body.match(/\{\{\d+\}\}/g) || []).length;
  const save = async () => {
    const body = { ...f, header: f.header || null, footer: f.footer || null, buttons: f.buttons.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3), variables: f.variables.split(',').map((x) => x.trim()).filter(Boolean) };
    const r = await run(() => (t.id ? patch(`/templates/${t.id}`, body) : post('/templates', body)), t.id ? 'Template updated — resubmitted for approval' : 'Template submitted to Meta for approval');
    if (r) { reloadBoot(); onClose(); }
  };
  return (
    <Modal wide title={t.id ? `Edit ${t.name}` : 'New message template'} icon={<LuFileText />} onClose={onClose} footer={<>
      <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Templates are reviewed by Meta, usually within minutes.</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save}><LuPlus />{t.id ? 'Save & resubmit' : 'Submit for approval'}</button>
    </>}>
      <div className="grid2">
        <div className="field"><label>Name</label><input className="input mono" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="booking_followup" disabled={!!t.id} /></div>
        <div className="grid2">
          <div className="field"><label>Category</label><select className="select" value={f.category} onChange={set('category')}><option value="utility">Utility</option><option value="marketing">Marketing</option><option value="authentication">Authentication</option></select></div>
          <div className="field"><label>Language</label><select className="select" value={f.language} onChange={set('language')}><option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option></select></div>
        </div>
      </div>
      <div className="field"><label>Header (optional)</label><input className="input" value={f.header} onChange={set('header')} /></div>
      <div className="field"><label>Body</label><textarea className="textarea" rows={4} value={f.body} onChange={set('body')} placeholder="Hi {{1}}, …" /><span className="hint">Use {'{{1}}'}, {'{{2}}'} … for values filled per contact. {count} variable{count === 1 ? '' : 's'} found.</span></div>
      <div className="grid2">
        <div className="field"><label>Variables, in order</label><input className="input" value={f.variables} onChange={set('variables')} placeholder="first_name, service, staff, when" /><span className="hint">first_name, service, staff, when, business_address, last_staff</span></div>
        <div className="field"><label>Quick-reply buttons (max 3)</label><input className="input" value={f.buttons} onChange={set('buttons')} placeholder="Confirm, Reschedule" /></div>
      </div>
      <div className="field"><label>Footer (optional)</label><input className="input" value={f.footer} onChange={set('footer')} /></div>
    </Modal>
  );
}

function toLocalInput(ts, tz) {
  const d = new Date(ts);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromLocalInput(v, tz) {
  const [date, time] = v.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return zonedToUtc(y, m, d, hh, mm, tz);
}
