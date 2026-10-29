"""REST API for the Xeroura CRM frontend.

Every route mirrors frontend/src/demo/server.js (same paths, same JSON), so the UI
behaves identically in demo mode and against this backend.
"""
from __future__ import annotations

import csv
import io
import logging
import re
from datetime import date, datetime, timedelta

from django.conf import settings
from django.contrib.auth import authenticate
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .models import Booking, Campaign, Contact, Conversation, Message, QuickReply, Service, Staff, Template, WhatsAppConfig
from .services import analytics as A
from .services.messaging import (
    MessagingError, cloud_api, draft_for, ensure_conversation, fmt_time, record, send_reminder,
    send_template, send_text, template_values,
)
from .shapes import (
    booking_out, campaign_brief, contact_out, contact_stats, conv_out, from_ms, initials, message_out, ms, recall_due,
    staff_brief, staff_out, template_out, waiting_since, whatsapp_out, workspace_out,
)

logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, message: str, code: int = 400):
        super().__init__(message)
        self.code = code


def exception_handler(exc, context):
    if isinstance(exc, (ApiError, MessagingError)):
        return Response({"error": str(exc)}, status=getattr(exc, "code", 400))
    resp = drf_exception_handler(exc, context)
    if resp is not None and isinstance(resp.data, dict) and "detail" in resp.data:
        resp.data = {"error": str(resp.data["detail"])}
    return resp


def me(request) -> Staff:
    staff = getattr(request.user, "staff", None)
    if staff is None:
        raise ApiError("Your user isn't linked to a team member. Run `python manage.py seed_demo` or link it in /admin.", 403)
    return staff


def ws_of(request):
    return me(request).workspace


def today_local(ws) -> date:
    return A.local_date(timezone.now(), ws.timezone)


def parse_day(s: str | None, ws) -> date:
    return date.fromisoformat(s) if s else today_local(ws)


def providers(ws):
    return ws.staff.filter(is_agent=False, active=True)


BOOKING_REL = ("contact", "staff", "service")


# =========================================================================== auth
@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    user = authenticate(username=request.data.get("username", ""), password=request.data.get("password", ""))
    if not user:
        return Response({"error": "Wrong username or password."}, status=401)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key})


# =========================================================================== bootstrap & search
@api_view(["GET"])
def bootstrap(request):
    staff = me(request)
    ws = staff.workspace
    cfg, _ = WhatsAppConfig.objects.get_or_create(workspace=ws)
    return Response({
        "mode": "live",
        "now": ms(timezone.now()),
        "clock": "live",
        "workspace": workspace_out(ws),
        "whatsapp": whatsapp_out(cfg, request.build_absolute_uri("/api/webhooks/whatsapp/")),
        "staff": [staff_out(s) for s in ws.staff.all()],
        "services": [{"id": s.id, "name": s.name, "minutes": s.minutes, "price": s.price, "color": s.color, "staff": list(s.staff.values_list("id", flat=True))} for s in ws.services.prefetch_related("staff")],
        "templates": [template_out(t) for t in ws.templates.all()],
        "quick_replies": list(ws.quick_replies.values("id", "title", "body")),
        "me": {**staff_out(staff), "initials": initials(staff.name)},
        "inbox_unread": ws.conversations.filter(status="open", unread__gt=0).count(),
        "storage_kb": 0,
        "simulator": bool(settings.ENABLE_SIMULATOR),
    })


@api_view(["GET"])
def search(request):
    ws = ws_of(request)
    q = (request.query_params.get("q") or "").strip()
    if not q:
        return Response({"contacts": [], "conversations": []})
    digits = "".join(ch for ch in q if ch.isdigit())
    cq = Q(name__icontains=q) | Q(email__icontains=q)
    if len(digits) > 2:
        cq |= Q(wa_id__contains=digits)
    contacts = [{"id": c.id, "name": c.name, "phone": c.phone, "initials": initials(c.name), "tags": c.tags} for c in ws.contacts.filter(cq)[:6]]
    msgs = Message.objects.filter(conversation__workspace=ws, body__icontains=q).select_related("conversation__contact").order_by("-created_at")[:6]
    conversations = [{"id": m.conversation_id, "contact": m.conversation.contact.name, "body": m.body, "created_at": ms(m.created_at)} for m in msgs]
    return Response({"contacts": contacts, "conversations": conversations})


# =========================================================================== today
@api_view(["GET"])
def today(request):
    ws = ws_of(request)
    now = timezone.now()
    d = today_local(ws)
    start, end = A.day_bounds(d, ws.timezone)
    todays = list(ws.bookings.filter(start__gte=start, start__lt=end).exclude(status="cancelled").select_related(*BOOKING_REL).order_by("start"))
    expected = [b for b in todays if b.status in ("booked", "confirmed")]
    waiting = sorted([b for b in todays if b.status == "arrived"], key=lambda b: b.arrived_at or now)
    in_service = [b for b in todays if b.status == "in_service"]
    done = sorted([b for b in todays if b.status == "done"], key=lambda b: b.finished_at or b.end, reverse=True)
    waits = [(now - b.arrived_at).total_seconds() / 60 for b in waiting if b.arrived_at]
    open_convs = [conv_out(c, now) for c in ws.conversations.filter(status="open").select_related("contact", "assignee")]
    open_convs.sort(key=lambda c: ((c["unread"] > 0), c["urgent"], (c["last"] or {}).get("created_at") or 0), reverse=True)
    busy = {b.staff_id for b in in_service}
    resources = ws.staff.filter(active=True).exclude(resource__isnull=True).exclude(resource="")
    last30 = list(ws.bookings.filter(start__gte=now - timedelta(days=30), start__lt=now).values("status"))
    rem_start = from_ms((ws.reminders or {}).get("started_at"))
    before = list(ws.bookings.filter(start__lt=rem_start).values("status")) if rem_start else []
    t_start, t_end = A.day_bounds(d + timedelta(days=1), ws.timezone)
    tomorrow_unreminded = ws.bookings.filter(start__gte=t_start, start__lt=t_end, status__in=("booked", "confirmed"), reminder="none", contact__opt_in="opted_in").count()
    msgs = list(Message.objects.filter(conversation__workspace=ws, created_at__gte=now - timedelta(days=8)).exclude(kind__in=("event", "note")).order_by("conversation_id", "created_at").values("conversation_id", "direction", "author", "created_at"))
    return Response({
        "now": ms(now),
        "stats": {
            "appointments_today": len(todays),
            "seen": len(done),
            "waiting": len(waiting),
            "avg_wait_min": round(sum(waits) / len(waits)) if waits else 0,
            "unread_whatsapp": ws.conversations.filter(status="open", unread__gt=0).count(),
            "median_reply_min": A.med(A.reply_minutes(msgs, now - timedelta(days=7))),
            "no_show_30d": A.no_show_rate(last30),
            "no_show_before": A.no_show_rate(before),
        },
        "flow": {k: [booking_out(b, now) for b in v] for k, v in (("expected", expected), ("waiting", waiting), ("in_service", in_service), ("done", done))},
        "resources_free": sum(1 for r in resources if r.id not in busy),
        "whatsapp": open_convs[:7],
        "waiting_on_us": sum(1 for c in open_convs if c["waiting_since"]),
        "tomorrow_unreminded": tomorrow_unreminded,
    })


# =========================================================================== bookings
@api_view(["GET", "POST"])
def bookings(request):
    ws = ws_of(request)
    if request.method == "GET":
        q = request.query_params
        qs = ws.bookings.select_related(*BOOKING_REL)
        if q.get("from"):
            qs = qs.filter(start__gte=A.day_bounds(date.fromisoformat(q["from"]), ws.timezone)[0])
        if q.get("to"):
            qs = qs.filter(start__lt=A.day_bounds(date.fromisoformat(q["to"]), ws.timezone)[1])
        if q.get("contact_id"):
            qs = qs.filter(contact_id=q["contact_id"])
        return Response([booking_out(b) for b in qs.order_by("start")[:2000]])

    body = request.data
    with transaction.atomic():
        contact = None
        if body.get("contact_id"):
            contact = ws.contacts.filter(pk=body["contact_id"]).first()
        elif body.get("contact"):
            contact = _create_contact(ws, body["contact"])
        if not contact:
            raise ApiError("Choose a contact.")
        svc = ws.services.filter(pk=body.get("service_id")).first()
        staff = ws.staff.filter(pk=body.get("staff_id")).first()
        if not svc or not staff:
            raise ApiError("Choose a service and a team member.")
        start = from_ms(body.get("start"))
        end = start + timedelta(minutes=svc.minutes)
        clash = ws.bookings.select_for_update().filter(staff=staff, start__lt=end, end__gt=start).exclude(status__in=("cancelled", "no_show")).select_related("contact").first()
        if clash:
            raise ApiError(f"{staff.name} already has {clash.contact.name} at {fmt_time(clash.start, ws)}.", 409)
        b = Booking.objects.create(workspace=ws, contact=contact, staff=staff, service=svc, start=start, end=end, source=body.get("source") or "phone", note=body.get("note") or "")
    if body.get("send_confirmation") and contact.opt_in == "opted_in":
        t = ws.templates.filter(name="booking_confirmation", status="approved").first()
        if t:
            try:
                send_template(ensure_conversation(contact), t, template_values(t, contact=contact, ws=ws, booking=b), author="system", author_name="Auto", booking=b)
            except MessagingError as exc:
                logger.warning("Confirmation not sent: %s", exc)
    return Response(booking_out(b))


@api_view(["GET", "PATCH"])
def booking_detail(request, pk: int):
    ws = ws_of(request)
    b = ws.bookings.select_related(*BOOKING_REL).filter(pk=pk).first()
    if not b:
        raise ApiError("Booking not found", 404)
    if request.method == "PATCH":
        body = request.data
        if body.get("service_id"):
            b.service = ws.services.get(pk=body["service_id"])
        if body.get("staff_id"):
            b.staff = ws.staff.get(pk=body["staff_id"])
        if body.get("start"):
            b.start = from_ms(body["start"])
            b.end = b.start + timedelta(minutes=b.service.minutes)
            b.reminder, b.reminder_at = "none", None
            if b.status == "confirmed":
                b.status = "booked"
        for k in ("note", "status"):
            if k in body:
                setattr(b, k, body[k])
        b.save()
    return Response(booking_out(b))


@api_view(["POST"])
def booking_action(request, pk: int):
    ws = ws_of(request)
    b = ws.bookings.select_related(*BOOKING_REL).filter(pk=pk).first()
    if not b:
        raise ApiError("Booking not found", 404)
    now = timezone.now()
    a = request.data.get("action")
    if a == "check_in":
        b.status, b.arrived_at = "arrived", now
    elif a == "start":
        b.status, b.started_at, b.arrived_at = "in_service", now, b.arrived_at or now
    elif a == "finish":
        b.status, b.finished_at = "done", now
    elif a in ("no_show", "cancel"):
        b.status = "no_show" if a == "no_show" else "cancelled"
    elif a == "undo":
        if b.status == "done":
            b.status, b.finished_at = "in_service", None
        elif b.status == "in_service":
            b.status, b.started_at = "arrived", None
        elif b.status == "arrived":
            b.status, b.arrived_at = ("confirmed" if b.reminder == "confirmed" else "booked"), None
        elif b.status in ("no_show", "cancelled"):
            b.status = "booked"
    else:
        raise ApiError("Unknown action")
    b.save()
    return Response(booking_out(b, now))


@api_view(["POST"])
def booking_remind(request, pk: int):
    ws = ws_of(request)
    b = ws.bookings.select_related(*BOOKING_REL).filter(pk=pk).first()
    if not b:
        raise ApiError("Booking not found", 404)
    if not send_reminder(b):
        raise ApiError("This contact has not opted in to WhatsApp, or the send failed.")
    b.refresh_from_db()
    return Response(booking_out(b))


@api_view(["POST"])
def remind_tomorrow(request):
    ws = ws_of(request)
    s, e = A.day_bounds(today_local(ws) + timedelta(days=1), ws.timezone)
    sent = skipped = 0
    for b in ws.bookings.filter(start__gte=s, start__lt=e, status__in=("booked", "confirmed"), reminder="none").select_related(*BOOKING_REL, "workspace"):
        try:
            if send_reminder(b):
                sent += 1
            else:
                skipped += 1
        except MessagingError:
            skipped += 1
    return Response({"sent": sent, "skipped": skipped})


@api_view(["GET"])
def schedule(request):
    ws = ws_of(request)
    q = request.query_params
    now = timezone.now()
    today_d = today_local(ws)
    d = parse_day(q.get("date"), ws)
    view = "week" if q.get("view") == "week" else "day"
    days = [d]
    if view == "week":
        monday = d - timedelta(days=d.weekday())
        days = [monday + timedelta(days=i) for i in range(7)]
    start, _ = A.day_bounds(days[0], ws.timezone)
    _, end = A.day_bounds(days[-1], ws.timezone)
    qs = ws.bookings.filter(start__gte=start, start__lt=end).select_related(*BOOKING_REL)
    if q.get("cancelled") != "1":
        qs = qs.exclude(status="cancelled")
    rows = list(qs.order_by("start"))
    provs = list(providers(ws))
    n = len(provs) or 1
    util = {}
    for p in provs:
        mins = sum((b.end - b.start).total_seconds() / 60 for b in rows if b.staff_id == p.id and b.status != "cancelled")
        cap = sum(A.capacity_minutes(ws.hours, ws.lunch, k, n) / n for k in days)
        util[p.id] = min(1, mins / cap) if cap else 0
    ts, te = A.day_bounds(today_d, ws.timezone)
    today_rows = list(ws.bookings.filter(start__gte=ts, start__lt=te).exclude(status="cancelled").values("start", "end"))
    booked_min = sum((r["end"] - r["start"]).total_seconds() / 60 for r in today_rows)
    cap = A.capacity_minutes(ws.hours, ws.lunch, today_d, n)
    hrs = A.hours_for(ws.hours, today_d)
    rem_cap = max(0, hrs[1] - max(hrs[0], A.minutes_of_day(now, ws.timezone))) * n if hrs else 0
    rem_booked = sum((r["end"] - max(r["start"], now)).total_seconds() / 60 for r in today_rows if r["end"] > now)
    ms_, me_ = A.day_bounds(today_d + timedelta(days=1), ws.timezone)
    tomorrow = ws.bookings.filter(start__gte=ms_, start__lt=me_).exclude(status="cancelled")
    slot = ws.slot_minutes or 15
    return Response({
        "date": d.isoformat(), "view": view, "days": [k.isoformat() for k in days], "today": today_d.isoformat(),
        "stats": {
            "appointments_today": len(today_rows),
            "booked_capacity": booked_min / cap if cap else 0,
            "open_slots": max(0, round((rem_cap - rem_booked) / (slot * 3))),
            "confirmed_tomorrow": tomorrow.filter(status="confirmed").count(),
            "tomorrow_total": tomorrow.count(),
        },
        "utilization": util,
        "bookings": [booking_out(b, now) for b in rows],
        "tomorrow_unreminded": tomorrow.filter(reminder="none", status__in=("booked", "confirmed"), contact__opt_in="opted_in").count(),
    })


# =========================================================================== conversations
@api_view(["GET", "POST"])
def conversations(request):
    staff = me(request)
    ws = staff.workspace
    if request.method == "POST":
        contact = ws.contacts.filter(pk=request.data.get("contact_id")).first()
        if not contact:
            raise ApiError("Contact not found", 404)
        return Response(conv_out(ensure_conversation(contact, assignee=staff)))
    q = request.query_params
    f = q.get("filter") or "all"
    base = ws.conversations.select_related("contact", "assignee")
    qs = base.filter(status="resolved" if f == "resolved" else "open")
    if f == "unread":
        qs = qs.filter(unread__gt=0)
    elif f == "mine":
        qs = qs.filter(assignee=staff)
    elif f == "unassigned":
        qs = qs.filter(assignee__isnull=True)
    if q.get("q"):
        s = q["q"]
        digits = "".join(ch for ch in s if ch.isdigit())
        cond = Q(contact__name__icontains=s) | Q(messages__body__icontains=s)
        if digits:
            cond |= Q(contact__wa_id__contains=digits)
        qs = qs.filter(cond).distinct()
    now = timezone.now()
    items = [conv_out(c, now) for c in qs[:300]]
    items.sort(key=lambda c: (c["pinned"], (c["last"] or {}).get("created_at") or 0), reverse=True)
    open_ = base.filter(status="open")
    return Response({
        "items": items,
        "counts": {
            "all": open_.count(),
            "unread": open_.filter(unread__gt=0).count(),
            "mine": open_.filter(assignee=staff).count(),
            "unassigned": open_.filter(assignee__isnull=True).count(),
            "resolved": base.filter(status="resolved").count(),
        },
    })


def _conv(request, pk) -> Conversation:
    c = ws_of(request).conversations.select_related("contact", "assignee", "workspace").filter(pk=pk).first()
    if not c:
        raise ApiError("Conversation not found", 404)
    return c


@api_view(["GET", "PATCH"])
def conversation_detail(request, pk: int):
    c = _conv(request, pk)
    if request.method == "PATCH":
        body = request.data
        staff = me(request)
        for k in ("status", "labels", "pinned", "ai_mode", "urgent"):
            if k in body:
                setattr(c, k, body[k])
        if "assignee_id" in body:
            c.assignee = c.workspace.staff.filter(pk=body["assignee_id"]).first() if body["assignee_id"] else None
            if c.assignee:
                record(c, direction="out", author="event", kind="event", body=f"Assigned to {c.assignee.name}")
        if body.get("status") == "resolved":
            c.unread = 0
            record(c, direction="out", author="event", kind="event", body=f"Resolved by {staff.name}")
        c.save()
        return Response(conv_out(c))
    return Response({
        **conv_out(c),
        "messages": [message_out(m) for m in c.messages.all()],
        "contact": contact_out(c.contact, full=True),
    })


@api_view(["POST"])
def conversation_messages(request, pk: int):
    c = _conv(request, pk)
    staff = me(request)
    body = request.data
    if body.get("note"):
        m = record(c, direction="out", author="agent", author_name=staff.name, kind="note", body=body.get("body", ""))
    elif body.get("template_id"):
        t = c.workspace.templates.filter(pk=body["template_id"]).first()
        if not t:
            raise ApiError("Template not found", 404)
        st = contact_stats(c.contact)
        nb = c.contact.bookings.filter(pk=st["next_booking"]["id"]).select_related(*BOOKING_REL).first() if st["next_booking"] else None
        values = body.get("values") or template_values(t, contact=c.contact, ws=c.workspace, booking=nb, last_staff=(st["last_visit"] or {}).get("staff"))
        m = send_template(c, t, values, author="agent", author_name=staff.name, booking=nb)
    else:
        m = send_text(c, body.get("body", ""), author="agent", author_name=staff.name)
        if c.ai_mode == "auto":
            c.ai_mode = "assist"  # a human stepped in
    c.unread = 0
    if not c.assignee_id:
        c.assignee = staff
    c.save()
    if m.status == "failed":
        raise ApiError(f"WhatsApp didn't accept the message: {m.error}", 502)
    return Response(message_out(m))


@api_view(["POST"])
def conversation_read(request, pk: int):
    c = _conv(request, pk)
    c.unread = 0
    c.save(update_fields=["unread"])
    return Response(conv_out(c))


@api_view(["POST"])
def conversation_suggest(request, pk: int):
    return Response(draft_for(_conv(request, pk)))


@api_view(["GET"])
def inbox_stats(request):
    ws = ws_of(request)
    now = timezone.now()
    open_ = [conv_out(c, now) for c in ws.conversations.filter(status="open").select_related("contact", "assignee")]
    waiting = sorted([c for c in open_ if c["waiting_since"]], key=lambda c: c["waiting_since"])
    msgs = list(Message.objects.filter(conversation__workspace=ws, created_at__gte=now - timedelta(days=8)).exclude(kind__in=("event", "note")).order_by("conversation_id", "created_at").values("conversation_id", "direction", "author", "created_at"))
    return Response({
        "unread": sum(1 for c in open_ if c["unread"] > 0),
        "waiting": len(waiting),
        "median_reply_min": A.med(A.reply_minutes(msgs, now - timedelta(days=7))),
        "open": len(open_),
        "waiting_list": [{"id": c["id"], "name": c["contact"]["name"], "initials": c["contact"]["initials"], "since": c["waiting_since"], "urgent": c["urgent"]} for c in waiting],
        "window_closed": sum(1 for c in open_ if not c["window_open"]),
    })


# =========================================================================== contacts
def _create_contact(ws, body) -> Contact:
    name, phone = (body.get("name") or "").strip(), (body.get("phone") or "").strip()
    if not name or not phone:
        raise ApiError("Name and phone are required.")
    wa = "".join(ch for ch in phone if ch.isdigit())
    if ws.contacts.filter(wa_id=wa).exists():
        raise ApiError("A contact with this phone number already exists.", 409)
    opt = body.get("opt_in") or "pending"
    return Contact.objects.create(
        workspace=ws, name=name, phone=phone, email=body.get("email") or "", gender=body.get("gender") or "",
        tags=body.get("tags") or ["New"], opt_in=opt, opt_in_at=timezone.now() if opt == "opted_in" else None,
        owner=ws.staff.filter(pk=body.get("owner_id")).first() if body.get("owner_id") else None,
        source=body.get("source") or "walk_in", notes=body.get("notes") or "",
    )


@api_view(["GET", "POST"])
def contacts(request):
    ws = ws_of(request)
    if request.method == "POST":
        return Response(contact_out(_create_contact(ws, request.data)))
    q = request.query_params
    now = timezone.now()
    qs = ws.contacts.select_related("owner")
    if q.get("q"):
        s = q["q"]
        digits = "".join(ch for ch in s if ch.isdigit())
        cond = Q(name__icontains=s) | Q(email__icontains=s)
        if len(digits) > 2:
            cond |= Q(wa_id__contains=digits)
        qs = qs.filter(cond)
    if q.get("opt_in") and q["opt_in"] != "all":
        qs = qs.filter(opt_in=q["opt_in"])
    if q.get("owner_id"):
        qs = qs.filter(owner_id=q["owner_id"])
    tag = q.get("tag")
    rows = list(qs)
    if tag and tag not in ("all", "Recall due"):
        rows = [c for c in rows if tag in (c.tags or [])]
    # Visit facts in bulk (avoid N+1 on 1000s of contacts)
    ids = [c.id for c in rows]
    done = {}
    for r in Booking.objects.filter(contact_id__in=ids, status="done").order_by("contact_id", "-start").values("contact_id", "start"):
        done.setdefault(r["contact_id"], []).append(r["start"])
    upcoming = {}
    for b in Booking.objects.filter(contact_id__in=ids, start__gt=now - timedelta(hours=1), status__in=("booked", "confirmed", "arrived", "in_service")).order_by("start").values("contact_id", "start", "status", "id"):
        upcoming.setdefault(b["contact_id"], b)

    def is_recall(c):
        return c.id not in upcoming and c.id in done and (now - done[c.id][0]) > timedelta(days=45)

    if tag == "Recall due":
        rows = [c for c in rows if is_recall(c)]
    sort, rev = q.get("sort") or "name", q.get("dir") == "desc"
    key = {
        "last_visit": lambda c: done.get(c.id, [datetime.min.replace(tzinfo=now.tzinfo)])[0],
        "next": lambda c: upcoming[c.id]["start"] if c.id in upcoming else datetime.max.replace(tzinfo=now.tzinfo),
        "visits": lambda c: len(done.get(c.id, [])),
        "created": lambda c: c.created_at,
    }.get(sort, lambda c: " ".join(reversed(c.name.split())).lower())
    rows.sort(key=key, reverse=rev)
    page, size = int(q.get("page") or 1), int(q.get("page_size") or 25)
    window = rows[(page - 1) * size: page * size]
    all_ = ws.contacts.all()
    month_start = A.day_bounds(today_local(ws).replace(day=1), ws.timezone)[0]
    tag_counts: dict[str, int] = {}
    for tags in all_.values_list("tags", flat=True):
        for t in tags or []:
            tag_counts[t] = tag_counts.get(t, 0) + 1
    # recall due across all contacts
    last_done = dict(Booking.objects.filter(workspace=ws, status="done").values("contact_id").annotate(n=Count("id")).values_list("contact_id", "n"))
    recent = set(Booking.objects.filter(workspace=ws, status="done", start__gt=now - timedelta(days=45)).values_list("contact_id", flat=True))
    has_next = set(Booking.objects.filter(workspace=ws, start__gt=now - timedelta(hours=1), status__in=("booked", "confirmed", "arrived", "in_service")).values_list("contact_id", flat=True))
    tag_counts["Recall due"] = len(set(last_done) - recent - has_next)
    total = all_.count() or 1
    return Response({
        "items": [contact_out(c, now=now) for c in window],
        "total": len(rows), "page": page, "page_size": size,
        "stats": {
            "total": all_.count(),
            "new_this_month": all_.filter(created_at__gte=month_start).count(),
            "opt_in_rate": all_.filter(opt_in="opted_in").count() / total,
            "recall_due": tag_counts["Recall due"],
        },
        "tag_counts": tag_counts,
        "opt_counts": {k: all_.filter(opt_in=k).count() for k in ("opted_in", "pending", "opted_out")},
    })


@api_view(["GET"])
def contacts_export(request):
    ws = ws_of(request)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Phone", "Email", "Tags", "WhatsApp", "Owner", "Visits", "Last visit", "Created"])
    visits = dict(Booking.objects.filter(workspace=ws, status="done").values("contact_id").annotate(n=Count("id")).values_list("contact_id", "n"))
    for c in ws.contacts.select_related("owner"):
        last = c.bookings.filter(status="done").order_by("-start").values_list("start", flat=True).first()
        w.writerow([c.name, c.phone, c.email, "; ".join(c.tags or []), c.opt_in, c.owner.name if c.owner else "", visits.get(c.id, 0), last.date().isoformat() if last else "", c.created_at.date().isoformat()])
    return Response({"filename": "contacts.csv", "csv": buf.getvalue()})


@api_view(["GET", "PATCH"])
def contact_detail(request, pk: int):
    ws = ws_of(request)
    c = ws.contacts.filter(pk=pk).first()
    if not c:
        raise ApiError("Contact not found", 404)
    if request.method == "PATCH":
        body = request.data
        for k in ("name", "phone", "email", "tags", "opt_in", "notes", "alerts", "language", "gender"):
            if k in body:
                setattr(c, k, body[k])
        if "owner_id" in body:
            c.owner = ws.staff.filter(pk=body["owner_id"]).first() if body["owner_id"] else None
        if body.get("opt_in") == "opted_in" and not c.opt_in_at:
            c.opt_in_at = timezone.now()
        c.save()
    return Response(contact_out(c, full=True))


# =========================================================================== templates & campaigns
@api_view(["GET", "POST"])
def templates(request):
    ws = ws_of(request)
    if request.method == "GET":
        return Response([template_out(t) for t in ws.templates.all()])
    b = request.data
    if not re.fullmatch(r"[a-z0-9_]+", b.get("name") or ""):
        raise ApiError("Template names use lowercase letters, numbers and underscores.")
    t = Template.objects.create(
        workspace=ws, name=b["name"], category=b.get("category") or "utility", language=b.get("language") or "en",
        status="pending", header=b.get("header") or None, body=b.get("body") or "", footer=b.get("footer") or None,
        buttons=b.get("buttons") or [], variables=b.get("variables") or [],
    )
    # Submitting to Meta (POST /{waba_id}/message_templates) needs a WABA id + token;
    # approval arrives via the message_template_status_update webhook.
    from .services.templates import submit_template

    submit_template(t)
    return Response(template_out(t))


@api_view(["PATCH", "DELETE"])
def template_detail(request, pk: int):
    ws = ws_of(request)
    t = ws.templates.filter(pk=pk).first()
    if not t:
        raise ApiError("Template not found", 404)
    if request.method == "DELETE":
        if t.campaigns.exclude(status="sent").exists():
            raise ApiError("This template is used by a campaign.")
        t.delete()
        return Response({"ok": True})
    b = request.data
    changed = "body" in b and b["body"] != t.body
    for k in ("category", "language", "header", "body", "footer", "buttons", "variables"):
        if k in b:
            setattr(t, k, b[k] or (None if k in ("header", "footer") else b[k]))
    if changed:
        t.status = "pending"
    t.save()
    if changed:
        from .services.templates import submit_template

        submit_template(t)
    return Response(template_out(t))


def audience(ws, c_aud: dict, now=None):
    now = now or timezone.now()
    qs = ws.contacts.all()
    rows = list(qs)
    if c_aud.get("type") == "tag":
        v = c_aud.get("value")
        if v == "Recall due":
            rows = [x for x in rows if recall_due(contact_stats(x, now), now)]
        else:
            rows = [x for x in rows if v in (x.tags or [])]
    ok = [x for x in rows if x.opt_in == "opted_in"]
    return {"pool": rows, "ok": ok, "excluded": len(rows) - len(ok),
            "opted_out": sum(1 for x in rows if x.opt_in == "opted_out"), "pending": sum(1 for x in rows if x.opt_in == "pending")}


def campaign_out(c: Campaign) -> dict:
    ws = c.workspace
    a = audience(ws, c.audience or {})
    t = c.template
    sample = a["ok"][0] if a["ok"] else ws.contacts.first()
    values = template_values(t, contact=sample, ws=ws, last_staff="Aarav") if sample else []
    from .services.whatsapp import render_template

    return {
        **campaign_brief(c),
        "template": template_out(t),
        "preview": {"header": render_template(t.header, values, {"business_name": ws.name}), "body": render_template(t.body, values, {"business_name": ws.name}), "buttons": t.buttons, "sample_name": (sample.name.split(" ")[0] if sample else "")},
        "audience_count": c.stats["recipients"] if c.stats else len(a["ok"]),
        "excluded": c.stats["excluded"] if c.stats else a["excluded"],
        "excluded_detail": {"opted_out": a["opted_out"], "pending": a["pending"]},
    }


@api_view(["GET", "POST"])
def campaigns(request):
    ws = ws_of(request)
    if request.method == "POST":
        b = request.data
        t = ws.templates.filter(pk=b.get("template_id")).first()
        if not t:
            raise ApiError("Pick a template.")
        sched = from_ms(b.get("scheduled_at"))
        c = Campaign.objects.create(workspace=ws, name=b.get("name") or "Untitled broadcast", template=t, audience=b.get("audience") or {"type": "all"}, status="scheduled" if sched else "draft", scheduled_at=sched)
        return Response(campaign_out(c))
    order = {"scheduled": 0, "sending": 0, "draft": 1, "sent": 2}
    items = sorted(ws.campaigns.select_related("template", "workspace"), key=lambda c: (order.get(c.status, 3), -c.created_at.timestamp()))
    sent = [c for c in items if c.stats]
    s = lambda k: sum(c.stats.get(k, 0) for c in sent)  # noqa: E731
    reminders = ws.bookings.exclude(reminder="none").count()
    tags = sorted({t for tags in ws.contacts.values_list("tags", flat=True) for t in (tags or [])})
    return Response({
        "items": [campaign_out(c) for c in items],
        "stats": {
            "messages_sent": s("sent") + reminders,
            "read_rate": s("read") / s("delivered") if s("delivered") else 0,
            "reply_rate": s("replied") / s("delivered") if s("delivered") else 0,
            "bookings": s("booked"),
        },
        "audiences": ["all", *tags, "Recall due"],
    })


def _campaign(request, pk) -> Campaign:
    c = ws_of(request).campaigns.select_related("template", "workspace").filter(pk=pk).first()
    if not c:
        raise ApiError("Campaign not found", 404)
    return c


@api_view(["PATCH", "DELETE"])
def campaign_detail(request, pk: int):
    c = _campaign(request, pk)
    if request.method == "DELETE":
        if c.status == "sent":
            raise ApiError("Sent campaigns are kept for reporting.")
        c.delete()
        return Response({"ok": True})
    b = request.data
    if "name" in b:
        c.name = b["name"]
    if "template_id" in b:
        c.template = c.workspace.templates.get(pk=b["template_id"])
    if "audience" in b:
        c.audience = b["audience"]
    if "scheduled_at" in b:
        c.scheduled_at = from_ms(b["scheduled_at"])
        c.status = "scheduled" if c.scheduled_at else "draft"
    c.save()
    return Response(campaign_out(c))


@api_view(["POST"])
def campaign_send(request, pk: int):
    from .services.campaigns import send_campaign

    c = _campaign(request, pk)
    send_campaign(c)
    return Response(campaign_out(c))


@api_view(["POST"])
def campaign_duplicate(request, pk: int):
    c = _campaign(request, pk)
    n = Campaign.objects.create(workspace=c.workspace, name=f"{c.name} (copy)", template=c.template, audience=c.audience)
    return Response(campaign_out(n))


@api_view(["POST"])
def campaign_cancel(request, pk: int):
    c = _campaign(request, pk)
    c.status, c.scheduled_at = "draft", None
    c.save()
    return Response(campaign_out(c))


# =========================================================================== reports
@api_view(["GET"])
def reports(request):
    ws = ws_of(request)
    weeks = int(request.query_params.get("weeks") or 12)
    now = timezone.now()
    tz = ws.timezone
    today_d = today_local(ws)
    starts = A.week_starts(today_d, weeks)
    frm = A.day_bounds(starts[0], tz)[0]
    rows = list(ws.bookings.filter(start__gte=frm, start__lt=now).values("id", "status", "start", "end", "staff_id", "service_id", "source", "started_at", "reminder", "reminder_at"))
    future_rows = list(ws.bookings.filter(start__gte=now, start__lt=A.day_bounds(starts[-1] + timedelta(days=6), tz)[1]).exclude(status="cancelled").values("start"))
    rem_start = from_ms((ws.reminders or {}).get("started_at"))
    before = list(ws.bookings.filter(start__lt=rem_start).values("status")) if rem_start else []
    after = list(ws.bookings.filter(start__gte=rem_start, start__lt=now).values("status")) if rem_start else []
    weekly = []
    this_monday = starts[-1]
    for k in starts:
        f, t = A.day_bounds(k, tz)[0], A.day_bounds(k + timedelta(days=6), tz)[1]
        wk = [r for r in rows if f <= r["start"] < t and r["status"] != "cancelled"]
        fut = sum(1 for r in future_rows if f <= r["start"] < t)
        weekly.append({"week": k.isoformat(), "done": sum(1 for r in wk if r["status"] == "done"), "booked": len(wk) + fut, "no_show_rate": A.no_show_rate(wk), "partial": k == this_monday})
    rems = [r for r in rows if r["reminder"] != "none" and r["reminder_at"] and r["reminder_at"] >= frm]
    cnt = lambda f: sum(1 for r in rems if f(r))  # noqa: E731
    funnel = {
        "sent": len(rems),
        "delivered": cnt(lambda r: r["reminder"] not in ("failed", "sent")),
        "read": cnt(lambda r: r["reminder"] in ("read", "confirmed", "reschedule")),
        "confirmed": cnt(lambda r: r["reminder"] == "confirmed"),
        "reschedule": cnt(lambda r: r["reminder"] == "reschedule"),
        "failed": cnt(lambda r: r["reminder"] == "failed"),
    }
    done = [r for r in rows if r["status"] == "done"]
    mix = sorted(({"id": s.id, "name": s.name, "color": s.color, "count": sum(1 for r in done if r["service_id"] == s.id)} for s in ws.services.all()), key=lambda x: -x["count"])
    provs = list(providers(ws))
    n = len(provs) or 1
    open_days = sum(1 for k in starts for i in range(7) if (k + timedelta(days=i)) <= today_d and A.hours_for(ws.hours, k + timedelta(days=i)))
    per_day = (A.capacity_minutes(ws.hours, ws.lunch, today_d, n) / n) or 540
    staff_rows = []
    for p in provs:
        mine = [r for r in rows if r["staff_id"] == p.id]
        mins = sum((r["end"] - r["start"]).total_seconds() / 60 for r in mine if r["status"] != "cancelled")
        delays = [max(0, (r["started_at"] - r["start"]).total_seconds() / 60) for r in mine if r["started_at"]]
        staff_rows.append({
            "staff": staff_brief(p), "visits": sum(1 for r in mine if r["status"] == "done"),
            "capacity": min(1, mins / (open_days * per_day or 1)), "no_show_rate": A.no_show_rate(mine),
            "avg_start_delay": round(sum(delays) / len(delays)) if delays else 0,
        })
    staff_rows.sort(key=lambda x: -x["visits"])
    msgs = list(Message.objects.filter(conversation__workspace=ws, created_at__gte=frm).exclude(kind__in=("event", "note")).order_by("conversation_id", "created_at").values("conversation_id", "direction", "author", "created_at"))
    replies = A.reply_minutes(msgs, frm)
    convs = ws.conversations.all()
    open_convs = list(convs.filter(status="open"))
    settled = [r for r in rows if r["status"] in A.SETTLED]
    return Response({
        "weeks": weeks, "from": starts[0].isoformat(), "to": today_d.isoformat(),
        "stats": {
            "visits": len(done),
            "no_show_rate": A.no_show_rate(settled),
            "no_show_delta": A.no_show_rate(settled) - A.no_show_rate(before),
            "median_reply_min": A.med(replies),
            "reminders_confirmed": funnel["confirmed"] / funnel["sent"] if funnel["sent"] else 0,
        },
        "no_show": {"weekly": [{"week": w["week"], "rate": w["no_show_rate"]} for w in weekly], "reminders_started": ms(rem_start), "before": A.no_show_rate(before), "after": A.no_show_rate(after)},
        "funnel": funnel,
        "visits_weekly": [{"week": w["week"], "done": w["done"], "booked": w["booked"], "partial": w["partial"]} for w in weekly],
        "visits_booked_total": sum(1 for r in rows if r["status"] != "cancelled"),
        "service_mix": mix,
        "heatmap": A.heatmap(rows, tz, ws.hours, ws.lunch),
        "sources": [{"source": s, "count": sum(1 for r in rows if r["source"] == s and r["status"] != "cancelled")} for s in ("whatsapp", "phone", "website", "walk_in")],
        "staff": staff_rows,
        "inbox": {
            "median_reply_min": A.med(replies),
            "open": len(open_convs),
            "waiting": sum(1 for c in open_convs if waiting_since(c)),
            "resolved": convs.filter(status="resolved").count(),
            "labels": [{**l, "count": sum(1 for c in convs if l["name"] in (c.labels or []))} for l in ws.labels],
            "ai_handled": Message.objects.filter(conversation__workspace=ws, author="ai").count(),
        },
    })


# =========================================================================== settings
def _merge(cur, new):
    if isinstance(cur, dict) and isinstance(new, dict):
        return {**cur, **new}
    return new


@api_view(["PATCH"])
def settings_workspace(request):
    ws = ws_of(request)
    fields = ("name", "tagline", "industry", "phone", "email", "address", "timezone", "slot_minutes", "hours", "lunch", "labels", "reminders", "auto_replies", "ai", "privacy", "appearance")
    for k, v in request.data.items():
        if k not in fields:
            continue
        if k == "timezone":
            from zoneinfo import ZoneInfo

            ZoneInfo(v)  # raises for unknown zones
        setattr(ws, k, _merge(getattr(ws, k), v) if k in ("reminders", "auto_replies", "ai", "privacy", "appearance") else v)
    ws.save()
    return Response(workspace_out(ws))


@api_view(["PATCH"])
def settings_whatsapp(request):
    ws = ws_of(request)
    cfg, _ = WhatsAppConfig.objects.get_or_create(workspace=ws)
    for k in ("phone_number_id", "waba_id", "verify_token", "display_phone", "verified_name"):
        if k in request.data:
            setattr(cfg, k, (request.data[k] or "").strip())
    if request.data.get("access_token"):
        cfg.access_token = request.data["access_token"].strip()
    if request.data.get("app_secret"):
        cfg.app_secret = request.data["app_secret"].strip()
    # Pull the verified name / quality from Meta when we have live credentials
    info = cloud_api(ws).phone_number_info() if cfg.access_token and cfg.phone_number_id else {}
    if info:
        cfg.verified_name = info.get("verified_name") or cfg.verified_name
        cfg.display_phone = info.get("display_phone_number") or cfg.display_phone
        cfg.quality = (info.get("quality_rating") or cfg.quality).lower()
        tier = info.get("messaging_limit_tier") or ""
        cfg.messaging_limit = {"TIER_1K": "1K", "TIER_10K": "10K", "TIER_100K": "100K", "TIER_UNLIMITED": "Unlimited"}.get(tier, cfg.messaging_limit)
    cfg.connected = True
    cfg.save()
    return Response(whatsapp_out(cfg, request.build_absolute_uri("/api/webhooks/whatsapp/")))


@api_view(["POST"])
def whatsapp_test(request):
    ws = ws_of(request)
    to = request.data.get("to")
    if not to:
        raise ApiError("Enter a phone number to send a test to.")
    api = cloud_api(ws)
    # hello_world exists on every WhatsApp Business account and works outside the 24h window
    res = api.send_template(to, "hello_world", "en_US")
    if not res.ok:
        raise ApiError(f"Meta rejected the test: {res.error}", 502)
    msg = "Demo mode: add your access token to send for real." if res.demo else f"Sent hello_world to {to} — check your phone."
    return Response({"ok": True, "demo": res.demo, "message": msg})


@api_view(["POST"])
def whatsapp_disconnect(request):
    ws = ws_of(request)
    cfg, _ = WhatsAppConfig.objects.get_or_create(workspace=ws)
    cfg.connected = False
    cfg.access_token = ""
    cfg.save()
    return Response(whatsapp_out(cfg))


@api_view(["POST"])
def staff_create(request):
    ws = ws_of(request)
    b = request.data
    s = Staff.objects.create(workspace=ws, name=b.get("name") or "New teammate", role=b.get("role") or "", resource=b.get("resource") or None, color=b.get("color") or "slate", email=b.get("email") or "", is_agent=bool(b.get("is_agent")))
    return Response(staff_out(s))


@api_view(["PATCH"])
def staff_detail(request, pk: int):
    s = ws_of(request).staff.filter(pk=pk).first()
    if not s:
        raise ApiError("Not found", 404)
    for k in ("name", "role", "resource", "color", "email", "is_agent", "active"):
        if k in request.data:
            setattr(s, k, request.data[k])
    s.save()
    return Response(staff_out(s))


def _service_out(s: Service) -> dict:
    return {"id": s.id, "name": s.name, "minutes": s.minutes, "price": s.price, "color": s.color, "staff": list(s.staff.values_list("id", flat=True))}


@api_view(["POST"])
def service_create(request):
    ws = ws_of(request)
    b = request.data
    s = Service.objects.create(workspace=ws, name=b.get("name") or "Service", minutes=int(b.get("minutes") or 30), price=int(b.get("price") or 0), color=b.get("color") or "teal")
    s.staff.set(ws.staff.filter(pk__in=b.get("staff") or []))
    return Response(_service_out(s))


@api_view(["PATCH"])
def service_detail(request, pk: int):
    ws = ws_of(request)
    s = ws.services.filter(pk=pk).first()
    if not s:
        raise ApiError("Not found", 404)
    for k in ("name", "minutes", "price", "color"):
        if k in request.data:
            setattr(s, k, request.data[k])
    s.save()
    if "staff" in request.data:
        s.staff.set(ws.staff.filter(pk__in=request.data["staff"]))
    return Response(_service_out(s))


@api_view(["POST"])
def quick_reply_create(request):
    r = QuickReply.objects.create(workspace=ws_of(request), title=request.data.get("title", ""), body=request.data.get("body", ""))
    return Response({"id": r.id, "title": r.title, "body": r.body})


@api_view(["PATCH", "DELETE"])
def quick_reply_detail(request, pk: int):
    r = ws_of(request).quick_replies.filter(pk=pk).first()
    if not r:
        raise ApiError("Not found", 404)
    if request.method == "DELETE":
        r.delete()
        return Response({"ok": True})
    for k in ("title", "body"):
        if k in request.data:
            setattr(r, k, request.data[k])
    r.save()
    return Response({"id": r.id, "title": r.title, "body": r.body})


# =========================================================================== simulator
@api_view(["POST"])
def demo_inbound(request):
    """Feed a fake customer message through the real webhook pipeline (ENABLE_SIMULATOR)."""
    if not settings.ENABLE_SIMULATOR:
        raise ApiError("The simulator is disabled. Set ENABLE_SIMULATOR=True.", 403)
    from .services.whatsapp import InboundMessage
    from .services.messaging import process_inbound

    ws = ws_of(request)
    b = request.data
    contact = ws.contacts.filter(pk=b.get("contact_id")).first() if b.get("contact_id") else None
    wa_id = contact.wa_id if contact else "".join(ch for ch in (b.get("phone") or "") if ch.isdigit())
    if not wa_id:
        raise ApiError("Pick a contact or enter a phone number.")
    body = b.get("body") or ""
    kind = "button" if body.strip().lower() in ("confirm", "reschedule") else "text"
    inb = InboundMessage(wa_id=wa_id, profile_name=b.get("name") or (contact.name if contact else "Unknown"), text=body, kind=kind,
                         message_id=f"wamid.sim.{timezone.now().timestamp()}", phone_number_id=getattr(getattr(ws, "whatsapp", None), "phone_number_id", ""))
    conv = process_inbound(inb, ws)
    if conv is None:
        raise ApiError("Message ignored")
    last = conv.messages.filter(direction="in").order_by("-created_at").first()
    return Response({"conversation": conv_out(conv), "message": message_out(last)}, status=status.HTTP_200_OK)
