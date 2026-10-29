"""JSON shapes returned by the API.

They match frontend/src/demo/server.js field-for-field, so the React app works the
same against the browser demo and this backend. Timestamps are epoch milliseconds.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_tz

from django.utils import timezone

from .models import Booking, Campaign, Contact, Conversation, Message, Staff, Template, WhatsAppConfig, Workspace

WINDOW = timedelta(hours=24)
ACTIVE = ("booked", "confirmed", "arrived", "in_service")


def ms(dt: datetime | None) -> int | None:
    return int(dt.timestamp() * 1000) if dt else None


def from_ms(v) -> datetime | None:
    if v in (None, ""):
        return None
    return datetime.fromtimestamp(int(v) / 1000, tz=dt_tz.utc)


def initials(name: str) -> str:
    return "".join(p[0].upper() for p in (name or "").split()[:2])


def staff_brief(s: Staff | None) -> dict | None:
    if not s:
        return None
    return {"id": s.id, "name": s.name, "initials": initials(s.name), "color": s.color, "role": s.role, "resource": s.resource}


def staff_out(s: Staff) -> dict:
    return {**staff_brief(s), "email": s.email, "is_agent": s.is_agent, "active": s.active}


def booking_out(b: Booking, now: datetime | None = None) -> dict:
    now = now or timezone.now()
    progress = None
    if b.status == "in_service" and b.started_at:
        total = (b.end - b.start).total_seconds() or 1
        progress = min(1.0, max(0.03, (now - b.started_at).total_seconds() / total))
    c, s, sv = b.contact, b.staff, b.service
    return {
        "id": b.id, "contact_id": c.id, "staff_id": s.id, "service_id": sv.id,
        "start": ms(b.start), "end": ms(b.end), "status": b.status, "source": b.source,
        "arrived_at": ms(b.arrived_at), "started_at": ms(b.started_at), "finished_at": ms(b.finished_at),
        "reminder": b.reminder, "reminder_at": ms(b.reminder_at), "note": b.note, "created_at": ms(b.created_at),
        "contact": {"id": c.id, "name": c.name, "initials": initials(c.name), "phone": c.phone, "opt_in": c.opt_in, "tags": c.tags},
        "staff": staff_brief(s),
        "service": {"id": sv.id, "name": sv.name, "color": sv.color, "minutes": sv.minutes},
        "progress": progress,
    }


def message_out(m: Message) -> dict:
    return {
        "id": m.id, "conversation_id": m.conversation_id, "direction": m.direction, "author": m.author,
        "author_name": m.author_name, "kind": m.kind, "body": m.body, "template": m.template, "status": m.status,
        "wa_id": m.wa_id, "error": m.error, "media": m.media, "booking_id": m.booking_id, "created_at": ms(m.created_at),
    }


def visible_messages(conv: Conversation):
    return conv.messages.exclude(kind__in=("event", "note"))


def waiting_since(conv: Conversation) -> datetime | None:
    since = None
    for m in visible_messages(conv).order_by("-created_at", "-id")[:50]:
        if m.direction != "in":
            break
        since = m.created_at
    return since


def conv_out(c: Conversation, now: datetime | None = None) -> dict:
    now = now or timezone.now()
    contact = c.contact
    last = visible_messages(c).order_by("-created_at", "-id").first()
    waiting = waiting_since(c) if c.status == "open" and last and last.direction == "in" else None
    a = c.assignee
    return {
        "id": c.id,
        "status": c.status,
        "contact": {"id": contact.id, "name": contact.name, "initials": initials(contact.name), "phone": contact.phone, "opt_in": contact.opt_in},
        "assignee": {"id": a.id, "name": a.name, "initials": initials(a.name)} if a else None,
        "labels": c.labels, "pinned": c.pinned, "unread": c.unread, "urgent": c.urgent, "ai_mode": c.ai_mode,
        "last": {
            "body": last.body, "direction": last.direction, "author": last.author, "kind": last.kind,
            "template_name": (last.template or {}).get("name"), "status": last.status, "created_at": ms(last.created_at),
        } if last else None,
        "last_inbound_at": ms(c.last_inbound_at),
        "waiting_since": ms(waiting),
        "window_open": bool(c.last_inbound_at and now - c.last_inbound_at < WINDOW),
        "updated_at": ms(c.updated_at),
    }


def contact_stats(c: Contact, now: datetime | None = None) -> dict:
    now = now or timezone.now()
    bs = c.bookings.select_related("staff", "service", "contact")
    done = bs.filter(status="done").order_by("-start").first()
    upcoming = bs.filter(start__gt=now - timedelta(hours=1), status__in=ACTIVE).order_by("start").first()
    return {
        "visits": bs.filter(status="done").count(),
        "last_visit": {"start": ms(done.start), "service": done.service.name, "staff": done.staff.name} if done else None,
        "next_booking": booking_out(upcoming, now) if upcoming else None,
        "no_shows": bs.filter(status="no_show").count(),
    }


def recall_due(stats: dict, now: datetime) -> bool:
    if stats["next_booking"] or not stats["last_visit"]:
        return False
    return ms(now) - stats["last_visit"]["start"] > 45 * 864e5


def contact_out(c: Contact, full: bool = False, now: datetime | None = None) -> dict:
    now = now or timezone.now()
    st = contact_stats(c, now)
    out = {
        "id": c.id, "name": c.name, "phone": c.phone, "email": c.email, "gender": c.gender, "tags": c.tags,
        "opt_in": c.opt_in, "opt_in_at": ms(c.opt_in_at), "owner_id": c.owner_id, "source": c.source,
        "language": c.language, "notes": c.notes, "alerts": c.alerts, "created_at": ms(c.created_at),
        "initials": initials(c.name), "owner": staff_brief(c.owner), **st,
    }
    if full:
        out["bookings"] = [booking_out(b, now) for b in c.bookings.select_related("staff", "service", "contact").order_by("-start")[:12]]
        conv = Conversation.objects.filter(contact=c).first()
        out["conversation_id"] = conv.id if conv else None
        out["recall_due"] = recall_due(st, now)
    return out


def template_out(t: Template) -> dict:
    return {
        "id": t.id, "name": t.name, "category": t.category, "language": t.language, "status": t.status,
        "header": t.header, "body": t.body, "footer": t.footer, "buttons": t.buttons, "variables": t.variables,
    }


def workspace_out(ws: Workspace) -> dict:
    return {
        "id": ws.id, "name": ws.name, "tagline": ws.tagline, "industry": ws.industry, "phone": ws.phone,
        "email": ws.email, "address": ws.address, "timezone": ws.timezone, "slot_minutes": ws.slot_minutes,
        "hours": ws.hours, "lunch": ws.lunch, "labels": ws.labels, "reminders": ws.reminders,
        "auto_replies": ws.auto_replies, "ai": ws.ai, "privacy": ws.privacy, "appearance": ws.appearance,
    }


def whatsapp_out(cfg: WhatsAppConfig, webhook_url: str = "") -> dict:
    return {
        "connected": cfg.connected,
        "demo_mode": not cfg.is_live,
        "verified_name": cfg.verified_name or cfg.workspace.name,
        "display_phone": cfg.display_phone or cfg.workspace.phone,
        "quality": cfg.quality,
        "messaging_limit": cfg.messaging_limit,
        "waba_id": cfg.waba_id,
        "phone_number_id": cfg.phone_number_id,
        "access_token_set": bool(cfg.access_token),
        "app_secret_set": bool(cfg.app_secret),
        "verify_token": cfg.verify_token,
        "webhook_url": webhook_url,
        "subscribed_fields": cfg.subscribed_fields or ["messages", "message_status", "message_template_status_update"],
    }


def campaign_brief(c: Campaign) -> dict:
    return {
        "id": c.id, "name": c.name, "template_id": c.template_id, "audience": c.audience, "status": c.status,
        "scheduled_at": ms(c.scheduled_at), "sent_at": ms(c.sent_at), "stats": c.stats, "created_at": ms(c.created_at),
    }
