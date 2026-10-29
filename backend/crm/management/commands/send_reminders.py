"""Send WhatsApp reminders that are due. Run every 15 minutes (cron, Celery beat, Cloud Scheduler).

    */15 * * * *  cd /app && python manage.py send_reminders
"""
from __future__ import annotations

from datetime import timedelta
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand
from django.utils import timezone

from crm.models import Booking, Workspace
from crm.services.messaging import MessagingError, send_reminder


class Command(BaseCommand):
    help = "Send appointment reminders that are due (respects quiet hours 8 AM–9 PM local)."

    def handle(self, *args, **opts):
        now = timezone.now()
        total = 0
        for ws in Workspace.objects.all():
            cfg = ws.reminders or {}
            if not cfg.get("enabled"):
                continue
            local = now.astimezone(ZoneInfo(ws.timezone))
            if not 8 <= local.hour < 21:
                continue  # quiet hours — the next run after 8 AM picks these up
            lead = timedelta(hours=int(cfg.get("hours_before") or 24))
            due = Booking.objects.filter(
                workspace=ws, status__in=("booked", "confirmed"), reminder="none",
                start__gt=now, start__lte=now + lead, contact__opt_in="opted_in",
            ).select_related("contact", "staff", "service", "workspace")
            for b in due:
                try:
                    if send_reminder(b):
                        total += 1
                except MessagingError as exc:
                    self.stderr.write(f"{ws.name}: {exc}")
                    break
        self.stdout.write(self.style.SUCCESS(f"Sent {total} reminders"))
