// Writes backend/crm/fixtures/demo_seed.json from the same generator the demo UI uses.
// The Django `seed_demo` command shifts every timestamp so the data lands on "today".
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildSeed } from '../src/demo/seed.js';
import { dayKey, parseDayKey, zonedToUtc } from '../src/lib/time.js';

const tz = process.env.TZ_NAME || 'Asia/Kolkata';
const today = dayKey(Date.now(), tz);
const { y, m, d } = parseDayKey(today);
const anchor = zonedToUtc(y, m, d, 10, 44, tz);
const seed = buildSeed(anchor, tz);
seed.anchor = { day: today, ts: anchor, tz };
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/crm/fixtures/demo_seed.json');
writeFileSync(out, JSON.stringify(seed));
console.log(`wrote ${out} (${seed.contacts.length} contacts, ${seed.bookings.length} bookings)`);
