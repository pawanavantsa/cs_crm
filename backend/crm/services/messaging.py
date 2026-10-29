"""Conversation logic shared by the webhook, the API and management commands.

Inbound pipeline (CS Bot ``WhatsAppWebhookView.post`` → ``process_message_internal``,
adapted for a CRM):

    webhook → parse → find/create Contact (opt in) → find/reopen Conversation
            → save Message → reminder button? update Booking
            → away / greeting / keyword auto-replies
            → AI: hand-off detection, or auto-reply when the chat allows it
            → send via the Cloud API on the number that received the message
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from ..models import Booking, Contact, Conversation, Message, Template, WhatsAppConfig, Workspace, digits
from . import ai
from .whatsapp import CloudAPI, InboundMessage, StatusUpdate, render_template

logger = logging.getLogger(__name__)

WINDOW = timedelta(hours=24)
STATUS_ORDER = {"queued": 0, "sent": 1, "delivered": 2, "read": 3, "failed": 4}
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


class MessagingError(Exception):
    """Raised for user-facing send problems (closed window, no consent…)."""


# --------------------------------------------------------------------------- helpers
def cloud_api(ws: Workspace, business_phone_number_id: str | None = None) -> CloudAPI:
    """Credentials for outbound sends.

    Prefer the WhatsAppConfig matching the number that received the message (CS Bot:
    a mismatched token vs. phone_number_id is the #1 reason replies never arrive),
    then the workspace's own config, then the .env fallback.
    """
    cfg = None
    if business_phone_number_id:
        cfg = WhatsAppConfig.objects.filter(phone_number_id=business_phone_number_id).exclude(access_token="").first()
    if cfg is None:
        cfg = WhatsAppConfig.objects.filter(workspace=ws).first()
    token = (cfg.access_token if cfg else "") or settings.WHATSAPP_ACCESS_TOKEN
    pnid = (cfg.phone_number_id if cfg and cfg.access_token else "") or settings.WHATSAPP_PHONE_NUMBER_ID
    return CloudAPI(token, pnid, settings.WHATSAPP_API_VERSION)


def local(dt: datetime, ws: Workspace) -> datetime:
    return dt.astimezone(ZoneInfo(ws.timezone))


def fmt_time(dt: datetime, ws: Workspace) -> str:
    return local(dt, ws).strftime("%I:%M %p").lstrip("0")


def fmt_rel_day(dt: datetime, ws: Workspace, now: datetime | None = None) -> str:
    now = now or timezone.now()
    d, n = local(dt, ws).date(), local(now, ws).date()
    if d == n:
        return "today"
    if d == n + timedelta(days=1):
        return "tomorrow"
    return local(dt, ws).strftime("%A, %b %-d")


def is_open(ws: Workspace, at: datetime) -> bool:
    t = local(at, ws)
    hrs = (ws.hours or {}).get(DAY_KEYS[t.weekday()])
    m = t.hour * 60 + t.minute
    return bool(hrs) and hrs[0] <= m < hrs[1]


def first_name(name: str) -> str:
    return (name or "").split(" ")[0] or name


def window_open(conv: Conversation, now: datetime | None = None) -> bool:
    now = now or timezone.now()
    return bool(conv.last_inbound_at and now - conv.last_inbound_at < WINDOW)


def ensure_conversation(contact: Contact, assignee=None) -> Conversation:
    try:
        conv, _ = Conversation.objects.get_or_create(
            contact=contact,
            defaults={
                "workspace": contact.workspace,
                "assignee": assignee,
                "ai_mode": "auto" if (contact.workspace.ai or {}).get("mode") == "auto" else "assist",
            },
        )
    except IntegrityError:  # two webhooks racing for the same new contact
        conv = Conversation.objects.get(contact=contact)
    return conv


def template_values(t: Template, *, contact: Contact, ws: Workspace, booking: Booking | None = None, last_staff: str | None = None) -> list[str]:
    when = ""
    if booking:
        rel = fmt_rel_day(booking.start, ws)
        when = f"{rel} at {fmt_time(booking.start, ws)}" if rel in ("today", "tomorrow") else f"on {rel} at {fmt_time(booking.start, ws)}"
    values = {
        "first_name": first_name(contact.name),
        "name": contact.name,
        "service": booking.service.name if booking else "appointment",
        "staff": booking.staff.name if booking else "our team",
        "when": when,
        "business_name": ws.name,
        "business_address": f"{ws.name}, {ws.address.split(',')[0]}" if ws.address else ws.name,
        "last_staff": last_staff or "our team",
    }
    return [str(values.get(v, "")) for v in (t.variables or [])]


# --------------------------------------------------------------------------- outbound
def record(conv: Conversation, **fields) -> Message:
    m = Message.objects.create(conversation=conv, **fields)
    if m.kind not in ("event", "note"):
        Conversation.objects.filter(pk=conv.pk).update(updated_at=m.created_at)
        conv.updated_at = m.created_at
    return m


def send_text(conv: Conversation, body: str, *, author: str = "agent", author_name: str | None = None, force: bool = False) -> Message:
    """Free-form text. Only allowed inside the 24-hour customer-service window."""
    body = (body or "").strip()
    if not body:
        raise MessagingError("Message is empty.")
    if not force and not window_open(conv):
        raise MessagingError("The 24-hour window is closed. Send an approved template to reopen the chat.")
    contact = conv.contact
    res = cloud_api(conv.workspace, conv.whatsapp_phone_number_id or None).send_text(contact.wa_id, body)
    return record(
        conv, direction="out", author=author, author_name=author_name, kind="text", body=body,
        status="sent" if res.ok else "failed", wa_id=res.message_id, error=res.error or None,
    )


def send_template(
    conv: Conversation,
    t: Template,
    values: list[str],
    *,
    author: str = "agent",
    author_name: str | None = None,
    booking: Booking | None = None,
    campaign=None,
    button_payloads: list[str] | None = None,
) -> Message:
    contact = conv.contact
    ws = conv.workspace
    if contact.opt_in == "opted_out":
        raise MessagingError(f"{contact.name} opted out of WhatsApp messages.")
    if t.status != "approved":
        raise MessagingError("Only approved templates can be sent.")
    extra = {"business_name": ws.name}
    res = cloud_api(ws, conv.whatsapp_phone_number_id or None).send_template(
        contact.wa_id, t.name, t.language, body_params=values, button_payloads=button_payloads,
    )
    return record(
        conv, direction="out", author=author, author_name=author_name, kind="template",
        body=render_template(t.body, values, extra) or "",
        template={"name": t.name, "header": render_template(t.header, values, extra), "footer": render_template(t.footer, values, extra), "buttons": t.buttons},
        status="sent" if res.ok else "failed", wa_id=res.message_id, error=res.error or None,
        booking=booking, campaign=campaign,
    )


def send_reminder(b: Booking) -> bool:
    """Reminder template with Confirm / Reschedule buttons whose payloads carry the booking id."""
    ws = b.workspace
    contact = b.contact
    if contact.opt_in != "opted_in":
        return False
    name = (ws.reminders or {}).get("template") or "booking_reminder"
    t = Template.objects.filter(workspace=ws, name=name, status="approved").first()
    if not t:
        raise MessagingError(f"Template {name} is not approved yet.")
    conv = ensure_conversation(contact)
    payloads = []
    for label in t.buttons or []:
        key = "CONFIRM" if "confirm" in label.lower() else "RESCHEDULE" if "resched" in label.lower() else label.upper()
        payloads.append(f"{key}:{b.id}")
    m = send_template(conv, t, template_values(t, contact=contact, ws=ws, booking=b), author="system", author_name="Reminder", booking=b, button_payloads=payloads)
    b.reminder = "sent" if m.status != "failed" else "failed"
    b.reminder_at = timezone.now()
    b.save(update_fields=["reminder", "reminder_at"])
    return m.status != "failed"


# --------------------------------------------------------------------------- receipts
def apply_status(s: StatusUpdate) -> None:
    """Delivery/read receipts update the message, its booking reminder and campaign stats."""
    m = Message.objects.filter(wa_id=s.message_id).select_related("booking").first()
    if not m:
        return
    if STATUS_ORDER.get(s.status, -1) <= STATUS_ORDER.get(m.status or "queued", 0) and s.status != "failed":
        return  # receipts can arrive out of order
    previous = m.status
    m.status = s.status
    if s.error:
        m.error = s.error
    m.save(update_fields=["status", "error"])
    b = m.booking
    if b and b.reminder in ("sent", "delivered", "read") and s.status in ("delivered", "read", "failed"):
        if STATUS_ORDER[s.status] > STATUS_ORDER.get(b.reminder, 0) or s.status == "failed":
            b.reminder = s.status
            b.save(update_fields=["reminder"])
    if m.campaign_id:
        from ..models import Campaign

        c = Campaign.objects.select_for_update().filter(pk=m.campaign_id).first()
        if c and c.stats is not None:
            st = dict(c.stats)
            if s.status == "failed":
                st["failed"] = st.get("failed", 0) + 1
            else:
                if previous in (None, "queued", "sent"):  # a read receipt implies delivery
                    st["delivered"] = st.get("delivered", 0) + 1
                if s.status == "read":
                    st["read"] = st.get("read", 0) + 1
            c.stats = st
            c.save(update_fields=["stats"])


# --------------------------------------------------------------------------- inbound
def workspace_for(phone_number_id: str) -> Workspace | None:
    cfg = WhatsAppConfig.objects.filter(phone_number_id=phone_number_id).select_related("workspace").first() if phone_number_id else None
    return cfg.workspace if cfg else Workspace.objects.order_by("id").first()


def _media_note(inb: InboundMessage) -> str:
    return {"image": "[Photo]", "video": "[Video]", "audio": "[Voice note]", "document": "[Document]"}.get(inb.kind, "")


@transaction.atomic
def process_inbound(inb: InboundMessage, ws: Workspace | None = None) -> Conversation | None:
    ws = ws or workspace_for(inb.phone_number_id)
    if ws is None:
        logger.error("WhatsApp: no workspace for phone_number_id=%s", inb.phone_number_id)
        return None
    if inb.message_id and Message.objects.filter(wa_id=inb.message_id, direction="in").exists():
        return None  # Meta retries webhooks; ignore duplicates
    now = timezone.now()
    wa_id = digits(inb.wa_id)

    contact = Contact.objects.filter(workspace=ws, wa_id=wa_id).first()
    if contact is None:
        contact = Contact.objects.create(
            workspace=ws, name=inb.profile_name if inb.profile_name != "Unknown" else f"+{wa_id}", phone=f"+{wa_id}",
            tags=["New"], opt_in="opted_in", opt_in_at=now, source="whatsapp",
        )
    text = (inb.text or "").strip()
    if text.lower() in ("stop", "unsubscribe"):
        contact.opt_in = "opted_out"
        contact.save(update_fields=["opt_in"])
    elif contact.opt_in == "pending":
        # A customer who messages first has opted in to hearing back from you.
        contact.opt_in, contact.opt_in_at = "opted_in", now
        contact.save(update_fields=["opt_in", "opt_in_at"])

    conv = ensure_conversation(contact)
    first_ever = not conv.messages.filter(direction="in").exists()
    _count_campaign_reply(conv, now)
    was_resolved = conv.status == "resolved"
    conv.status = "open"
    conv.unread += 1
    conv.last_inbound_at = now
    if inb.phone_number_id:
        conv.whatsapp_phone_number_id = inb.phone_number_id
    conv.save()

    kind = inb.kind if inb.kind in ("text", "button", "image", "video", "audio", "document", "location") else "text"
    record(
        conv, direction="in", author="customer", kind=kind, body=text or _media_note(inb), status="delivered",
        wa_id=inb.message_id, media={"id": inb.media_id, "mime_type": inb.mime_type} if inb.media_id else None,
    )
    cloud_api(ws, inb.phone_number_id).mark_read(inb.message_id)

    # 1) Reminder buttons: CONFIRM:<booking id> / RESCHEDULE:<booking id>
    if kind == "button":
        handle_button(conv, inb)
        return conv

    if contact.opt_in == "opted_out":
        record(conv, direction="out", author="event", kind="event", body=f"{contact.name} opted out of WhatsApp messages")
        return conv

    # 2) Automatic replies
    ar = ws.auto_replies or {}
    replied = False
    if not is_open(ws, now) and ar.get("away_enabled"):
        send_text(conv, ar.get("away_message", ""), author="system", author_name="Away message", force=True)
        replied = True
    elif first_ever and not was_resolved and ar.get("greeting_enabled"):
        send_text(conv, ar.get("greeting_message", ""), author="system", author_name="Greeting", force=True)
    for rule in ar.get("keywords") or []:
        if rule.get("enabled") and rule.get("keyword") and rule["keyword"].lower() in text.lower():
            qr = ws.quick_replies.filter(pk=rule.get("reply_id")).first()
            if qr:
                send_text(conv, qr.body, author="system", author_name=f"Keyword · {rule['keyword']}", force=True)
                replied = True
            break

    # 3) AI
    cfg = ws.ai or {}
    if cfg.get("enabled") and conv.ai_mode == "auto" and not replied and text:
        if ai.wants_human(text, cfg.get("handoff_keywords") or []):
            conv.ai_mode = "off"
            if "Needs human" not in conv.labels:
                conv.labels = [*conv.labels, "Needs human"]
            conv.save(update_fields=["ai_mode", "labels"])
            send_text(conv, "I've asked a teammate to pick this up — they'll reply here shortly.", author="ai", author_name="Xeroura AI", force=True)
        else:
            draft = draft_for(conv)
            if draft["confidence"] >= 0.7 and draft["suggestion"]:
                send_text(conv, draft["suggestion"], author="ai", author_name="Xeroura AI", force=True)
    return conv


def _count_campaign_reply(conv: Conversation, now: datetime) -> None:
    """First reply within 72 h of a broadcast counts towards that campaign's reply rate."""
    last = conv.messages.exclude(kind__in=("event", "note")).order_by("-created_at", "-id").first()
    if last and last.campaign_id and last.direction == "out" and now - last.created_at < timedelta(hours=72):
        from ..models import Campaign

        c = Campaign.objects.select_for_update().filter(pk=last.campaign_id).first()
        if c and c.stats is not None:
            c.stats = {**c.stats, "replied": c.stats.get("replied", 0) + 1}
            c.save(update_fields=["stats"])


def handle_button(conv: Conversation, inb: InboundMessage) -> None:
    ws = conv.workspace
    action, _, bid = (inb.button_payload or "").partition(":")
    b = None
    if bid.isdigit():
        b = Booking.objects.filter(pk=int(bid), workspace=ws).first()
    if b is None:  # template sent without payloads → next upcoming booking
        b = Booking.objects.filter(contact=conv.contact, start__gt=timezone.now(), status__in=("booked", "confirmed")).order_by("start").first()
    label = (inb.text or "").lower()
    if not b:
        return
    if action == "CONFIRM" or (not action and "confirm" in label):
        b.reminder, b.status = "confirmed", "confirmed"
        b.save(update_fields=["reminder", "status"])
        send_text(conv, f"Thanks {first_name(conv.contact.name)}, you're confirmed ✅ See you {fmt_rel_day(b.start, ws)} at {fmt_time(b.start, ws)}.", author="system", author_name="Auto", force=True)
    elif action == "RESCHEDULE" or "resched" in label:
        b.reminder = "reschedule"
        b.save(update_fields=["reminder"])
        if "Booking" not in conv.labels:
            conv.labels = [*conv.labels, "Booking"]
            conv.save(update_fields=["labels"])
        send_text(conv, "No problem — a teammate will message you with new times shortly.", author="system", author_name="Auto", force=True)


def draft_for(conv: Conversation) -> dict:
    ws = conv.workspace
    contact = conv.contact
    from ..shapes import contact_stats, from_ms

    st = contact_stats(contact)
    nb = st["next_booking"]
    nb_start = from_ms(nb["start"]) if nb else None
    customer = {
        "name": contact.name,
        "next_booking": f"{nb['service']['name']} with {nb['staff']['name']} {fmt_rel_day(nb_start, ws)} at {fmt_time(nb_start, ws)}" if nb else None,
        "last_visit": f"{st['last_visit']['service']} with {st['last_visit']['staff']}" if st["last_visit"] else None,
    }
    history = [
        {"role": "customer" if m.direction == "in" else "agent", "content": m.body}
        for m in conv.messages.exclude(kind__in=("event", "note")).order_by("-created_at", "-id")[:20][::-1]
        if m.body
    ]
    return ai.draft_reply(
        api_key=settings.ANTHROPIC_API_KEY,
        model=settings.CLAUDE_MODEL,
        ws={"name": ws.name, "industry": ws.industry, "address": ws.address, "phone": ws.phone, "hours": ws.hours, "ai": ws.ai},
        services=list(ws.services.values("name", "minutes", "price")),
        quick_replies=list(ws.quick_replies.values("title", "body")),
        customer=customer,
        history=history,
    )
