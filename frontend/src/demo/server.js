// In-browser implementation of the Xeroura CRM REST API.
// Mirrors backend/crm/api.py endpoint-for-endpoint so the UI can run with no server
// ("demo mode"). Data lives in localStorage until you connect the Django API.
import { buildSeed } from './seed.js';
import {
  dayKey, addDaysKey, zonedToUtc, parseDayKey, weekdayOfKey, minutesOfDay, fmtTime, fmtRelDay, partsInTz,
} from '../lib/time.js';
import { renderTemplate, templateValues, windowOpen, firstName, whenPhrase } from '../lib/whatsapp.js';

const KEY = 'xcrm.demo.v5';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEMO_CLOCK_MIN = 10 * 60 + 44;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class DemoServer {
  constructor() {
    this.listeners = new Set();
    this.load();
  }

  // ---------- persistence & clock
  load() {
    let db = null;
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
    const tz = db?.workspace?.timezone || 'Asia/Kolkata';
    if (!db || db.clock?.day !== dayKey(Date.now(), tz)) db = this.fresh(tz);
    this.db = db;
  }

  fresh(tz = 'Asia/Kolkata') {
    const today = dayKey(Date.now(), tz);
    const { y, m, d } = parseDayKey(today);
    const virtual = zonedToUtc(y, m, d, Math.floor(DEMO_CLOCK_MIN / 60), DEMO_CLOCK_MIN % 60, tz);
    const db = buildSeed(virtual, tz);
    db.clock = { day: today, real: Date.now(), virtual, mode: 'demo' };
    return db;
  }

  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(this.db)); } catch { /* quota or private mode */ }
    }, 250);
    this.listeners.forEach((fn) => fn());
  }

  now() {
    const c = this.db.clock;
    if (c.mode === 'live') return Date.now();
    return c.virtual + (Date.now() - c.real);
  }

  get tz() { return this.db.workspace.timezone; }

  // ---------- lookups
  contact(id) { return this.db.contacts.find((c) => c.id === +id); }
  staffById(id) { return this.db.staff.find((s) => s.id === +id); }
  service(id) { return this.db.services.find((s) => s.id === +id); }
  conv(id) { return this.db.conversations.find((c) => c.id === +id); }
  booking(id) { return this.db.bookings.find((b) => b.id === +id); }
  template(id) { return this.db.templates.find((t) => t.id === +id || t.name === id); }

  next(kind) { return this.db.seq[kind]++; }

  // ---------- serializers
  staffBrief(s) {
    return s ? { id: s.id, name: s.name, initials: initials(s.name), color: s.color, role: s.role, resource: s.resource } : null;
  }

  bookingOut(b) {
    const c = this.contact(b.contact_id);
    const s = this.staffById(b.staff_id);
    const sv = this.service(b.service_id);
    const now = this.now();
    let progress = null;
    if (b.status === 'in_service' && b.started_at) {
      progress = Math.min(1, Math.max(0.03, (now - b.started_at) / (b.end - b.start)));
    }
    return {
      ...b,
      contact: c ? { id: c.id, name: c.name, initials: initials(c.name), phone: c.phone, opt_in: c.opt_in, tags: c.tags } : null,
      staff: this.staffBrief(s),
      service: sv ? { id: sv.id, name: sv.name, color: sv.color, minutes: sv.minutes } : null,
      progress,
    };
  }

  lastMessage(convId) {
    const ms = this.db.messages.filter((m) => m.conversation_id === convId && m.kind !== 'event' && m.kind !== 'note');
    return ms[ms.length - 1] || null;
  }

  convOut(c) {
    const contact = this.contact(c.contact_id);
    const last = this.lastMessage(c.id);
    const now = this.now();
    const waiting = c.status === 'open' && last && last.direction === 'in';
    const a = this.staffById(c.assignee_id);
    return {
      id: c.id,
      status: c.status,
      contact: { id: contact.id, name: contact.name, initials: initials(contact.name), phone: contact.phone, opt_in: contact.opt_in },
      assignee: a ? { id: a.id, name: a.name, initials: initials(a.name) } : null,
      labels: c.labels,
      pinned: c.pinned,
      unread: c.unread,
      urgent: c.urgent,
      ai_mode: c.ai_mode,
      last: last ? {
        body: last.body, direction: last.direction, author: last.author, kind: last.kind,
        template_name: last.template?.name || null, status: last.status, created_at: last.created_at,
      } : null,
      last_inbound_at: c.last_inbound_at,
      waiting_since: waiting ? this.waitingSince(c.id) : null,
      window_open: windowOpen(c.last_inbound_at, now),
      updated_at: c.updated_at,
    };
  }

  waitingSince(convId) {
    const ms = this.db.messages.filter((m) => m.conversation_id === convId && m.kind !== 'event' && m.kind !== 'note');
    let since = null;
    for (let i = ms.length - 1; i >= 0; i--) {
      if (ms[i].direction !== 'in') break;
      since = ms[i].created_at;
    }
    return since;
  }

  contactStats(c) {
    const now = this.now();
    const bs = this.db.bookings.filter((b) => b.contact_id === c.id);
    const done = bs.filter((b) => b.status === 'done').sort((a, b) => b.start - a.start);
    const upcoming = bs.filter((b) => b.start > now - 3600e3 && ['booked', 'confirmed', 'arrived', 'in_service'].includes(b.status)).sort((a, b) => a.start - b.start);
    return {
      visits: done.length,
      last_visit: done[0] ? { start: done[0].start, service: this.service(done[0].service_id)?.name, staff: this.staffById(done[0].staff_id)?.name } : null,
      next_booking: upcoming[0] ? this.bookingOut(upcoming[0]) : null,
      no_shows: bs.filter((b) => b.status === 'no_show').length,
    };
  }

  contactOut(c, full = false) {
    const st = this.contactStats(c);
    const owner = this.staffById(c.owner_id);
    const out = { ...c, initials: initials(c.name), owner: this.staffBrief(owner), ...st };
    if (full) {
      out.bookings = this.db.bookings.filter((b) => b.contact_id === c.id).sort((a, b) => b.start - a.start).slice(0, 12).map((b) => this.bookingOut(b));
      const cv = this.db.conversations.find((x) => x.contact_id === c.id);
      out.conversation_id = cv ? cv.id : null;
      out.recall_due = this.recallDue(c, st);
    }
    return out;
  }

  recallDue(c, st = this.contactStats(c)) {
    if (st.next_booking || !st.last_visit) return false;
    return this.now() - st.last_visit.start > 45 * 864e5;
  }

  // ---------- messaging (simulated WhatsApp Cloud API)
  pushMessage(conv, m) {
    const msg = {
      id: this.next('message'), conversation_id: conv.id, direction: 'out', author: 'agent', author_name: null,
      kind: 'text', body: '', template: null, status: 'sent', wa_id: `wamid.demo${Date.now()}${Math.floor(Math.random() * 1e4)}`,
      error: null, reply_to: null, created_at: this.now(), ...m,
    };
    this.db.messages.push(msg);
    if (msg.kind !== 'event' && msg.kind !== 'note') conv.updated_at = msg.created_at;
    if (msg.direction === 'out' && msg.kind !== 'note' && msg.kind !== 'event') this.simulateDelivery(msg.id);
    return msg;
  }

  simulateDelivery(id) {
    const step = (status, delay) => setTimeout(() => {
      const m = this.db.messages.find((x) => x.id === id);
      if (m && m.status !== 'failed') { m.status = status; this.save(); }
    }, delay);
    step('delivered', 1200);
    step('read', 4500);
  }

  ensureConversation(contactId, assigneeId = null) {
    let c = this.db.conversations.find((x) => x.contact_id === +contactId);
    if (!c) {
      c = {
        id: this.next('conversation'), contact_id: +contactId, status: 'open', assignee_id: assigneeId, labels: [],
        pinned: false, ai_mode: this.db.workspace.ai.mode === 'auto' ? 'auto' : 'assist', unread: 0, urgent: false,
        created_at: this.now(), last_inbound_at: null, updated_at: this.now(),
      };
      this.db.conversations.push(c);
    }
    return c;
  }

  sendTemplate(conv, template, values, author = 'agent', authorName = null) {
    const contact = this.contact(conv.contact_id);
    if (contact.opt_in === 'opted_out') throw new HttpError(400, `${contact.name} opted out of WhatsApp messages.`);
    if (template.status !== 'approved') throw new HttpError(400, 'Only approved templates can be sent.');
    const extra = { business_name: this.db.workspace.name };
    const body = renderTemplate(template.body, values, extra);
    return this.pushMessage(conv, {
      kind: 'template', author, author_name: authorName, body,
      template: { name: template.name, header: renderTemplate(template.header, values, extra), footer: renderTemplate(template.footer, values, extra), buttons: template.buttons },
    });
  }

  sendReminder(b) {
    const tpl = this.template(this.db.workspace.reminders.template) || this.template('booking_reminder');
    const contact = this.contact(b.contact_id);
    if (contact.opt_in !== 'opted_in') return false;
    const conv = this.ensureConversation(contact.id);
    const whenText = whenPhrase(fmtRelDay(b.start, this.tz, this.now()), fmtTime(b.start, this.tz));
    const values = templateValues(tpl, { contact, serviceName: this.service(b.service_id)?.name, staffName: this.staffById(b.staff_id)?.name, whenText, business: this.db.workspace });
    const m = this.sendTemplate(conv, tpl, values, 'system', 'Reminder');
    m.booking_id = b.id;
    b.reminder = 'sent';
    b.reminder_at = this.now();
    // Simulated receipts update the booking too
    setTimeout(() => { if (b.reminder === 'sent') { b.reminder = 'delivered'; this.save(); } }, 1200);
    setTimeout(() => { if (b.reminder === 'delivered') { b.reminder = 'read'; this.save(); } }, 4500);
    return true;
  }

  // Inbound message (same logic the Django webhook runs)
  inbound({ contact_id, phone, name, body, kind: k, button_payload = null }) {
    const kind = k || (/^\s*(confirm|reschedule)\s*$/i.test(body) ? 'button' : 'text');
    let contact = contact_id ? this.contact(contact_id) : this.db.contacts.find((c) => c.phone.replace(/\D/g, '') === String(phone || '').replace(/\D/g, ''));
    if (!contact) {
      contact = {
        id: this.next('contact'), name: name || phone, phone, email: '', gender: '', tags: ['New'], opt_in: 'opted_in', opt_in_at: this.now(),
        owner_id: null, source: 'whatsapp', language: 'English', notes: '', alerts: [], created_at: this.now(),
      };
      this.db.contacts.push(contact);
    }
    if (contact.opt_in !== 'opted_in' && contact.opt_in !== 'opted_out') { contact.opt_in = 'opted_in'; contact.opt_in_at = this.now(); }
    if (/^\s*(stop|unsubscribe)\s*$/i.test(body)) { contact.opt_in = 'opted_out'; }
    const conv = this.ensureConversation(contact.id);
    const wasResolved = conv.status === 'resolved';
    const firstEver = !this.db.messages.some((m) => m.conversation_id === conv.id && m.direction === 'in');
    conv.status = 'open';
    conv.unread += 1;
    conv.last_inbound_at = this.now();
    const m = this.pushMessage(conv, { direction: 'in', author: 'customer', kind, body, status: 'delivered' });

    // Reminder button replies → update booking
    if (kind === 'button') {
      const b = this.db.bookings
        .filter((x) => x.contact_id === contact.id && x.start > this.now() && ['booked', 'confirmed'].includes(x.status))
        .sort((x, y) => x.start - y.start)[0];
      if (b && /confirm/i.test(body)) { b.reminder = 'confirmed'; b.status = 'confirmed'; this.pushMessage(conv, { author: 'system', author_name: 'Auto', body: `Thanks ${firstName(contact.name)}, you're confirmed ✅ See you ${fmtRelDay(b.start, this.tz, this.now()).toLowerCase()} at ${fmtTime(b.start, this.tz)}.` }); }
      if (b && /reschedule/i.test(body)) { b.reminder = 'reschedule'; if (!conv.labels.includes('Booking')) conv.labels.push('Booking'); }
    }

    // Auto replies: greeting / away / keywords
    const ar = this.db.workspace.auto_replies;
    const open = this.isOpenAt(this.now());
    let autoReplied = false;
    if (!open && ar.away_enabled) {
      this.pushMessage(conv, { author: 'system', author_name: 'Away message', body: ar.away_message });
      autoReplied = true;
    } else if (firstEver && !wasResolved && ar.greeting_enabled) {
      this.pushMessage(conv, { author: 'system', author_name: 'Greeting', body: ar.greeting_message });
    }
    for (const rule of ar.keywords || []) {
      if (rule.enabled && body.toLowerCase().includes(rule.keyword.toLowerCase())) {
        const qr = this.db.quick_replies.find((q) => q.id === rule.reply_id);
        if (qr) { this.pushMessage(conv, { author: 'system', author_name: `Keyword · ${rule.keyword}`, body: qr.body }); autoReplied = true; }
        break;
      }
    }

    // AI: hand-off detection + auto reply when enabled for this chat
    const ai = this.db.workspace.ai;
    if (ai.enabled && conv.ai_mode === 'auto' && !autoReplied && kind !== 'button') {
      const wantsHuman = ai.handoff_keywords.some((k) => body.toLowerCase().includes(k));
      if (wantsHuman) {
        conv.ai_mode = 'off';
        if (!conv.labels.includes('Needs human')) conv.labels.push('Needs human');
        this.pushMessage(conv, { author: 'ai', author_name: 'Xeroura AI', body: "I've asked a teammate to pick this up — they'll reply here shortly." });
      } else {
        const s = this.suggest(conv.id);
        if (s.confidence >= 0.7) this.pushMessage(conv, { author: 'ai', author_name: 'Xeroura AI', body: s.suggestion });
      }
    }
    this.save();
    return { conversation: this.convOut(conv), message: m };
  }

  isOpenAt(ts) {
    const p = partsInTz(ts, this.tz);
    const hrs = this.db.workspace.hours[DAYS[p.wd]];
    const min = p.hh * 60 + p.mm;
    return !!hrs && min >= hrs[0] && min < hrs[1];
  }

  // Keyword-matching stand-in for the Claude suggestion endpoint.
  suggest(convId) {
    const conv = this.conv(convId);
    const contact = this.contact(conv.contact_id);
    const ins = this.db.messages.filter((m) => m.conversation_id === conv.id && m.direction === 'in');
    const text = (ins[ins.length - 1]?.body || '').toLowerCase();
    const qr = (title) => this.db.quick_replies.find((q) => q.title === title)?.body;
    const fn = firstName(contact.name);
    const rules = [
      [/park|address|where|location|direction/, qr('Location & parking')],
      [/upi|card|cash|pay/, qr('Payments')],
      [/price|cost|how much|rate|₹|rs/, qr('Prices')],
      [/hour|open|close|timing|sunday/, qr('Opening hours')],
      [/late|traffic|running/, qr('Running late?')],
      [/bring|prepare|wash/, qr('What to bring')],
    ];
    for (const [re, reply] of rules) if (re.test(text) && reply) return { suggestion: `Hi ${fn}! ${reply}`, confidence: 0.86, source: 'quick replies' };
    if (/move|later|resched|change|earlier|cancel/.test(text)) {
      const st = this.contactStats(contact);
      if (st.next_booking) {
        return { suggestion: `Hi ${fn}, of course. ${st.next_booking.staff.name.split(' ')[0]} has 1:30 PM or 3:00 PM free ${fmtRelDay(st.next_booking.start, this.tz, this.now()).toLowerCase()} — which would you prefer?`, confidence: 0.72, source: 'schedule' };
      }
    }
    if (/book|appointment|slot|available|saturday|friday|monday|tuesday|wednesday|thursday/.test(text)) {
      return { suggestion: `Hi ${fn}! Happy to get you booked in. Which service would you like, and what day suits you best?`, confidence: 0.7, source: 'services' };
    }
    return { suggestion: `Hi ${fn}, thanks for your message — let me check and get back to you in a moment.`, confidence: 0.4, source: 'fallback' };
  }

  // ---------- analytics helpers
  bookingsBetween(from, to) {
    return this.db.bookings.filter((b) => b.start >= from && b.start < to);
  }

  dayRange(key) {
    const { y, m, d } = parseDayKey(key);
    const next = parseDayKey(addDaysKey(key, 1));
    return [zonedToUtc(y, m, d, 0, 0, this.tz), zonedToUtc(next.y, next.m, next.d, 0, 0, this.tz)];
  }

  capacityMinutes(key) {
    const hrs = this.db.workspace.hours[DAYS[weekdayOfKey(key)]];
    if (!hrs) return 0;
    const lunch = this.db.workspace.lunch ? this.db.workspace.lunch[1] - this.db.workspace.lunch[0] : 0;
    return (hrs[1] - hrs[0] - lunch) * this.db.staff.filter((s) => !s.is_agent && s.active).length;
  }

  replyTimes(sinceTs) {
    // minutes between first inbound of a waiting streak and next outbound human/ai reply
    const out = [];
    const byConv = new Map();
    for (const m of this.db.messages) {
      if (m.kind === 'event' || m.kind === 'note') continue;
      if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
      byConv.get(m.conversation_id).push(m);
    }
    for (const ms of byConv.values()) {
      let waitStart = null;
      for (const m of ms) {
        if (m.direction === 'in') { if (waitStart === null) waitStart = m.created_at; }
        else if (waitStart !== null && (m.author === 'agent' || m.author === 'ai')) {
          if (waitStart >= sinceTs) out.push((m.created_at - waitStart) / 60000);
          waitStart = null;
        }
      }
    }
    return out;
  }

  // ---------- routes
  async handle(method, rawPath, body = {}) {
    const [path, qs] = rawPath.split('?');
    const q = Object.fromEntries(new URLSearchParams(qs || ''));
    const seg = path.replace(/^\/+|\/+$/g, '').split('/');
    const M = method.toUpperCase();
    const route = `${M} /${seg.map((s) => (/^\d+$/.test(s) ? ':id' : s)).join('/')}`;
    const id = seg.find((s) => /^\d+$/.test(s));
    const h = this.routes()[route];
    if (!h) throw new HttpError(404, `No route ${route}`);
    const res = await h.call(this, { q, body: body || {}, id: id ? +id : null });
    return JSON.parse(JSON.stringify(res ?? { ok: true }));
  }

  routes() {
    return {
      'GET /bootstrap': this.bootstrap,
      'GET /today': this.today,
      'GET /search': this.search,
      'GET /bookings': this.listBookings,
      'POST /bookings': this.createBooking,
      'GET /bookings/:id': ({ id }) => { const b = this.booking(id); if (!b) throw new HttpError(404, 'Booking not found'); return this.bookingOut(b); },
      'PATCH /bookings/:id': this.updateBooking,
      'POST /bookings/:id/action': this.bookingAction,
      'POST /bookings/:id/remind': this.remindBooking,
      'POST /reminders/tomorrow': this.remindTomorrow,
      'GET /schedule': this.schedule,
      'GET /conversations': this.listConversations,
      'POST /conversations': this.startConversation,
      'GET /conversations/:id': this.getConversation,
      'PATCH /conversations/:id': this.patchConversation,
      'POST /conversations/:id/messages': this.postMessage,
      'POST /conversations/:id/read': this.readConversation,
      'POST /conversations/:id/suggest': ({ id }) => this.suggest(id),
      'GET /inbox/stats': this.inboxStats,
      'GET /contacts': this.listContacts,
      'POST /contacts': this.createContact,
      'GET /contacts/export': this.exportContacts,
      'GET /contacts/:id': ({ id }) => this.contactOut(this.contact(id), true),
      'PATCH /contacts/:id': this.patchContact,
      'GET /templates': () => this.db.templates,
      'POST /templates': this.createTemplate,
      'PATCH /templates/:id': this.patchTemplate,
      'DELETE /templates/:id': this.deleteTemplate,
      'GET /campaigns': this.listCampaigns,
      'POST /campaigns': this.createCampaign,
      'PATCH /campaigns/:id': this.patchCampaign,
      'DELETE /campaigns/:id': ({ id }) => { this.db.campaigns = this.db.campaigns.filter((c) => c.id !== id); this.save(); },
      'POST /campaigns/:id/send': this.sendCampaign,
      'POST /campaigns/:id/duplicate': this.duplicateCampaign,
      'POST /campaigns/:id/cancel': ({ id }) => { const c = this.db.campaigns.find((x) => x.id === id); c.status = 'draft'; c.scheduled_at = null; this.save(); return c; },
      'GET /reports': this.reports,
      'PATCH /settings/workspace': this.patchWorkspace,
      'PATCH /settings/whatsapp': this.patchWhatsapp,
      'POST /settings/whatsapp/test': this.testWhatsapp,
      'POST /settings/whatsapp/disconnect': () => { this.db.whatsapp.connected = false; this.save(); return this.db.whatsapp; },
      'POST /staff': this.createStaff,
      'PATCH /staff/:id': this.patchStaff,
      'POST /services': this.createService,
      'PATCH /services/:id': this.patchService,
      'POST /quick-replies': this.createQuickReply,
      'PATCH /quick-replies/:id': this.patchQuickReply,
      'DELETE /quick-replies/:id': ({ id }) => { this.db.quick_replies = this.db.quick_replies.filter((x) => x.id !== id); this.save(); },
      'POST /demo/reset': () => { this.db = this.fresh(this.tz); this.save(); return { ok: true }; },
      'POST /demo/inbound': ({ body }) => this.inbound(body),
      'POST /demo/clock': ({ body }) => { this.db.clock.mode = body.mode === 'live' ? 'live' : 'demo'; this.save(); return this.db.clock; },
    };
  }

  bootstrap() {
    const me = this.staffById(this.db.me);
    return {
      mode: 'demo',
      now: this.now(),
      clock: this.db.clock.mode,
      workspace: this.db.workspace,
      whatsapp: this.db.whatsapp,
      staff: this.db.staff.map((s) => ({ ...s, initials: initials(s.name) })),
      services: this.db.services,
      templates: this.db.templates,
      quick_replies: this.db.quick_replies,
      me: { ...me, initials: initials(me.name) },
      inbox_unread: this.db.conversations.filter((c) => c.status === 'open' && c.unread > 0).length,
      storage_kb: Math.round((localStorage.getItem(KEY) || '').length / 1024),
    };
  }

  today() {
    const now = this.now();
    const key = dayKey(now, this.tz);
    const [from, to] = this.dayRange(key);
    const todays = this.bookingsBetween(from, to).filter((b) => b.status !== 'cancelled').sort((a, b) => a.start - b.start);
    const expected = todays.filter((b) => ['booked', 'confirmed'].includes(b.status));
    const waiting = todays.filter((b) => b.status === 'arrived').sort((a, b) => a.arrived_at - b.arrived_at);
    const inService = todays.filter((b) => b.status === 'in_service');
    const done = todays.filter((b) => b.status === 'done').sort((a, b) => b.finished_at - a.finished_at);
    const waits = waiting.map((b) => (now - b.arrived_at) / 60000);
    const convs = this.db.conversations.filter((c) => c.status === 'open').map((c) => this.convOut(c));
    convs.sort((a, b) => (b.unread > 0) - (a.unread > 0) || (b.urgent - a.urgent) || (b.last?.created_at || 0) - (a.last?.created_at || 0));
    const busyStaff = new Set(inService.map((b) => b.staff_id));
    const resources = this.db.staff.filter((s) => s.resource && s.active);
    const d30 = now - 30 * 864e5;
    const last30 = this.db.bookings.filter((b) => b.start >= d30 && b.start < now && ['done', 'no_show'].includes(b.status));
    const before = this.db.bookings.filter((b) => b.start < this.db.workspace.reminders.started_at && ['done', 'no_show'].includes(b.status));
    const rate = (arr) => (arr.length ? arr.filter((b) => b.status === 'no_show').length / arr.length : 0);
    const tomorrowKey = addDaysKey(key, 1);
    const [tf, tt] = this.dayRange(tomorrowKey);
    const tomorrowUnreminded = this.bookingsBetween(tf, tt).filter((b) => ['booked', 'confirmed'].includes(b.status) && b.reminder === 'none' && this.contact(b.contact_id).opt_in === 'opted_in');
    const replies = this.replyTimes(now - 7 * 864e5);
    return {
      now,
      stats: {
        appointments_today: todays.length,
        seen: done.length,
        waiting: waiting.length,
        avg_wait_min: Math.round(waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0),
        unread_whatsapp: this.db.conversations.filter((c) => c.status === 'open' && c.unread > 0).length,
        median_reply_min: Math.round(median(replies)),
        no_show_30d: rate(last30),
        no_show_before: rate(before),
      },
      flow: {
        expected: expected.map((b) => this.bookingOut(b)),
        waiting: waiting.map((b) => this.bookingOut(b)),
        in_service: inService.map((b) => this.bookingOut(b)),
        done: done.map((b) => this.bookingOut(b)),
      },
      resources_free: resources.filter((s) => !busyStaff.has(s.id)).length,
      whatsapp: convs.slice(0, 7),
      waiting_on_us: convs.filter((c) => c.waiting_since).length,
      tomorrow_unreminded: tomorrowUnreminded.length,
    };
  }

  search({ q }) {
    const s = (q.q || '').toLowerCase().trim();
    if (!s) return { contacts: [], conversations: [] };
    const digits = s.replace(/\D/g, '');
    const contacts = this.db.contacts.filter((c) => c.name.toLowerCase().includes(s) || (digits.length > 2 && c.phone.replace(/\D/g, '').includes(digits)) || (c.email || '').toLowerCase().includes(s)).slice(0, 6).map((c) => ({ id: c.id, name: c.name, phone: c.phone, initials: initials(c.name), tags: c.tags }));
    const msgs = this.db.messages.filter((m) => (m.body || '').toLowerCase().includes(s)).slice(-6).reverse();
    const conversations = msgs.map((m) => ({ id: m.conversation_id, contact: this.contact(this.conv(m.conversation_id).contact_id).name, body: m.body, created_at: m.created_at }));
    return { contacts, conversations };
  }

  listBookings({ q }) {
    const from = q.from ? this.dayRange(q.from)[0] : this.now() - 864e5;
    const to = q.to ? this.dayRange(q.to)[1] : this.now() + 7 * 864e5;
    let bs = this.bookingsBetween(from, to);
    if (q.contact_id) bs = bs.filter((b) => b.contact_id === +q.contact_id);
    return bs.sort((a, b) => a.start - b.start).map((b) => this.bookingOut(b));
  }

  createBooking({ body }) {
    let contactId = body.contact_id;
    if (!contactId && body.contact) contactId = this.createContact({ body: body.contact }).id;
    if (!contactId) throw new HttpError(400, 'Choose a contact.');
    const sv = this.service(body.service_id);
    if (!sv) throw new HttpError(400, 'Choose a service.');
    const start = +body.start;
    const end = start + sv.minutes * 60000;
    const clash = this.db.bookings.find((b) => b.staff_id === +body.staff_id && !['cancelled', 'no_show'].includes(b.status) && b.start < end && b.end > start);
    if (clash) throw new HttpError(409, `${this.staffById(body.staff_id).name} already has ${this.contact(clash.contact_id).name} at ${fmtTime(clash.start, this.tz)}.`);
    const b = {
      id: this.next('booking'), contact_id: +contactId, staff_id: +body.staff_id, service_id: sv.id, start, end,
      status: 'booked', source: body.source || 'phone', arrived_at: null, started_at: null, finished_at: null,
      reminder: 'none', reminder_at: null, note: body.note || '', created_at: this.now(),
    };
    this.db.bookings.push(b);
    if (body.send_confirmation) {
      const contact = this.contact(b.contact_id);
      if (contact.opt_in === 'opted_in') {
        const tpl = this.template('booking_confirmation');
        const conv = this.ensureConversation(contact.id);
        const whenText = whenPhrase(fmtRelDay(start, this.tz, this.now()), fmtTime(start, this.tz));
        this.sendTemplate(conv, tpl, templateValues(tpl, { contact, serviceName: sv.name, staffName: this.staffById(b.staff_id).name, whenText, business: this.db.workspace }), 'system', 'Auto');
      }
    }
    this.save();
    return this.bookingOut(b);
  }

  updateBooking({ id, body }) {
    const b = this.booking(id);
    if (!b) throw new HttpError(404, 'Booking not found');
    if (body.start) {
      const sv = this.service(body.service_id || b.service_id);
      b.start = +body.start;
      b.end = b.start + sv.minutes * 60000;
      b.reminder = 'none';
    }
    for (const k of ['staff_id', 'service_id', 'note', 'status']) if (k in body) b[k] = body[k];
    this.save();
    return this.bookingOut(b);
  }

  bookingAction({ id, body }) {
    const b = this.booking(id);
    const now = this.now();
    const a = body.action;
    if (a === 'check_in') { b.status = 'arrived'; b.arrived_at = now; }
    else if (a === 'start') {
      b.status = 'in_service'; b.started_at = now; b.arrived_at = b.arrived_at || now;
    } else if (a === 'finish') { b.status = 'done'; b.finished_at = now; }
    else if (a === 'no_show') b.status = 'no_show';
    else if (a === 'cancel') b.status = 'cancelled';
    else if (a === 'undo') {
      if (b.status === 'done') { b.status = 'in_service'; b.finished_at = null; }
      else if (b.status === 'in_service') { b.status = 'arrived'; b.started_at = null; }
      else if (b.status === 'arrived') { b.status = b.reminder === 'confirmed' ? 'confirmed' : 'booked'; b.arrived_at = null; }
      else if (['no_show', 'cancelled'].includes(b.status)) b.status = 'booked';
    } else throw new HttpError(400, 'Unknown action');
    this.save();
    return this.bookingOut(b);
  }

  remindBooking({ id }) {
    const b = this.booking(id);
    if (!this.sendReminder(b)) throw new HttpError(400, 'This contact has not opted in to WhatsApp.');
    this.save();
    return this.bookingOut(b);
  }

  remindTomorrow() {
    const key = addDaysKey(dayKey(this.now(), this.tz), 1);
    const [f, t] = this.dayRange(key);
    let sent = 0, skipped = 0;
    for (const b of this.bookingsBetween(f, t)) {
      if (!['booked', 'confirmed'].includes(b.status) || b.reminder !== 'none') continue;
      if (this.sendReminder(b)) sent++; else skipped++;
    }
    this.save();
    return { sent, skipped };
  }

  schedule({ q }) {
    const now = this.now();
    const todayKey = dayKey(now, this.tz);
    const date = q.date || todayKey;
    const view = q.view === 'week' ? 'week' : 'day';
    let days = [date];
    if (view === 'week') {
      const wd = weekdayOfKey(date);
      const monday = addDaysKey(date, -((wd + 6) % 7));
      days = Array.from({ length: 7 }, (_, i) => addDaysKey(monday, i));
    }
    const [from] = this.dayRange(days[0]);
    const [, to] = this.dayRange(days[days.length - 1]);
    const bs = this.bookingsBetween(from, to).filter((b) => q.cancelled === '1' || b.status !== 'cancelled');
    const util = {};
    for (const s of this.db.staff.filter((x) => !x.is_agent)) {
      const mins = bs.filter((b) => b.staff_id === s.id && b.status !== 'cancelled').reduce((a, b) => a + (b.end - b.start) / 60000, 0);
      const cap = days.reduce((a, k) => a + this.capacityMinutes(k) / this.db.staff.filter((x) => !x.is_agent && x.active).length, 0);
      util[s.id] = cap ? Math.min(1, mins / cap) : 0;
    }
    const [tf, tt] = this.dayRange(todayKey);
    const todayBs = this.bookingsBetween(tf, tt).filter((b) => b.status !== 'cancelled');
    const bookedMin = todayBs.reduce((a, b) => a + (b.end - b.start) / 60000, 0);
    const cap = this.capacityMinutes(todayKey);
    const [mf, mt] = this.dayRange(addDaysKey(todayKey, 1));
    const tomorrow = this.bookingsBetween(mf, mt).filter((b) => b.status !== 'cancelled');
    const slot = this.db.workspace.slot_minutes;
    const hrs = this.db.workspace.hours[DAYS[weekdayOfKey(todayKey)]];
    const remainingCap = hrs ? Math.max(0, (hrs[1] - Math.max(hrs[0], minutesOfDay(now, this.tz)))) * this.db.staff.filter((x) => !x.is_agent && x.active).length : 0;
    const remainingBooked = todayBs.filter((b) => b.end > now).reduce((a, b) => a + (b.end - Math.max(b.start, now)) / 60000, 0);
    return {
      date, view, days, today: todayKey,
      stats: {
        appointments_today: todayBs.length,
        booked_capacity: cap ? bookedMin / cap : 0,
        open_slots: Math.max(0, Math.round((remainingCap - remainingBooked) / (slot * 3))),
        confirmed_tomorrow: tomorrow.filter((b) => b.status === 'confirmed').length,
        tomorrow_total: tomorrow.length,
      },
      utilization: util,
      bookings: bs.sort((a, b) => a.start - b.start).map((b) => this.bookingOut(b)),
      tomorrow_unreminded: tomorrow.filter((b) => b.reminder === 'none' && ['booked', 'confirmed'].includes(b.status) && this.contact(b.contact_id).opt_in === 'opted_in').length,
    };
  }

  listConversations({ q }) {
    const all = this.db.conversations;
    const f = q.filter || 'all';
    const me = this.db.me;
    let list = all.filter((c) => (f === 'resolved' ? c.status === 'resolved' : c.status === 'open'));
    if (f === 'unread') list = list.filter((c) => c.unread > 0);
    if (f === 'mine') list = list.filter((c) => c.assignee_id === me);
    if (f === 'unassigned') list = list.filter((c) => !c.assignee_id);
    if (q.label) list = list.filter((c) => c.labels.includes(q.label));
    if (q.q) {
      const s = q.q.toLowerCase();
      list = list.filter((c) => {
        const ct = this.contact(c.contact_id);
        return ct.name.toLowerCase().includes(s) || ct.phone.replace(/\D/g, '').includes(s.replace(/\D/g, '') || '§') || this.db.messages.some((m) => m.conversation_id === c.id && (m.body || '').toLowerCase().includes(s));
      });
    }
    const items = list.map((c) => this.convOut(c)).sort((a, b) => (b.pinned - a.pinned) || (b.last?.created_at || 0) - (a.last?.created_at || 0));
    const open = all.filter((c) => c.status === 'open');
    return {
      items,
      counts: {
        all: open.length,
        unread: open.filter((c) => c.unread > 0).length,
        mine: open.filter((c) => c.assignee_id === me).length,
        unassigned: open.filter((c) => !c.assignee_id).length,
        resolved: all.filter((c) => c.status === 'resolved').length,
      },
    };
  }

  startConversation({ body }) {
    const c = this.ensureConversation(body.contact_id, this.db.me);
    this.save();
    return this.convOut(c);
  }

  getConversation({ id }) {
    const c = this.conv(id);
    if (!c) throw new HttpError(404, 'Conversation not found');
    const contact = this.contact(c.contact_id);
    return {
      ...this.convOut(c),
      messages: this.db.messages.filter((m) => m.conversation_id === c.id),
      contact: this.contactOut(contact, true),
    };
  }

  patchConversation({ id, body }) {
    const c = this.conv(id);
    for (const k of ['status', 'assignee_id', 'labels', 'pinned', 'ai_mode', 'urgent']) if (k in body) c[k] = body[k];
    if (body.status === 'resolved') {
      c.unread = 0;
      this.pushMessage(c, { kind: 'event', author: 'event', body: `Resolved by ${this.staffById(this.db.me).name}` });
    }
    if ('assignee_id' in body && body.assignee_id) {
      this.pushMessage(c, { kind: 'event', author: 'event', body: `Assigned to ${this.staffById(body.assignee_id).name}` });
    }
    this.save();
    return this.convOut(c);
  }

  postMessage({ id, body }) {
    const c = this.conv(id);
    const me = this.staffById(this.db.me);
    let m;
    if (body.note) {
      m = this.pushMessage(c, { kind: 'note', author: 'agent', author_name: me.name, body: body.body, status: null });
    } else if (body.template_id) {
      const tpl = this.template(body.template_id);
      const contact = this.contact(c.contact_id);
      const st = this.contactStats(contact);
      const values = body.values || templateValues(tpl, {
        contact,
        booking: st.next_booking,
        whenText: st.next_booking ? whenPhrase(fmtRelDay(st.next_booking.start, this.tz, this.now()), fmtTime(st.next_booking.start, this.tz)) : '',
        business: this.db.workspace,
        lastStaff: st.last_visit?.staff,
      });
      m = this.sendTemplate(c, tpl, values, 'agent', me.name);
    } else {
      if (!windowOpen(c.last_inbound_at, this.now())) {
        throw new HttpError(400, 'The 24-hour window is closed. Send an approved template to reopen the chat.');
      }
      if (!(body.body || '').trim()) throw new HttpError(400, 'Message is empty.');
      m = this.pushMessage(c, { body: body.body.trim(), author: 'agent', author_name: me.name });
      if (c.ai_mode === 'auto') c.ai_mode = 'assist';
    }
    c.unread = 0;
    if (!c.assignee_id) c.assignee_id = me.id;
    this.save();
    return m;
  }

  readConversation({ id }) {
    const c = this.conv(id);
    c.unread = 0;
    this.save();
    return this.convOut(c);
  }

  inboxStats() {
    const now = this.now();
    const open = this.db.conversations.filter((c) => c.status === 'open').map((c) => this.convOut(c));
    const waiting = open.filter((c) => c.waiting_since).sort((a, b) => a.waiting_since - b.waiting_since);
    return {
      unread: open.filter((c) => c.unread > 0).length,
      waiting: waiting.length,
      median_reply_min: Math.round(median(this.replyTimes(now - 7 * 864e5))),
      open: open.length,
      waiting_list: waiting.map((c) => ({ id: c.id, name: c.contact.name, initials: c.contact.initials, since: c.waiting_since, urgent: c.urgent })),
      window_closed: open.filter((c) => !c.window_open).length,
    };
  }

  listContacts({ q }) {
    let list = this.db.contacts.map((c) => this.contactOut(c));
    const all = list;
    if (q.q) {
      const s = q.q.toLowerCase();
      const d = s.replace(/\D/g, '');
      list = list.filter((c) => c.name.toLowerCase().includes(s) || (c.email || '').toLowerCase().includes(s) || (d.length > 2 && c.phone.replace(/\D/g, '').includes(d)));
    }
    if (q.opt_in && q.opt_in !== 'all') list = list.filter((c) => c.opt_in === q.opt_in);
    if (q.tag && q.tag !== 'all') list = list.filter((c) => (q.tag === 'Recall due' ? this.recallDue(c, c) : c.tags.includes(q.tag)));
    if (q.owner_id) list = list.filter((c) => c.owner_id === +q.owner_id);
    const sort = q.sort || 'name';
    const dir = q.dir === 'desc' ? -1 : 1;
    const val = (c) => (sort === 'last_visit' ? c.last_visit?.start || 0 : sort === 'next' ? c.next_booking?.start || Infinity : sort === 'visits' ? c.visits : sort === 'created' ? c.created_at : c.name.split(' ').reverse().join(' ').toLowerCase());
    list.sort((a, b) => (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0));
    const page = +(q.page || 1);
    const size = +(q.page_size || 25);
    const now = this.now();
    const monthStart = (() => { const p = partsInTz(now, this.tz); return zonedToUtc(p.y, p.m, 1, 0, 0, this.tz); })();
    const tagCounts = {};
    for (const c of all) for (const t of c.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
    tagCounts['Recall due'] = all.filter((c) => this.recallDue(c, c)).length;
    return {
      items: list.slice((page - 1) * size, page * size),
      total: list.length,
      page, page_size: size,
      stats: {
        total: all.length,
        new_this_month: all.filter((c) => c.created_at >= monthStart).length,
        opt_in_rate: all.filter((c) => c.opt_in === 'opted_in').length / all.length,
        recall_due: tagCounts['Recall due'],
      },
      tag_counts: tagCounts,
      opt_counts: {
        opted_in: all.filter((c) => c.opt_in === 'opted_in').length,
        pending: all.filter((c) => c.opt_in === 'pending').length,
        opted_out: all.filter((c) => c.opt_in === 'opted_out').length,
      },
    };
  }

  createContact({ body }) {
    if (!body.name || !body.phone) throw new HttpError(400, 'Name and phone are required.');
    const digits = body.phone.replace(/\D/g, '');
    if (this.db.contacts.some((c) => c.phone.replace(/\D/g, '') === digits)) throw new HttpError(409, 'A contact with this phone number already exists.');
    const c = {
      id: this.next('contact'), name: body.name.trim(), phone: body.phone.trim(), email: body.email || '', gender: body.gender || '',
      tags: body.tags || ['New'], opt_in: body.opt_in || 'pending', opt_in_at: body.opt_in === 'opted_in' ? this.now() : null,
      owner_id: body.owner_id || null, source: body.source || 'walk_in', language: 'English', notes: body.notes || '', alerts: [], created_at: this.now(),
    };
    this.db.contacts.push(c);
    this.save();
    return this.contactOut(c);
  }

  patchContact({ id, body }) {
    const c = this.contact(id);
    for (const k of ['name', 'phone', 'email', 'tags', 'opt_in', 'owner_id', 'notes', 'alerts', 'language', 'gender']) if (k in body) c[k] = body[k];
    if (body.opt_in === 'opted_in' && !c.opt_in_at) c.opt_in_at = this.now();
    this.save();
    return this.contactOut(c, true);
  }

  exportContacts() {
    const rows = [['Name', 'Phone', 'Email', 'Tags', 'WhatsApp', 'Owner', 'Visits', 'Last visit', 'Created']];
    for (const c of this.db.contacts) {
      const o = this.contactOut(c);
      rows.push([c.name, c.phone, c.email, c.tags.join('; '), c.opt_in, o.owner?.name || '', o.visits, o.last_visit ? dayKey(o.last_visit.start, this.tz) : '', dayKey(c.created_at, this.tz)]);
    }
    return { filename: 'contacts.csv', csv: rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n') };
  }

  createTemplate({ body }) {
    if (!/^[a-z0-9_]+$/.test(body.name || '')) throw new HttpError(400, 'Template names use lowercase letters, numbers and underscores.');
    const t = { id: this.next('template'), status: 'pending', language: 'en', category: 'utility', header: null, footer: null, buttons: [], variables: [], ...body };
    this.db.templates.push(t);
    // demo: Meta "approves" after a few seconds
    setTimeout(() => { t.status = 'approved'; this.save(); }, 6000);
    this.save();
    return t;
  }

  patchTemplate({ id, body }) {
    const t = this.template(id);
    Object.assign(t, body, { status: body.body && body.body !== t.body ? 'pending' : t.status });
    if (t.status === 'pending') setTimeout(() => { t.status = 'approved'; this.save(); }, 6000);
    this.save();
    return t;
  }

  deleteTemplate({ id }) {
    if (this.db.campaigns.some((c) => c.template_id === id && c.status !== 'sent')) throw new HttpError(400, 'This template is used by a campaign.');
    this.db.templates = this.db.templates.filter((t) => t.id !== id);
    this.save();
  }

  audience(c) {
    const all = this.db.contacts;
    let pool = all;
    if (c.audience?.type === 'tag') pool = all.filter((x) => (c.audience.value === 'Recall due' ? this.recallDue(x) : x.tags.includes(c.audience.value)));
    const ok = pool.filter((x) => x.opt_in === 'opted_in');
    return { pool, ok, excluded: pool.length - ok.length, opted_out: pool.filter((x) => x.opt_in === 'opted_out').length, pending: pool.filter((x) => x.opt_in === 'pending').length };
  }

  campaignOut(c) {
    const a = this.audience(c);
    const tpl = this.template(c.template_id);
    const sample = a.ok[0] || this.db.contacts[0];
    const sampleValues = tpl ? templateValues(tpl, { contact: sample, business: this.db.workspace, lastStaff: 'Aarav' }) : [];
    return {
      ...c,
      template: tpl,
      preview: tpl ? { header: renderTemplate(tpl.header, sampleValues, { business_name: this.db.workspace.name }), body: renderTemplate(tpl.body, sampleValues, { business_name: this.db.workspace.name }), buttons: tpl.buttons, sample_name: firstName(sample.name) } : null,
      audience_count: c.stats ? c.stats.recipients : a.ok.length,
      excluded: c.stats ? c.stats.excluded : a.excluded,
      excluded_detail: { opted_out: a.opted_out, pending: a.pending },
    };
  }

  listCampaigns() {
    const items = this.db.campaigns.slice().sort((a, b) => ({ scheduled: 0, draft: 1, sending: 0, sent: 2 }[a.status] - { scheduled: 0, draft: 1, sending: 0, sent: 2 }[b.status]) || b.created_at - a.created_at).map((c) => this.campaignOut(c));
    const sent = this.db.campaigns.filter((c) => c.stats);
    const sum = (k) => sent.reduce((a, c) => a + c.stats[k], 0);
    const reminderMsgs = this.db.bookings.filter((b) => b.reminder !== 'none').length;
    const totalSent = sum('sent') + reminderMsgs;
    return {
      items,
      stats: {
        messages_sent: totalSent,
        read_rate: sum('delivered') ? sum('read') / sum('delivered') : 0,
        reply_rate: sum('delivered') ? sum('replied') / sum('delivered') : 0,
        bookings: sum('booked'),
      },
      audiences: ['all', ...Object.keys(this.listContacts({ q: { page_size: 1 } }).tag_counts)],
    };
  }

  createCampaign({ body }) {
    const c = { id: this.next('campaign'), name: body.name || 'Untitled broadcast', template_id: +body.template_id, audience: body.audience || { type: 'all' }, status: body.scheduled_at ? 'scheduled' : 'draft', scheduled_at: body.scheduled_at || null, sent_at: null, stats: null, created_at: this.now() };
    if (!this.template(c.template_id)) throw new HttpError(400, 'Pick a template.');
    this.db.campaigns.push(c);
    this.save();
    return this.campaignOut(c);
  }

  patchCampaign({ id, body }) {
    const c = this.db.campaigns.find((x) => x.id === id);
    for (const k of ['name', 'template_id', 'audience', 'scheduled_at']) if (k in body) c[k] = body[k];
    if ('scheduled_at' in body) c.status = body.scheduled_at ? 'scheduled' : 'draft';
    this.save();
    return this.campaignOut(c);
  }

  sendCampaign({ id }) {
    const c = this.db.campaigns.find((x) => x.id === id);
    const tpl = this.template(c.template_id);
    if (tpl.status !== 'approved') throw new HttpError(400, 'Template is still waiting for approval from Meta.');
    const a = this.audience(c);
    for (const contact of a.ok.slice(0, 40)) {
      // Only materialise chats for the first 40 so the demo stays light
      const conv = this.ensureConversation(contact.id);
      this.sendTemplate(conv, tpl, templateValues(tpl, { contact, business: this.db.workspace, lastStaff: this.contactStats(contact).last_visit?.staff?.split(' ')[0] }), 'system', 'Campaign');
    }
    const n = a.ok.length;
    c.status = 'sent';
    c.sent_at = this.now();
    c.stats = { recipients: n, excluded: a.excluded, sent: n, delivered: Math.round(n * 0.98), read: Math.round(n * 0.86), replied: Math.round(n * 0.22), booked: Math.round(n * 0.09), failed: n - Math.round(n * 0.98) };
    this.save();
    return this.campaignOut(c);
  }

  duplicateCampaign({ id }) {
    const c = this.db.campaigns.find((x) => x.id === id);
    return this.createCampaign({ body: { name: `${c.name} (copy)`, template_id: c.template_id, audience: c.audience } });
  }

  reports({ q }) {
    const weeks = +(q.weeks || 12);
    const now = this.now();
    const todayKey = dayKey(now, this.tz);
    const wd = weekdayOfKey(todayKey);
    const thisMonday = addDaysKey(todayKey, -((wd + 6) % 7));
    const weekKeys = Array.from({ length: weeks }, (_, i) => addDaysKey(thisMonday, -7 * (weeks - 1 - i)));
    const from = this.dayRange(weekKeys[0])[0];
    const bs = this.db.bookings.filter((b) => b.start >= from && b.start < now);
    const settled = bs.filter((b) => ['done', 'no_show'].includes(b.status));
    const rate = (arr) => (arr.length ? arr.filter((b) => b.status === 'no_show').length / arr.length : 0);
    const remStart = this.db.workspace.reminders.started_at;
    const weekly = weekKeys.map((k) => {
      const [f] = this.dayRange(k);
      const t = this.dayRange(addDaysKey(k, 6))[1];
      const all = this.db.bookings.filter((b) => b.start >= f && b.start < t && b.status !== 'cancelled');
      const past = all.filter((b) => b.start < now);
      return {
        week: k,
        done: past.filter((b) => b.status === 'done').length,
        booked: all.length,
        no_show_rate: rate(past.filter((b) => ['done', 'no_show'].includes(b.status))),
        partial: k === thisMonday,
      };
    });
    const before = this.db.bookings.filter((b) => b.start < remStart && ['done', 'no_show'].includes(b.status));
    const after = this.db.bookings.filter((b) => b.start >= remStart && b.start < now && ['done', 'no_show'].includes(b.status));
    const rems = this.db.bookings.filter((b) => b.reminder !== 'none' && b.reminder_at >= from);
    const cnt = (f) => rems.filter(f).length;
    const funnel = {
      sent: rems.length,
      delivered: cnt((b) => b.reminder !== 'failed' && b.reminder !== 'sent'),
      read: cnt((b) => ['read', 'confirmed', 'reschedule'].includes(b.reminder)),
      confirmed: cnt((b) => b.reminder === 'confirmed'),
      reschedule: cnt((b) => b.reminder === 'reschedule'),
      failed: cnt((b) => b.reminder === 'failed'),
    };
    const done = bs.filter((b) => b.status === 'done');
    const mix = this.db.services.map((s) => ({ id: s.id, name: s.name, color: s.color, count: done.filter((b) => b.service_id === s.id).length })).sort((a, b) => b.count - a.count);
    // heatmap Mon..Sat x opening hours
    const hoursSet = [];
    for (let h = 9; h < 19; h++) hoursSet.push(h);
    const daysLbl = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const cells = daysLbl.map(() => hoursSet.map(() => 0));
    for (const b of bs.filter((x) => x.status !== 'cancelled')) {
      const p = partsInTz(b.start, this.tz);
      const di = (p.wd + 6) % 7;
      const hi = p.hh - 9;
      if (di < 6 && hi >= 0 && hi < hoursSet.length) cells[di][hi]++;
    }
    let max = 0, busiest = null;
    cells.forEach((row, di) => row.forEach((v, hi) => { if (v > max) { max = v; busiest = { day: daysLbl[di], hour: hoursSet[hi], count: v }; } }));
    const closed = daysLbl.map((d, di) => hoursSet.map((h) => {
      const hrs = this.db.workspace.hours[DAYS[(di + 1) % 7]];
      const lunch = this.db.workspace.lunch;
      return !hrs || h * 60 < hrs[0] || h * 60 >= hrs[1] || (lunch && h * 60 >= lunch[0] && h * 60 < lunch[1]);
    }));
    const srcs = ['whatsapp', 'phone', 'website', 'walk_in'].map((s) => ({ source: s, count: bs.filter((b) => b.source === s && b.status !== 'cancelled').length }));
    const staffRows = this.db.staff.filter((s) => !s.is_agent).map((s) => {
      const mine = bs.filter((b) => b.staff_id === s.id);
      const mins = mine.filter((b) => b.status !== 'cancelled').reduce((a, b) => a + (b.end - b.start) / 60000, 0);
      const daysCount = weekKeys.reduce((a, k) => a + Array.from({ length: 7 }, (_, i) => addDaysKey(k, i)).filter((d) => d <= todayKey && this.db.workspace.hours[DAYS[weekdayOfKey(d)]]).length, 0);
      const perDay = this.capacityMinutes(todayKey) / this.db.staff.filter((x) => !x.is_agent && x.active).length || 540;
      const delays = mine.filter((b) => b.started_at).map((b) => Math.max(0, (b.started_at - b.start) / 60000));
      return {
        staff: this.staffBrief(s),
        visits: mine.filter((b) => b.status === 'done').length,
        capacity: Math.min(1, mins / (daysCount * perDay || 1)),
        no_show_rate: rate(mine.filter((b) => ['done', 'no_show'].includes(b.status))),
        avg_start_delay: Math.round(delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0),
      };
    }).sort((a, b) => b.visits - a.visits);
    const convs = this.db.conversations;
    const labelCounts = this.db.workspace.labels.map((l) => ({ ...l, count: convs.filter((c) => c.labels.includes(l.name)).length }));
    const replies = this.replyTimes(from);
    const allBooked = bs.filter((b) => b.status !== 'cancelled').length;
    return {
      weeks, from: weekKeys[0], to: todayKey,
      stats: {
        visits: done.length,
        no_show_rate: rate(settled),
        no_show_delta: rate(settled) - rate(before),
        median_reply_min: Math.round(median(replies)),
        reminders_confirmed: funnel.sent ? funnel.confirmed / funnel.sent : 0,
      },
      no_show: { weekly: weekly.map((w) => ({ week: w.week, rate: w.no_show_rate })), reminders_started: remStart, before: rate(before), after: rate(after) },
      funnel,
      visits_weekly: weekly.map((w) => ({ week: w.week, done: w.done, booked: w.booked, partial: w.partial })),
      visits_booked_total: allBooked,
      service_mix: mix,
      heatmap: { days: daysLbl, hours: hoursSet, cells, closed, max, busiest },
      sources: srcs,
      staff: staffRows,
      inbox: {
        median_reply_min: Math.round(median(replies)),
        open: convs.filter((c) => c.status === 'open').length,
        waiting: convs.filter((c) => c.status === 'open' && this.waitingSince(c.id)).length,
        resolved: convs.filter((c) => c.status === 'resolved').length,
        labels: labelCounts,
        ai_handled: this.db.messages.filter((m) => m.author === 'ai').length,
      },
    };
  }

  patchWorkspace({ body }) {
    const w = this.db.workspace;
    for (const [k, v] of Object.entries(body)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && w[k] && typeof w[k] === 'object' && !Array.isArray(w[k])) w[k] = { ...w[k], ...v };
      else w[k] = v;
    }
    this.save();
    return w;
  }

  patchWhatsapp({ body }) {
    const wa = this.db.whatsapp;
    if (body.access_token) { wa.access_token_set = true; }
    if (body.app_secret) { wa.app_secret_set = true; }
    for (const k of ['phone_number_id', 'waba_id', 'verify_token', 'display_phone', 'verified_name']) if (k in body) wa[k] = body[k];
    wa.connected = true;
    this.save();
    return wa;
  }

  testWhatsapp({ body }) {
    if (!body.to) throw new HttpError(400, 'Enter a phone number to send a test to.');
    return { ok: true, demo: true, message: `Demo mode: a test message would be sent to ${body.to} via phone number ID ${this.db.whatsapp.phone_number_id}.` };
  }

  createStaff({ body }) {
    const s = { id: this.next('staff'), name: body.name, role: body.role || '', resource: body.resource || null, color: body.color || 'slate', email: body.email || '', is_agent: !!body.is_agent, active: true };
    this.db.staff.push(s);
    this.save();
    return s;
  }

  patchStaff({ id, body }) {
    const s = this.staffById(id);
    Object.assign(s, body);
    this.save();
    return s;
  }

  createService({ body }) {
    const s = { id: this.next('service'), name: body.name, minutes: +body.minutes || 30, price: +body.price || 0, color: body.color || 'teal', staff: body.staff || [] };
    this.db.services.push(s);
    this.save();
    return s;
  }

  patchService({ id, body }) {
    const s = this.service(id);
    Object.assign(s, body);
    this.save();
    return s;
  }

  createQuickReply({ body }) {
    const r = { id: this.next('quick_reply'), title: body.title, body: body.body };
    this.db.quick_replies.push(r);
    this.save();
    return r;
  }

  patchQuickReply({ id, body }) {
    const r = this.db.quick_replies.find((x) => x.id === id);
    Object.assign(r, body);
    this.save();
    return r;
  }
}
