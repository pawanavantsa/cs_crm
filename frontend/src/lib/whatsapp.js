// Shared WhatsApp helpers used by both the UI and the demo server.

export const WINDOW_MS = 24 * 3600 * 1000;

export function firstName(name = '') {
  return name.split(' ')[0] || name;
}

/** Fill a template body ({{1}}, {{2}} … or {{business_name}}) from variable values. */
export function renderTemplate(text, values = [], extra = {}) {
  if (!text) return text;
  return text.replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, k) => {
    if (/^\d+$/.test(k)) return values[+k - 1] ?? m;
    return extra[k] ?? m;
  });
}

/** Resolve a template's variable list for a contact (+ optional booking). */
export function templateValues(template, ctx) {
  const { contact, booking, staffName, serviceName, whenText, business, lastStaff } = ctx;
  const map = {
    first_name: firstName(contact?.name),
    name: contact?.name,
    service: serviceName || booking?.service?.name || 'appointment',
    staff: staffName || booking?.staff?.name || 'our team',
    when: whenText || '',
    business_name: business?.name,
    business_address: business ? `${business.name}, ${business.address.split(',')[0]}` : '',
    last_staff: lastStaff || 'our team',
  };
  return (template.variables || []).map((v) => map[v] ?? '');
}

export function windowOpen(lastInboundAt, now = Date.now()) {
  return !!lastInboundAt && now - lastInboundAt < WINDOW_MS;
}

export function windowLeft(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) return 0;
  return Math.max(0, WINDOW_MS - (now - lastInboundAt));
}

/** "today at 4:30 PM", "tomorrow at 11 AM", "on Wed, Nov 4 at 9:00 AM" — reads well after "booked" / "with Sara". */
export function whenPhrase(rel, time) {
  const r = rel.toLowerCase();
  return r === 'today' || r === 'tomorrow' ? `${r} at ${time}` : `on ${rel} at ${time}`;
}
