"""Load the demo business (same data as the browser demo) and an admin login.

    python manage.py seed_demo                 # creates admin / xeroura-demo
    python manage.py seed_demo --password s3cret --reset
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone as dt_tz
from pathlib import Path
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from crm.models import Booking, Campaign, Contact, Conversation, Message, QuickReply, Service, Staff, Template, WhatsAppConfig, Workspace

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "demo_seed.json"


class Command(BaseCommand):
    help = "Seed the demo workspace (Glow & Co. Studio) with contacts, bookings, chats and campaigns."

    def add_arguments(self, parser):
        parser.add_argument("--username", default="admin")
        parser.add_argument("--password", default="xeroura-demo")
        parser.add_argument("--reset", action="store_true", help="Delete existing workspaces first")

    @transaction.atomic
    def handle(self, *args, **opts):
        if opts["reset"]:
            Workspace.objects.all().delete()
        elif Workspace.objects.exists():
            self.stdout.write(self.style.WARNING("A workspace already exists — use --reset to replace it."))
            return
        data = json.loads(FIXTURE.read_text())
        tz = data["workspace"]["timezone"]
        anchor = date.fromisoformat(data["anchor"]["day"])
        shift_ms = (datetime.now(ZoneInfo(tz)).date() - anchor).days * 86_400_000

        def dt(v):
            return datetime.fromtimestamp((v + shift_ms) / 1000, tz=dt_tz.utc) if v is not None else None

        w = data["workspace"]
        reminders = dict(w["reminders"])
        if reminders.get("started_at"):
            reminders["started_at"] += shift_ms
        ws = Workspace.objects.create(
            name=w["name"], tagline=w["tagline"], industry=w["industry"], phone=w["phone"], email=w["email"],
            address=w["address"], timezone=tz, slot_minutes=w["slot_minutes"], hours=w["hours"], lunch=w["lunch"],
            labels=w["labels"], reminders=reminders, auto_replies=w["auto_replies"], ai=w["ai"], privacy=w["privacy"],
            appearance=w.get("appearance") or {},
        )
        wa = data["whatsapp"]
        WhatsAppConfig.objects.create(
            workspace=ws, phone_number_id="", waba_id="", verify_token=wa["verify_token"], display_phone=wa["display_phone"],
            verified_name=wa["verified_name"], quality=wa["quality"], messaging_limit=wa["messaging_limit"], connected=False,
            subscribed_fields=wa["subscribed_fields"],
        )
        staff = {}
        for s in data["staff"]:
            staff[s["id"]] = Staff.objects.create(workspace=ws, name=s["name"], role=s["role"], resource=s["resource"], color=s["color"], email=s["email"], is_agent=s["is_agent"], active=s["active"])
        services = {}
        for s in data["services"]:
            obj = Service.objects.create(workspace=ws, name=s["name"], minutes=s["minutes"], price=s["price"], color=s["color"])
            obj.staff.set([staff[i] for i in s["staff"]])
            services[s["id"]] = obj
        contacts = {}
        objs = []
        for c in data["contacts"]:
            o = Contact(workspace=ws, name=c["name"], phone=c["phone"], email=c["email"] or "", gender=c["gender"] or "", tags=c["tags"],
                        opt_in=c["opt_in"], opt_in_at=dt(c["opt_in_at"]), owner=staff.get(c["owner_id"]), source=c["source"],
                        language=c["language"], notes=c["notes"], alerts=c["alerts"], created_at=dt(c["created_at"]))
            o.wa_id = "".join(ch for ch in o.phone if ch.isdigit())
            objs.append((c["id"], o))
        Contact.objects.bulk_create([o for _, o in objs])
        for old, o in objs:
            contacts[old] = o
        bookings = {}
        bobjs = []
        for b in data["bookings"]:
            bobjs.append((b["id"], Booking(
                workspace=ws, contact=contacts[b["contact_id"]], staff=staff[b["staff_id"]], service=services[b["service_id"]],
                start=dt(b["start"]), end=dt(b["end"]), status=b["status"], source=b["source"], arrived_at=dt(b["arrived_at"]),
                started_at=dt(b["started_at"]), finished_at=dt(b["finished_at"]), reminder=b["reminder"], reminder_at=dt(b["reminder_at"]),
                note=b["note"], created_at=dt(b["created_at"]),
            )))
        Booking.objects.bulk_create([o for _, o in bobjs], batch_size=500)
        for old, o in bobjs:
            bookings[old] = o
        convs = {}
        for c in data["conversations"]:
            convs[c["id"]] = Conversation.objects.create(
                workspace=ws, contact=contacts[c["contact_id"]], status=c["status"], assignee=staff.get(c["assignee_id"]),
                labels=c["labels"], pinned=c["pinned"], ai_mode=c["ai_mode"], unread=c["unread"], urgent=c["urgent"],
                last_inbound_at=dt(c["last_inbound_at"]), created_at=dt(c["created_at"]), updated_at=dt(c["updated_at"]),
            )
        Message.objects.bulk_create([
            Message(conversation=convs[m["conversation_id"]], direction=m["direction"], author=m["author"], author_name=m["author_name"],
                    kind=m["kind"], body=m["body"], template=m["template"], status=m["status"], wa_id=m["wa_id"], created_at=dt(m["created_at"]))
            for m in data["messages"]
        ])
        templates = {}
        for t in data["templates"]:
            templates[t["id"]] = Template.objects.create(workspace=ws, name=t["name"], category=t["category"], language=t["language"], status=t["status"],
                                                         header=t["header"], body=t["body"], footer=t["footer"], buttons=t["buttons"], variables=t["variables"])
        for c in data["campaigns"]:
            Campaign.objects.create(workspace=ws, name=c["name"], template=templates[c["template_id"]], audience=c["audience"], status=c["status"],
                                    scheduled_at=dt(c["scheduled_at"]), sent_at=dt(c["sent_at"]), stats=c["stats"], created_at=dt(c["created_at"]))
        for q in data["quick_replies"]:
            QuickReply.objects.create(workspace=ws, title=q["title"], body=q["body"])
        # keyword rules point at quick reply ids → remap by position
        qr_ids = {q["id"]: obj.id for q, obj in zip(data["quick_replies"], ws.quick_replies.order_by("id"))}
        ar = dict(ws.auto_replies)
        ar["keywords"] = [{**k, "reply_id": qr_ids.get(k["reply_id"], k["reply_id"])} for k in ar.get("keywords", [])]
        ws.auto_replies = ar
        ws.save(update_fields=["auto_replies"])

        User = get_user_model()
        user, _ = User.objects.get_or_create(username=opts["username"], defaults={"email": "admin@example.com"})
        user.is_staff = user.is_superuser = True
        user.set_password(opts["password"])
        user.save()
        me = staff[data["me"]]
        Staff.objects.filter(user=user).exclude(pk=me.pk).update(user=None)
        me.user = user
        me.save(update_fields=["user"])
        self.stdout.write(self.style.SUCCESS(
            f"Seeded {ws.name}: {len(contacts)} contacts, {len(bookings)} bookings, {len(convs)} chats. "
            f"Sign in as {opts['username']} / {opts['password']} (front desk: {me.name})."
        ))
