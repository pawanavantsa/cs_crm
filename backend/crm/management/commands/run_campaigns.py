"""Send scheduled broadcasts whose time has come. Run every few minutes alongside send_reminders."""
from django.core.management.base import BaseCommand
from django.utils import timezone

from crm.models import Campaign
from crm.services.campaigns import send_campaign
from crm.services.messaging import MessagingError


class Command(BaseCommand):
    help = "Send scheduled WhatsApp broadcasts that are due."

    def handle(self, *args, **opts):
        for c in Campaign.objects.filter(status="scheduled", scheduled_at__lte=timezone.now()).select_related("template", "workspace"):
            try:
                send_campaign(c)
                self.stdout.write(self.style.SUCCESS(f"Sent {c.name} to {c.stats['recipients']} contacts"))
            except MessagingError as exc:
                self.stderr.write(f"{c.name}: {exc}")
