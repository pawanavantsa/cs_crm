// Timezone-aware helpers. All timestamps in the app are UTC ISO strings / epoch ms;
// they are rendered in the workspace's timezone (Settings → Business).

const dtfCache = new Map();
function dtf(tz) {
  if (!dtfCache.has(tz)) {
    dtfCache.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
      })
    );
  }
  return dtfCache.get(tz);
}

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function partsInTz(ts, tz) {
  const out = {};
  for (const p of dtf(tz).formatToParts(new Date(ts))) out[p.type] = p.value;
  return {
    y: +out.year, m: +out.month, d: +out.day,
    hh: +out.hour % 24, mm: +out.minute, ss: +out.second,
    wd: WD[out.weekday],
  };
}

function tzOffset(ts, tz) {
  const p = partsInTz(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ts / 1000) * 1000;
}

/** Wall-clock time in `tz` → epoch ms. */
export function zonedToUtc(y, m, d, hh = 0, mm = 0, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - tzOffset(guess, tz);
  ts = guess - tzOffset(ts, tz);
  return ts;
}

export function dayKey(ts, tz) {
  const p = partsInTz(ts, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

export function addDaysKey(key, n) {
  const { y, m, d } = parseDayKey(key);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function daysBetweenKeys(a, b) {
  const pa = parseDayKey(a), pb = parseDayKey(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 864e5);
}

export function weekdayOfKey(key) {
  const { y, m, d } = parseDayKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function startOfDay(ts, tz) {
  const p = partsInTz(ts, tz);
  return zonedToUtc(p.y, p.m, p.d, 0, 0, tz);
}

export function minutesOfDay(ts, tz) {
  const p = partsInTz(ts, tz);
  return p.hh * 60 + p.mm;
}

export function fmtTime(ts, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    .format(new Date(ts));
}

export function fmtDate(ts, tz, opts = { month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(ts));
}

export function fmtLongDay(ts, tz) {
  return fmtDate(ts, tz, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "10:15 AM" today, "Yesterday", "Tue" this week, else "Oct 12". */
export function fmtListTime(ts, tz, now = Date.now()) {
  const k = dayKey(ts, tz);
  const today = dayKey(now, tz);
  if (k === today) return fmtTime(ts, tz);
  if (k === addDaysKey(today, -1)) return 'Yesterday';
  if (now - ts < 6 * 864e5) return fmtDate(ts, tz, { weekday: 'short' });
  return fmtDate(ts, tz);
}

/** "Today", "Tomorrow", "Wed, Nov 4". */
export function fmtRelDay(ts, tz, now = Date.now()) {
  const k = dayKey(ts, tz);
  const today = dayKey(now, tz);
  if (k === today) return 'Today';
  if (k === addDaysKey(today, 1)) return 'Tomorrow';
  if (k === addDaysKey(today, -1)) return 'Yesterday';
  return fmtDate(ts, tz, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
  return `${Math.floor(h / 24)} d`;
}

export function greeting(ts, tz) {
  const h = partsInTz(ts, tz).hh;
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'Africa/Lagos',
];
