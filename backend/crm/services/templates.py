"""Submitting message templates to Meta for approval."""
from __future__ import annotations

import logging
import re

import requests
from django.conf import settings

from ..models import Template, WhatsAppConfig

logger = logging.getLogger(__name__)

LANG = {"en": "en", "hi": "hi", "mr": "mr", "en_US": "en_US"}


def _examples(n: int) -> list[str]:
    return [f"sample{i + 1}" for i in range(n)]


def submit_template(t: Template) -> None:
    """POST /{waba_id}/message_templates. Without credentials the template stays pending
    (approve it in /admin, or it is approved automatically when ENABLE_SIMULATOR is on)."""
    cfg = WhatsAppConfig.objects.filter(workspace=t.workspace).first()
    if not cfg or not cfg.access_token or not cfg.waba_id:
        if settings.ENABLE_SIMULATOR:
            t.status = "approved"
            t.save(update_fields=["status"])
        return
    n = len(re.findall(r"\{\{\d+\}\}", t.body))
    components: list[dict] = []
    if t.header:
        components.append({"type": "HEADER", "format": "TEXT", "text": t.header})
    body = {"type": "BODY", "text": t.body}
    if n:
        body["example"] = {"body_text": [_examples(n)]}
    components.append(body)
    if t.footer and "{{" not in t.footer:
        components.append({"type": "FOOTER", "text": t.footer})
    if t.buttons:
        components.append({"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": b[:25]} for b in t.buttons[:3]]})
    payload = {"name": t.name, "language": LANG.get(t.language, t.language), "category": t.category.upper(), "components": components}
    try:
        r = requests.post(
            f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/{cfg.waba_id}/message_templates",
            json=payload, headers={"Authorization": f"Bearer {cfg.access_token}"}, timeout=30,
        )
        data = r.json()
        if r.ok:
            t.meta_id = data.get("id", "")
            t.status = (data.get("status") or "pending").lower()
        else:
            logger.error("Template %s rejected by Meta: %s", t.name, data)
            t.status = "rejected"
        t.save(update_fields=["meta_id", "status"])
    except requests.RequestException:
        logger.exception("Could not submit template %s", t.name)


def apply_template_status(event: dict) -> None:
    """Webhook field message_template_status_update → update our copy."""
    name = event.get("message_template_name")
    new = (event.get("event") or "").lower()  # APPROVED | REJECTED | PAUSED | DISABLED
    if not name or not new:
        return
    status = {"approved": "approved", "rejected": "rejected"}.get(new, "paused")
    Template.objects.filter(name=name).update(status=status)
