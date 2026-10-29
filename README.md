# Xeroura CRM

A WhatsApp-first CRM for appointment-based businesses — salons, clinics, studios, agencies, repair shops. One shared WhatsApp inbox, a live customer flow board, a schedule, contacts with consent tracking, broadcasts and templates, reminders that confirm bookings by themselves, and reports.

The WhatsApp side reuses the approach from **Xeroura CS Bot** (`channels_app/whatsapp.py` + `WhatsAppWebhookView`): the same Cloud API endpoints, webhook verification, per-workspace credentials matched by `phone_number_id`, and the "always return 200 to Meta" rule — extended for a CRM (receipts, templates with button payloads, opt-in/out, signatures).

```
frontend/   React 19 + Vite. Runs on its own in demo mode (data in the browser), or against the API.
backend/    Django 5 + DRF. WhatsApp Cloud API webhook, REST API, reminders, broadcasts, Claude replies.
```

## Run it

### 1. Just look at it (no backend)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

With no `VITE_API_URL`, the app runs the full API in the browser (`src/demo/server.js`) with a seeded business, "Glow & Co. Studio". The clock starts at 10:44 AM so the day looks busy; click the clock to switch to real time. **New → Simulate customer message** runs the same steps as the webhook.

### 2. Full stack with Docker

```bash
cp .env.example .env         # fill in what you have; everything is optional for a first run
docker compose up --build
```

- Frontend: http://localhost:5173 — sign in as `admin` / `xeroura-demo` (from `DEMO_PASSWORD`)
- API: http://localhost:8000/api/ · Django admin: http://localhost:8000/admin/
- `worker` sends due reminders and scheduled broadcasts every 5 minutes.

The first start runs `makemigrations crm` and `migrate`, then `seed_demo` (when `SEED_DEMO=true`). Commit the generated `backend/crm/migrations/0001_initial.py`.

### 3. Backend without Docker

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py makemigrations crm && python manage.py migrate
python manage.py seed_demo                 # admin / xeroura-demo
python manage.py runserver 8000
python manage.py test crm                  # webhook + API tests
```

Then point the frontend at it: `VITE_API_URL=http://localhost:8000 npm run dev`, or **Settings → Data & API → Connect** in the demo.

## Connect your WhatsApp number

1. In Meta for Developers, create an app with the **WhatsApp** product and add your business number.
2. Create a **system user** token with `whatsapp_business_messaging` and `whatsapp_business_management`.
3. In Xeroura **Settings → WhatsApp**, paste the *Phone number ID*, *WhatsApp Business Account ID*, the token and (recommended) the *App secret*.
4. In Meta → WhatsApp → Configuration, set the callback URL to `https://<your-domain>/api/webhooks/whatsapp/` and the verify token shown in Settings. Subscribe to `messages` and `message_template_status_update`. For local testing, uncomment the `ngrok` service in `docker-compose.yml`.
5. Create `booking_confirmation` and `booking_reminder` in **Campaigns → Templates** (they're submitted to Meta for approval). The reminder needs two quick-reply buttons: *Confirm* and *Reschedule*.
6. **Send test message** sends Meta's `hello_world` template to your phone.

Without a token, sends are simulated (`wamid.demo…`) so the CRM stays usable while you set things up.

## How WhatsApp flows through the app

```
Meta webhook ──► /api/webhooks/whatsapp/  (verify X-Hub-Signature-256)
                 │
                 ├─ statuses ─► Message.status (sent → delivered → read / failed)
                 │              ├─ Booking.reminder (read receipts on reminders)
                 │              └─ Campaign.stats (delivered / read / failed)
                 │
                 └─ messages ─► Contact (create, auto opt-in; STOP opts out)
                                Conversation (reopen, unread++, 24-hour window starts)
                                Message (deduped by wamid — Meta retries)
                                ├─ button "CONFIRM:<booking>"    → booking confirmed + reply
                                ├─ button "RESCHEDULE:<booking>" → flagged for the team
                                ├─ away message / first-time greeting / keyword reply
                                └─ AI: hand off to a human, or auto-reply (if the chat allows)
```

Outbound rules enforced by the API:

- Free-form text only inside the **24-hour customer-service window**; otherwise the composer switches to approved templates.
- Templates and broadcasts only go to contacts who **opted in**; opted-out contacts are excluded and counted.
- Replies go out on the **same business number** that received the message (CS Bot lesson: mismatched token vs `phone_number_id` is the classic "dashboard shows it, customer never gets it" bug).

## AI replies

Xeroura AI drafts replies from the workspace itself — business details, opening hours, services and prices, and your quick replies — using Claude (`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`). Per conversation you choose **Auto-reply when confident**, **Suggest only**, or **Off**. Requests for a person, complaints and refunds switch the chat to a human and label it *Needs human*. Without an API key, suggestions come from keyword-matching your quick replies.

## Scheduled jobs

| Command | When | What |
|---|---|---|
| `python manage.py send_reminders` | every 5–15 min | Sends `booking_reminder` to opted-in customers inside the reminder window (8 AM–9 PM local) |
| `python manage.py run_campaigns` | every 5 min | Sends scheduled broadcasts that are due |

## API

All routes live under `/api/` and need `Authorization: Token <key>` (from `POST /api/auth/login`), except the webhook. They match `frontend/src/demo/server.js` one-for-one: `bootstrap`, `today`, `search`, `bookings`, `schedule`, `reminders/tomorrow`, `conversations` (+ `messages`, `read`, `suggest`), `inbox/stats`, `contacts` (+ `export`), `templates`, `campaigns` (+ `send`, `duplicate`, `cancel`), `reports`, `settings/workspace`, `settings/whatsapp` (+ `test`, `disconnect`), `staff`, `services`, `quick-replies`, `demo/inbound`.

## Customising for your business

Everything business-specific is data: name, hours, lunch break, slot length and time zone (**Settings → Business**), team members and their chairs/rooms, services with duration and price (**Team & services**), labels, quick replies and keyword rules (**Auto-replies & AI**). To change the demo dataset, edit `frontend/src/demo/seed.js` and run `npm run export-seed` — the backend's `seed_demo` loads the same file.
