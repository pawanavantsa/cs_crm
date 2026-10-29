"""Xeroura CRM data model.

One Workspace = one business. Every row hangs off a workspace so several businesses
can share a deployment (the CS Bot's "team" scoping, renamed).
"""
from __future__ import annotations

import re
import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone


def default_hours() -> dict:
    day = [540, 1140]  # minutes since midnight: 9:00–19:00
    return {"mon": day, "tue": day, "wed": day, "thu": day, "fri": day, "sat": [540, 1020], "sun": None}


def default_labels() -> list:
    return [
        {"name": "Booking", "color": "teal"},
        {"name": "Question", "color": "violet"},
        {"name": "Pricing", "color": "blue"},
        {"name": "Complaint", "color": "amber"},
        {"name": "Urgent", "color": "red"},
        {"name": "Needs human", "color": "rose"},
    ]


def default_reminders() -> dict:
    return {"enabled": True, "hours_before": 24, "send_at": "18:00", "template": "booking_reminder", "started_at": None}


def default_auto_replies() -> dict:
    return {
        "greeting_enabled": True,
        "greeting_message": "Hi! 👋 Thanks for messaging us. A teammate will reply shortly.",
        "away_enabled": True,
        "away_message": "We're closed right now — we'll get back to you as soon as we open.",
        "keywords": [],
    }


def default_ai() -> dict:
    return {
        "enabled": True,
        "mode": "assist",
        "instructions": "Be warm and brief. Never quote prices that are not in the services list.",
        "handoff_keywords": ["human", "manager", "person", "call me", "complaint", "refund"],
    }


def default_privacy() -> dict:
    return {"hide_notes_in_whatsapp": True, "retention_days": 730, "require_opt_in": True}


def digits(phone: str) -> str:
    """WhatsApp ids are the phone number in international format, digits only."""
    return re.sub(r"\D", "", phone or "")


class Workspace(models.Model):
    name = models.CharField(max_length=200)
    tagline = models.CharField(max_length=200, blank=True)
    industry = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=300, blank=True)
    timezone = models.CharField(max_length=64, default="Asia/Kolkata")
    slot_minutes = models.PositiveSmallIntegerField(default=15)
    hours = models.JSONField(default=default_hours)
    lunch = models.JSONField(null=True, blank=True, default=None)
    labels = models.JSONField(default=default_labels)
    reminders = models.JSONField(default=default_reminders)
    auto_replies = models.JSONField(default=default_auto_replies)
    ai = models.JSONField(default=default_ai)
    privacy = models.JSONField(default=default_privacy)
    appearance = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return self.name


class WhatsAppConfig(models.Model):
    """WhatsApp Business Cloud API credentials for a workspace (CS Bot: TeamWhatsAppConfig)."""

    workspace = models.OneToOneField(Workspace, on_delete=models.CASCADE, related_name="whatsapp")
    phone_number_id = models.CharField(max_length=64, blank=True, db_index=True)
    waba_id = models.CharField(max_length=64, blank=True)
    access_token = models.TextField(blank=True, help_text="System-user token. Encrypt at rest in production.")
    app_secret = models.CharField(max_length=128, blank=True, help_text="Verifies X-Hub-Signature-256 on webhooks.")
    verify_token = models.CharField(max_length=128, default="", blank=True)
    display_phone = models.CharField(max_length=40, blank=True)
    verified_name = models.CharField(max_length=200, blank=True)
    quality = models.CharField(max_length=20, default="high")
    messaging_limit = models.CharField(max_length=20, default="1K")
    connected = models.BooleanField(default=False)
    subscribed_fields = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.verify_token:
            self.verify_token = f"xcrm_{secrets.token_urlsafe(8)}"
        super().save(*args, **kwargs)

    @property
    def is_live(self) -> bool:
        return bool(self.access_token and self.phone_number_id)


class Staff(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="staff")
    user = models.OneToOneField(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="staff")
    name = models.CharField(max_length=120)
    role = models.CharField(max_length=120, blank=True)
    resource = models.CharField(max_length=80, blank=True, null=True, help_text="Chair, room or station")
    color = models.CharField(max_length=20, default="slate")
    email = models.EmailField(blank=True)
    is_agent = models.BooleanField(default=False, help_text="Works the inbox instead of taking bookings")
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return self.name


class Service(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="services")
    name = models.CharField(max_length=120)
    minutes = models.PositiveSmallIntegerField(default=30)
    price = models.PositiveIntegerField(default=0)
    color = models.CharField(max_length=20, default="teal")
    staff = models.ManyToManyField(Staff, blank=True, related_name="services")

    class Meta:
        ordering = ["id"]


class Contact(models.Model):
    OPT_IN = [("opted_in", "Opted in"), ("pending", "Pending"), ("opted_out", "Opted out")]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="contacts")
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=40)
    wa_id = models.CharField(max_length=32, db_index=True, help_text="Digits-only international number")
    email = models.EmailField(blank=True)
    gender = models.CharField(max_length=4, blank=True)
    tags = models.JSONField(default=list, blank=True)
    opt_in = models.CharField(max_length=12, choices=OPT_IN, default="pending")
    opt_in_at = models.DateTimeField(null=True, blank=True)
    owner = models.ForeignKey(Staff, null=True, blank=True, on_delete=models.SET_NULL, related_name="owned_contacts")
    source = models.CharField(max_length=30, default="whatsapp")
    language = models.CharField(max_length=40, default="English")
    notes = models.TextField(blank=True)
    alerts = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["workspace", "wa_id"], name="uniq_contact_wa_id")]
        ordering = ["name"]

    def save(self, *args, **kwargs):
        self.wa_id = digits(self.phone)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.name} ({self.phone})"


class Booking(models.Model):
    STATUS = [
        ("booked", "Booked"), ("confirmed", "Confirmed"), ("arrived", "Waiting"), ("in_service", "In service"),
        ("done", "Done"), ("no_show", "No-show"), ("cancelled", "Cancelled"),
    ]
    REMINDER = [
        ("none", "None"), ("sent", "Sent"), ("delivered", "Delivered"), ("read", "Read"),
        ("confirmed", "Confirmed"), ("reschedule", "Reschedule requested"), ("failed", "Failed"),
    ]
    ACTIVE = ("booked", "confirmed", "arrived", "in_service")

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="bookings")
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="bookings")
    staff = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="bookings")
    service = models.ForeignKey(Service, on_delete=models.PROTECT, related_name="bookings")
    start = models.DateTimeField(db_index=True)
    end = models.DateTimeField()
    status = models.CharField(max_length=12, choices=STATUS, default="booked", db_index=True)
    source = models.CharField(max_length=20, default="phone")
    arrived_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    reminder = models.CharField(max_length=12, choices=REMINDER, default="none")
    reminder_at = models.DateTimeField(null=True, blank=True)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["start"]


class Conversation(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="conversations")
    contact = models.OneToOneField(Contact, on_delete=models.CASCADE, related_name="conversation")
    status = models.CharField(max_length=10, default="open", db_index=True)
    assignee = models.ForeignKey(Staff, null=True, blank=True, on_delete=models.SET_NULL, related_name="conversations")
    labels = models.JSONField(default=list, blank=True)
    pinned = models.BooleanField(default=False)
    ai_mode = models.CharField(max_length=10, default="assist", help_text="auto | assist | off")
    unread = models.PositiveIntegerField(default=0)
    urgent = models.BooleanField(default=False)
    last_inbound_at = models.DateTimeField(null=True, blank=True, help_text="Starts the 24-hour customer-service window")
    whatsapp_phone_number_id = models.CharField(max_length=64, blank=True, help_text="Business number that received it")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)


class Message(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    direction = models.CharField(max_length=3, default="in")  # in | out
    author = models.CharField(max_length=10, default="customer")  # customer | agent | ai | system | event
    author_name = models.CharField(max_length=120, blank=True, null=True)
    kind = models.CharField(max_length=12, default="text")  # text | template | button | image | video | audio | note | event
    body = models.TextField(blank=True)
    template = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=10, null=True, blank=True)  # queued | sent | delivered | read | failed
    wa_id = models.CharField(max_length=128, blank=True, db_index=True)
    error = models.TextField(blank=True, null=True)
    media = models.JSONField(null=True, blank=True)
    booking = models.ForeignKey(Booking, null=True, blank=True, on_delete=models.SET_NULL, related_name="messages")
    campaign = models.ForeignKey("Campaign", null=True, blank=True, on_delete=models.SET_NULL, related_name="messages")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]


class Template(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="templates")
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=20, default="utility")
    language = models.CharField(max_length=10, default="en")
    status = models.CharField(max_length=12, default="pending")
    header = models.CharField(max_length=200, blank=True, null=True)
    body = models.TextField()
    footer = models.CharField(max_length=200, blank=True, null=True)
    buttons = models.JSONField(default=list, blank=True)
    variables = models.JSONField(default=list, blank=True, help_text="Field for each {{n}}, in order")
    meta_id = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["workspace", "name", "language"], name="uniq_template")]
        ordering = ["id"]


class Campaign(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="campaigns")
    name = models.CharField(max_length=200)
    template = models.ForeignKey(Template, on_delete=models.PROTECT, related_name="campaigns")
    audience = models.JSONField(default=dict)  # {"type": "all"} | {"type": "tag", "value": "VIP"}
    status = models.CharField(max_length=12, default="draft")  # draft | scheduled | sending | sent
    scheduled_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    stats = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class QuickReply(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="quick_replies")
    title = models.CharField(max_length=120)
    body = models.TextField()

    class Meta:
        ordering = ["id"]
