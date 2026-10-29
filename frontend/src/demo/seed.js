// Deterministic demo dataset. Used by the in-browser demo server and exported
// to backend/crm/fixtures/demo_seed.json for `python manage.py seed_demo`.
import { zonedToUtc, dayKey, addDaysKey, parseDayKey, weekdayOfKey, minutesOfDay, daysBetweenKeys } from '../lib/time.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_F = ['Aanya', 'Kavya', 'Priyanka', 'Fatima', 'Neha', 'Lakshmi', 'Sneha', 'Isha', 'Riya', 'Pooja', 'Divya', 'Anjali', 'Meghna', 'Tara', 'Zara', 'Emily', 'Sophie', 'Olivia', 'Grace', 'Hannah', 'Leila', 'Nadia', 'Sana', 'Aisha', 'Mira', 'Jasmine', 'Ritika', 'Shreya', 'Kiara', 'Nisha'];
const FIRST_M = ['Rahul', 'Arjun', 'Vikram', 'Imran', 'Karan', 'Rohit', 'Aditya', 'Siddharth', 'Nikhil', 'Varun', 'Kabir', 'Dev', 'Ishaan', 'Yusuf', 'Daniel', 'Oliver', 'Samuel', 'Leo', 'Ethan', 'Noah', 'Omar', 'Ravi', 'Manish', 'Harsh', 'Tanmay'];
const LAST = ['Sharma', 'Verma', 'Kapoor', 'Gupta', 'Iyer', 'Menon', 'Nair', 'Reddy', 'Sheikh', 'Qureshi', 'Singh', 'Mehta', 'Bose', 'Das', 'Pillai', 'Joshi', 'Khanna', 'Malhotra', 'Rao', 'Chopra', 'Brooks', 'Carter', 'Martin', 'Bennett', 'Fernandes', "D'Souza", 'Patel', 'Shah', 'Kulkarni', 'Banerjee'];
const TAGS = ['New', 'VIP', 'Regular', 'Lapsed', 'Bridal', 'Membership', 'Needs follow-up'];

export function buildSeed(now = Date.now(), tz = 'Asia/Kolkata') {
  const r = rng(20261029);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const chance = (p) => r() < p;
  const between = (a, b) => a + Math.floor(r() * (b - a + 1));
  const today = dayKey(now, tz);
  const nowMin = minutesOfDay(now, tz);
  const at = (key, min) => {
    const { y, m, d } = parseDayKey(key);
    return zonedToUtc(y, m, d, Math.floor(min / 60), min % 60, tz);
  };
  const ago = (min) => now - min * 60000;

  const workspace = {
    id: 1,
    name: 'Glow & Co. Studio',
    tagline: 'Hair · Skin · Wellness',
    industry: 'Salon & wellness',
    phone: '+91 98200 41420',
    email: 'hello@glowandco.in',
    address: '12 Carter Road, Bandra West, Mumbai',
    timezone: tz,
    slot_minutes: 15,
    hours: {
      mon: [540, 1140], tue: [540, 1140], wed: [540, 1140], thu: [540, 1140],
      fri: [540, 1140], sat: [540, 1020], sun: null,
    },
    lunch: [780, 840],
    labels: [
      { name: 'Booking', color: 'teal' },
      { name: 'Question', color: 'violet' },
      { name: 'Pricing', color: 'blue' },
      { name: 'Complaint', color: 'amber' },
      { name: 'Urgent', color: 'red' },
      { name: 'Needs human', color: 'rose' },
    ],
    reminders: { enabled: true, hours_before: 24, send_at: '18:00', template: 'booking_reminder', started_at: at(addDaysKey(today, -49), 540) },
    auto_replies: {
      greeting_enabled: true,
      greeting_message: "Hi! 👋 Thanks for messaging Glow & Co. A teammate will reply shortly. You can also book anytime at glowandco.in/book",
      away_enabled: true,
      away_message: "We're closed right now — we open again at 9 AM. Leave your message and we'll get back to you first thing.",
      keywords: [
        { id: 1, keyword: 'price', reply_id: 5, enabled: true },
        { id: 2, keyword: 'parking', reply_id: 1, enabled: true },
      ],
    },
    ai: {
      enabled: true,
      mode: 'assist', // assist = suggest only, auto = reply automatically when confident
      instructions: 'Be warm and brief. Never quote prices that are not in the services list. Hand over to a human for complaints, reactions, refunds or bridal packages.',
      handoff_keywords: ['human', 'manager', 'person', 'call me', 'complaint', 'refund'],
    },
    privacy: { hide_notes_in_whatsapp: true, retention_days: 730, require_opt_in: true },
    appearance: { theme: 'light', density: 'comfortable' },
    demo: { clock: 'demo', created_at: now },
  };

  const whatsapp = {
    connected: true,
    demo_mode: true,
    verified_name: 'Glow & Co. Studio',
    display_phone: '+91 98200 41420',
    quality: 'high',
    messaging_limit: '10K',
    waba_id: '104322198876552',
    phone_number_id: '213908476651120',
    access_token_set: false,
    verify_token: 'xcrm_9ihpv0pu',
    app_secret_set: false,
    webhook_url: '/api/webhooks/whatsapp/',
    subscribed_fields: ['messages', 'message_status', 'message_template_status_update'],
  };

  const staff = [
    { id: 1, name: 'Aarav Mehta', role: 'Senior stylist', resource: 'Chair 1', color: 'teal', email: 'aarav@glowandco.in', is_agent: false, active: true },
    { id: 2, name: 'Priya Nair', role: 'Colour specialist', resource: 'Chair 2', color: 'blue', email: 'priya@glowandco.in', is_agent: false, active: true },
    { id: 3, name: 'Rohan Das', role: 'Massage therapist', resource: 'Room A', color: 'violet', email: 'rohan@glowandco.in', is_agent: false, active: true },
    { id: 4, name: 'Sara Khan', role: 'Skin specialist', resource: 'Room B', color: 'amber', email: 'sara@glowandco.in', is_agent: false, active: true },
    { id: 5, name: 'Meera Iyer', role: 'Nail artist', resource: 'Station 1', color: 'rose', email: 'meera@glowandco.in', is_agent: false, active: true },
    { id: 6, name: 'Ananya Rao', role: 'Front desk lead', resource: null, color: 'slate', email: 'ananya@glowandco.in', is_agent: true, active: true },
    { id: 7, name: 'Leo Fernandes', role: 'Front desk', resource: null, color: 'slate', email: 'leo@glowandco.in', is_agent: true, active: true },
  ];

  const services = [
    { id: 1, name: 'Haircut & style', minutes: 45, price: 1200, color: 'teal', staff: [1, 2] },
    { id: 2, name: 'Hair colour', minutes: 90, price: 3800, color: 'blue', staff: [2] },
    { id: 3, name: 'Hair spa', minutes: 60, price: 1800, color: 'cyan', staff: [1] },
    { id: 4, name: 'Massage', minutes: 60, price: 2500, color: 'violet', staff: [3] },
    { id: 5, name: 'Head massage', minutes: 30, price: 900, color: 'indigo', staff: [3] },
    { id: 6, name: 'Facial', minutes: 60, price: 2800, color: 'amber', staff: [4] },
    { id: 7, name: 'Skin consultation', minutes: 30, price: 0, color: 'orange', staff: [4] },
    { id: 8, name: 'Manicure', minutes: 45, price: 900, color: 'rose', staff: [5] },
    { id: 9, name: 'Pedicure', minutes: 60, price: 1100, color: 'pink', staff: [5] },
  ];
  const servicesFor = (sid) => services.filter((s) => s.staff.includes(sid));

  // ---- contacts
  const contacts = [];
  const usedNames = new Set();
  const usedPhones = new Set();
  const uniquePhone = () => {
    let p;
    do { p = `+91 9${between(1000, 9999)} ${between(10000, 99999)}`; } while (usedPhones.has(p));
    usedPhones.add(p);
    return p;
  };
  const N = 420;
  for (let i = 1; i <= N; i++) {
    let first, last, g, name;
    do {
      g = chance(0.62) ? 'F' : 'M';
      first = pick(g === 'F' ? FIRST_F : FIRST_M);
      last = pick(LAST);
      name = `${first} ${last}`;
    } while (usedNames.has(name) && usedNames.size < 700);
    usedNames.add(name);
    const tags = [];
    const roll = r();
    if (roll < 0.06) tags.push('New');
    else if (roll < 0.14) tags.push('Lapsed');
    if (chance(0.08)) tags.push('VIP');
    if (chance(0.3)) tags.push('Regular');
    if (g === 'F' && chance(0.04)) tags.push('Bridal');
    if (chance(0.1)) tags.push('Membership');
    if (chance(0.05)) tags.push('Needs follow-up');
    const optRoll = r();
    const opt_in = optRoll < 0.84 ? 'opted_in' : optRoll < 0.94 ? 'pending' : 'opted_out';
    const createdDaysAgo = tags.includes('New') ? between(1, 25) : between(40, 1400);
    contacts.push({
      id: i,
      name,
      phone: uniquePhone(),
      email: chance(0.7) ? `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}@${pick(['gmail.com', 'outlook.com', 'yahoo.in', 'icloud.com'])}` : '',
      gender: g,
      tags,
      opt_in,
      opt_in_at: opt_in === 'opted_in' ? ago(createdDaysAgo * 1440 - between(0, 600)) : null,
      owner_id: between(1, 5),
      source: pick(['whatsapp', 'whatsapp', 'instagram', 'walk_in', 'website', 'referral']),
      language: chance(0.85) ? 'English' : pick(['Hindi', 'Marathi']),
      notes: '',
      alerts: [],
      created_at: ago(createdDaysAgo * 1440),
    });
  }
  // Hand-tuned contacts used in conversations
  const C = (id, patch) => Object.assign(contacts[id - 1], patch);
  C(1, { name: 'Kavya Sharma', gender: 'F', tags: ['Regular', 'VIP'], opt_in: 'opted_in', notes: 'Prefers afternoon slots. Sister (Riya) sometimes books on her behalf.', alerts: ['Sensitive skin — patch test first'], phone: '+91 98201 55018', email: 'kavya.sharma@gmail.com', owner_id: 4 });
  C(2, { name: 'Daniel Brooks', gender: 'M', tags: ['New'], opt_in: 'opted_in', phone: '+91 99300 12077' });
  C(3, { name: 'Fatima Sheikh', gender: 'F', tags: ['Regular'], opt_in: 'opted_in', alerts: ['Ammonia sensitivity'], phone: '+91 98670 33421', owner_id: 2 });
  C(4, { name: 'Rahul Verma', gender: 'M', tags: ['Regular'], opt_in: 'opted_in', phone: '+91 97690 88213', owner_id: 1 });
  C(5, { name: 'Emily Carter', gender: 'F', tags: ['New'], opt_in: 'opted_in', phone: '+91 90040 66510' });
  C(6, { name: 'Arjun Kapoor', gender: 'M', tags: ['Lapsed'], opt_in: 'opted_in', phone: '+91 98190 70145', owner_id: 1 });
  C(7, { name: 'Neha Gupta', gender: 'F', tags: ['Membership'], opt_in: 'opted_in', phone: '+91 98920 41187', owner_id: 2 });
  C(8, { name: 'Vikram Singh', gender: 'M', tags: [], opt_in: 'opted_in', phone: '+91 99870 23390' });
  C(9, { name: 'Sophie Martin', gender: 'F', tags: ['New'], opt_in: 'opted_in', phone: '+91 90290 55764' });
  C(10, { name: 'Imran Qureshi', gender: 'M', tags: ['Regular'], opt_in: 'opted_in', phone: '+91 98330 61209' });
  C(11, { name: 'Lakshmi Menon', gender: 'F', tags: ['VIP', 'Membership'], opt_in: 'opted_in', phone: '+91 98210 90031' });
  C(12, { name: 'Oliver Bennett', gender: 'M', tags: ['Bridal'], opt_in: 'opted_in', phone: '+91 97020 44876' });

  for (const c of contacts) if (c.opt_in === 'opted_in' && !c.opt_in_at) c.opt_in_at = c.created_at;

  // ---- bookings
  const bookings = [];
  let bid = 1;
  const remindersStart = workspace.reminders.started_at;
  const SOURCES = [['whatsapp', 0.42], ['phone', 0.29], ['website', 0.15], ['walk_in', 0.14]];
  const pickSource = () => {
    let x = r();
    for (const [s, p] of SOURCES) { if ((x -= p) < 0) return s; }
    return 'phone';
  };
  const firstDay = addDaysKey(today, -84);
  const lastDay = addDaysKey(today, 14);
  // ~55% of contacts are regulars who make most visits; the rest are occasional / lapsed.
  const regulars = contacts.filter((c) => c.id % 9 < 5 && !c.tags.includes('Lapsed') && !c.tags.includes('New'));
  const occasional = contacts.filter((c) => !regulars.includes(c) && !c.tags.includes('New'));
  const pickContact = (future) => {
    const pool = chance(future ? 0.93 : 0.82) ? regulars : occasional;
    let c = pick(pool);
    // hand-written demo contacts (1–12) get their future bookings explicitly
    while (future && (c.id <= 12 || c.tags.includes('Lapsed'))) c = pick(regulars);
    return c;
  };
  const hourWeight = (min) => {
    // busier late morning & evening
    if (min < 600) return 0.6;
    if (min < 720) return 0.92;
    if (min < 960) return 0.75;
    return 0.88;
  };
  for (let key = firstDay; key <= lastDay; key = addDaysKey(key, 1)) {
    const wd = weekdayOfKey(key);
    const hrs = workspace.hours[['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][wd]];
    if (!hrs) continue;
    const isToday = key === today;
    const isPast = key < today;
    const futureDays = key > today ? daysBetweenKeys(today, key) : 0;
    const fill = key > today ? Math.max(0.25, 0.78 - futureDays * 0.045) : 1;
    for (const s of staff.filter((x) => !x.is_agent)) {
      let t = hrs[0];
      while (t < hrs[1] - 30) {
        if (t >= workspace.lunch[0] && t < workspace.lunch[1]) { t = workspace.lunch[1]; continue; }
        const svc = pick(servicesFor(s.id));
        if (t + svc.minutes > hrs[1]) break;
        if (r() < hourWeight(t) * fill) {
          const start = at(key, t);
          const end = start + svc.minutes * 60000;
          const contact = pickContact(start > now);
          const b = {
            id: bid++, contact_id: contact.id, staff_id: s.id, service_id: svc.id,
            start, end, status: 'booked', source: pickSource(),
            arrived_at: null, started_at: null, finished_at: null,
            reminder: 'none', reminder_at: null, note: '', created_at: start - between(1, 20) * 864e5,
          };
          const remindable = start - 864e5 >= remindersStart && contact.opt_in === 'opted_in';
          if (isPast || (isToday && end <= now)) {
            const noShowP = start < remindersStart ? 0.125 : 0.043;
            const x = r();
            if (x < 0.028) b.status = 'cancelled';
            else if (x < 0.028 + noShowP) b.status = 'no_show';
            else {
              b.status = 'done';
              b.arrived_at = start - between(0, 12) * 60000;
              b.started_at = start + between(0, 8) * 60000;
              b.finished_at = Math.min(end + between(-5, 10) * 60000, now);
            }
          }
          if (remindable && (start - 864e5 <= now)) {
            const x = r();
            b.reminder = x < 0.035 ? 'failed' : x < 0.07 ? 'sent' : x < 0.19 ? 'delivered' : x < 0.33 ? 'read' : x < 0.39 ? 'reschedule' : 'confirmed';
            b.reminder_at = start - 864e5;
            if (b.reminder === 'confirmed' && b.status === 'booked') b.status = 'confirmed';
          }
          bookings.push(b);
          t += svc.minutes + (chance(0.3) ? 15 : 0);
        } else {
          t += 15 * between(1, 3);
        }
      }
    }
  }
  // Today: create a live flow (in service / waiting / expected)
  const todays = bookings.filter((b) => dayKey(b.start, tz) === today);
  for (const s of staff) {
    const mine = todays.filter((b) => b.staff_id === s.id).sort((a, b) => a.start - b.start);
    const current = mine.find((b) => b.start <= now && b.end > now && b.status !== 'cancelled');
    if (current) {
      current.status = 'in_service';
      current.arrived_at = current.start - between(2, 10) * 60000;
      current.started_at = Math.min(now - 60000, current.start + between(0, 6) * 60000);
    }
    const next = mine.filter((b) => b.start > now && b.start - now < 50 * 60000);
    for (const b of next.slice(0, chance(0.5) ? 2 : 1)) {
      b.status = 'arrived';
      b.arrived_at = now - between(4, 19) * 60000;
    }
    // a couple running late: earlier bookings still waiting
    const late = mine.find((b) => b.status === 'booked' && b.start < now);
    if (late) { late.status = 'arrived'; late.arrived_at = late.start; }
  }

  // ---- conversations & messages
  const conversations = [];
  const messages = [];
  let mid = 1;
  let cid = 1;
  const msg = (conv, m) => {
    const full = {
      id: mid++, conversation_id: conv.id, direction: 'in', author: 'customer', author_name: null,
      kind: 'text', body: '', template: null, status: 'read', wa_id: `wamid.demo${mid}`, error: null,
      reply_to: null, ...m,
    };
    messages.push(full);
    return full;
  };
  const conv = (c) => {
    const x = {
      id: cid++, contact_id: c.contact_id, status: 'open', assignee_id: null, labels: [], pinned: false,
      ai_mode: 'assist', unread: 0, urgent: false, created_at: ago(60 * 24 * 30), ...c,
    };
    conversations.push(x);
    return x;
  };
  const tomorrow = addDaysKey(today, 1);
  const nextWorking = (key) => { let k = key; while (!workspace.hours[['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][weekdayOfKey(k)]]) k = addDaysKey(k, 1); return k; };
  const tKey = nextWorking(tomorrow);

  // Kavya — reschedule request, booking tomorrow
  const kavyaBooking = { id: bid++, contact_id: 1, staff_id: 4, service_id: 6, start: at(tKey, 660), end: at(tKey, 720), status: 'booked', source: 'whatsapp', arrived_at: null, started_at: null, finished_at: null, reminder: 'none', reminder_at: null, note: 'Hydra facial', created_at: ago(60 * 50) };
  bookings.push(kavyaBooking);
  let cv = conv({ contact_id: 1, assignee_id: 6, labels: ['Booking'], pinned: true, unread: 1 });
  msg(cv, { direction: 'out', author: 'system', author_name: 'Auto', kind: 'template', body: 'Hi Kavya, your Facial with Sara Khan is booked ' + 'tomorrow at 11:00 AM. Glow & Co. Studio, 12 Carter Road.', template: { name: 'booking_confirmation', header: null, footer: 'Reply here if you need to change it.', buttons: [] }, created_at: ago(60 * 50), status: 'read' });
  msg(cv, { body: 'Thank you! 🙏', created_at: ago(60 * 49.5) });
  msg(cv, { direction: 'out', author: 'event', kind: 'event', body: '24-hour window closed — templates only until Kavya replies', created_at: ago(60 * 25.5) });
  msg(cv, { body: 'Hi, could I move my facial a little later? 11 is tight with work.', created_at: ago(31) });
  msg(cv, { body: 'Anything after 1 works for me', created_at: ago(30) , status: 'delivered'});

  // Daniel — payment question
  cv = conv({ contact_id: 2, labels: ['Pricing'], unread: 2 });
  msg(cv, { body: "Hi, I'd like to book a haircut this week. How much is it?", created_at: ago(9) });
  msg(cv, { body: 'Also — do you accept UPI or only cards?', created_at: ago(5), status: 'delivered' });

  // Fatima — urgent reaction
  cv = conv({ contact_id: 3, labels: ['Complaint', 'Urgent'], unread: 1, urgent: true, assignee_id: 7, ai_mode: 'off' });
  msg(cv, { body: "Hello, my scalp has been itching and burning since yesterday's colour. Is that normal? It's getting worse.", created_at: ago(13), status: 'delivered' });

  // Rahul — choosing slot
  cv = conv({ contact_id: 4, labels: ['Booking'], unread: 1, assignee_id: 6 });
  msg(cv, { direction: 'out', author: 'agent', author_name: 'Ananya Rao', body: 'Hi Rahul! Aarav has Saturday 11:30 AM or 4:30 PM free. Which works?', created_at: ago(24), status: 'read' });
  msg(cv, { body: 'Saturday 4:30 please', created_at: ago(17), status: 'delivered' });

  // Emily — parking
  cv = conv({ contact_id: 5, labels: ['Question'], unread: 1 });
  msg(cv, { body: 'Is there parking near the studio? First time coming tomorrow 😊', created_at: ago(52), status: 'delivered' });

  // Arjun — template-only (window closed)
  cv = conv({ contact_id: 6, labels: ['Booking'], assignee_id: 6 });
  msg(cv, { direction: 'out', author: 'system', author_name: 'Campaign', kind: 'template', body: "Hi Arjun, it's been a few months since your last visit with Aarav. Book your next appointment and enjoy 10% off this month.", template: { name: 'we_miss_you', header: "It's been a while", footer: null, buttons: ['Book now'] }, created_at: ago(60 * 28), status: 'read' });
  msg(cv, { kind: 'button', body: 'Book now', created_at: ago(60 * 27) });

  // Neha — we replied
  cv = conv({ contact_id: 7, labels: ['Question'], assignee_id: 6 });
  msg(cv, { body: 'Can Priya do a gloss treatment on Thursday?', created_at: ago(140) });
  msg(cv, { direction: 'out', author: 'agent', author_name: 'Ananya Rao', body: 'Hi Neha — Priya can do 3 PM Thursday. Shall I lock it in?', created_at: ago(128), status: 'read' });

  // Vikram — confirmation template
  cv = conv({ contact_id: 8, labels: ['Booking'], assignee_id: 7 });
  msg(cv, { direction: 'out', author: 'system', author_name: 'Auto', kind: 'template', body: 'Hi Vikram, your Massage with Rohan Das is booked on Saturday at 5:00 PM. Glow & Co. Studio, 12 Carter Road.', template: { name: 'booking_confirmation', header: null, footer: 'Reply here if you need to change it.', buttons: [] }, created_at: ago(300), status: 'delivered' });

  // Sophie — AI answered
  cv = conv({ contact_id: 9, labels: ['Pricing'], ai_mode: 'auto' });
  msg(cv, { body: 'Hi! What does a facial cost?', created_at: ago(200) });
  msg(cv, { direction: 'out', author: 'ai', author_name: 'Xeroura AI', body: 'Hi Sophie! A 60-minute facial with Sara is ₹2,800. Would you like me to check a time for you?', created_at: ago(199), status: 'read' });
  msg(cv, { body: 'Maybe next week, thanks!', created_at: ago(190) });

  // Imran — resolved
  cv = conv({ contact_id: 10, status: 'resolved', labels: ['Booking'], assignee_id: 7 });
  msg(cv, { body: 'Running 10 min late, sorry!', created_at: ago(60 * 26) });
  msg(cv, { direction: 'out', author: 'agent', author_name: 'Leo Fernandes', body: 'No problem Imran, see you soon.', created_at: ago(60 * 26 - 2), status: 'read' });

  // Lakshmi — resolved thanks
  cv = conv({ contact_id: 11, status: 'resolved', labels: [] });
  msg(cv, { body: 'Thank you so much, loved the haircut! 💇‍♀️', created_at: ago(60 * 5) });
  msg(cv, { direction: 'out', author: 'agent', author_name: 'Ananya Rao', body: 'So glad to hear it, Lakshmi! See you next month ✨', created_at: ago(60 * 5 - 3), status: 'read' });

  // Oliver — AI escalated to human
  cv = conv({ contact_id: 12, labels: ['Needs human'], ai_mode: 'off', unread: 1 });
  msg(cv, { body: 'Do you do bridal packages? Wedding is in December.', created_at: ago(70) });
  msg(cv, { direction: 'out', author: 'ai', author_name: 'Xeroura AI', body: "Congratulations! 🎉 Bridal packages are put together by our team, so I've asked a teammate to reply with options and dates.", created_at: ago(69), status: 'read' });
  msg(cv, { body: 'Great, can someone call me?', created_at: ago(66), status: 'delivered' });

  for (const c of conversations) {
    const ms = messages.filter((m) => m.conversation_id === c.id && m.kind !== 'event');
    const inbound = ms.filter((m) => m.direction === 'in');
    c.last_inbound_at = inbound.length ? inbound[inbound.length - 1].created_at : null;
    c.updated_at = ms[ms.length - 1].created_at;
  }

  // ---- templates
  const templates = [
    { id: 1, name: 'booking_confirmation', category: 'utility', language: 'en', status: 'approved', header: null, body: 'Hi {{1}}, your {{2}} with {{3}} is booked {{4}}. {{5}}.', footer: 'Reply here if you need to change it.', buttons: [], variables: ['first_name', 'service', 'staff', 'when', 'business_address'] },
    { id: 2, name: 'booking_reminder', category: 'utility', language: 'en', status: 'approved', header: 'Appointment reminder', body: "Hi {{1}}, this is a reminder of your {{2}} with {{3}} {{4}}. Please confirm below, or tap Reschedule and we'll find a new time.", footer: '{{business_name}}', buttons: ['Confirm', 'Reschedule'], variables: ['first_name', 'service', 'staff', 'when'] },
    { id: 3, name: 'we_miss_you', category: 'marketing', language: 'en', status: 'approved', header: "It's been a while", body: "Hi {{1}}, it's been a few months since your last visit with {{2}}. Book your next appointment and enjoy 10% off this month.", footer: null, buttons: ['Book now'], variables: ['first_name', 'last_staff'] },
    { id: 4, name: 'festive_offer', category: 'marketing', language: 'en', status: 'approved', header: 'Diwali glow packages', body: 'Hi {{1}}, our Diwali glow packages are here! Facial + manicure for ₹2,499 until Nov 10. Tap below to book.', footer: null, buttons: ['Book now'], variables: ['first_name'] },
    { id: 5, name: 'holiday_hours', category: 'utility', language: 'en', status: 'approved', header: null, body: 'Hi {{1}}, a quick note on our holiday hours: we close at 2 PM on Dec 24 and reopen on Dec 27. You can book online anytime.', footer: null, buttons: [], variables: ['first_name'] },
    { id: 6, name: 'review_request', category: 'marketing', language: 'en', status: 'approved', header: null, body: 'Hi {{1}}, thanks for visiting today! How was your experience with {{2}}?', footer: null, buttons: ['Loved it', 'It was okay', 'Not great'], variables: ['first_name', 'last_staff'] },
    { id: 7, name: 'new_service_launch', category: 'marketing', language: 'en', status: 'pending', header: 'New: scalp detox', body: 'Hi {{1}}, we just launched a 45-minute scalp detox treatment. Reply YES to get the first slot.', footer: null, buttons: [], variables: ['first_name'] },
  ];

  // ---- campaigns
  const campaigns = [
    { id: 1, name: 'Win-back · lapsed 90 days', template_id: 3, audience: { type: 'tag', value: 'Lapsed' }, status: 'scheduled', scheduled_at: at(addDaysKey(today, 3), 600), sent_at: null, stats: null, created_at: ago(1440 * 2) },
    { id: 2, name: 'Bridal season', template_id: 4, audience: { type: 'tag', value: 'Bridal' }, status: 'draft', scheduled_at: null, sent_at: null, stats: null, created_at: ago(1440) },
    { id: 3, name: 'Holiday hours', template_id: 5, audience: { type: 'all' }, status: 'draft', scheduled_at: null, sent_at: null, stats: null, created_at: ago(600) },
    { id: 4, name: 'Diwali glow packages', template_id: 4, audience: { type: 'all' }, status: 'sent', scheduled_at: null, sent_at: ago(1440 * 18 + 400), stats: { recipients: 336, excluded: 38, sent: 336, delivered: 329, read: 291, replied: 84, booked: 57, failed: 7 }, created_at: ago(1440 * 20) },
    { id: 5, name: 'Review requests · October', template_id: 6, audience: { type: 'tag', value: 'Regular' }, status: 'sent', scheduled_at: null, sent_at: ago(1440 * 33 + 300), stats: { recipients: 118, excluded: 6, sent: 118, delivered: 117, read: 106, replied: 61, booked: 14, failed: 1 }, created_at: ago(1440 * 34) },
  ];

  const quick_replies = [
    { id: 1, title: 'Location & parking', body: "We're at 12 Carter Road, Bandra West — next to Café Sol. There's free parking in the lane behind the studio, and paid parking at Joggers Park." },
    { id: 2, title: 'Opening hours', body: "We're open Monday to Friday 9 AM–7 PM, and Saturday 9 AM–5 PM. Closed on Sundays." },
    { id: 3, title: 'What to bring', body: 'Nothing special! For colour appointments please come with dry, unwashed hair. Arriving 5 minutes early helps.' },
    { id: 4, title: 'Running late?', body: 'No problem — let us know roughly when you\'ll arrive. If it\'s more than 15 minutes we may need to move you to a later slot.' },
    { id: 5, title: 'Prices', body: 'Haircut & style ₹1,200 · Hair colour from ₹3,800 · Facial ₹2,800 · Massage ₹2,500 · Manicure ₹900. Want me to check a time for you?' },
    { id: 6, title: 'Payments', body: 'We accept UPI, all major cards and cash. Members get 10% off automatically.' },
  ];

  return {
    version: 3,
    seq: { contact: contacts.length + 1, booking: bid, conversation: cid, message: mid, template: 8, campaign: 6, quick_reply: 7, staff: 8, service: 10 },
    me: 6,
    workspace, whatsapp, staff, services, contacts, bookings, conversations, messages, templates, campaigns, quick_replies,
  };
}
