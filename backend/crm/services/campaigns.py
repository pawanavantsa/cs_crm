"""Broadcast sending (used by the API and `manage.py run_campaigns`)."""
from __future__ import annotations

import logging

from django.utils import timezone

from ..models import Campaign
from .messaging import MessagingError, ensure_conversation, send_template, template_values

logger = logging.getLogger(__name__)


def send_campaign(c: Campaign) -> Campaign:
    from ..api import audience
    from ..shapes import contact_stats

    t = c.template
    if t.status != "approved":
        raise MessagingError("Template is still waiting for approval from Meta.")
    if c.status in ("sending", "sent"):
        raise MessagingError("This broadcast has already been sent.")
    c.status = "sending"
    c.save(update_fields=["status"])
    a = audience(c.workspace, c.audience or {})
    sent = failed = 0
    for contact in a["ok"]:
        last = contact_stats(contact)["last_visit"]
        try:
            m = send_template(
                ensure_conversation(contact), t,
                template_values(t, contact=contact, ws=c.workspace, last_staff=(last or {}).get("staff", "").split(" ")[0] or None),
                author="system", author_name="Campaign", campaign=c,
            )
            if m.status == "failed":
                failed += 1
            else:
                sent += 1
        except MessagingError as exc:
            logger.warning("Campaign %s skipped %s: %s", c.id, contact.id, exc)
            failed += 1
    c.status = "sent"
    c.sent_at = timezone.now()
    # delivered / read / replied fill in from webhook receipts
    c.stats = {"recipients": len(a["ok"]), "excluded": a["excluded"], "sent": sent, "delivered": 0, "read": 0, "replied": 0, "booked": 0, "failed": failed}
    c.save()
    return c
