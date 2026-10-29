"""WhatsApp Cloud API webhook — same contract as the CS Bot's WhatsAppWebhookView.

GET  /api/webhooks/whatsapp/  verification: echo hub.challenge when hub.verify_token matches
POST /api/webhooks/whatsapp/  messages, delivery/read receipts and template status updates

Meta retries anything that isn't a 200, so we always acknowledge — even on errors.
"""
from __future__ import annotations

import json
import logging

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.views import View
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt

from .models import WhatsAppConfig
from .services.messaging import apply_status, process_inbound
from .services.templates import apply_template_status
from .services.whatsapp import parse_webhook, verify_signature

logger = logging.getLogger(__name__)


@method_decorator(csrf_exempt, name="dispatch")
class WhatsAppWebhookView(View):
    def get(self, request):
        mode = request.GET.get("hub.mode")
        token = request.GET.get("hub.verify_token")
        challenge = request.GET.get("hub.challenge")
        if mode != "subscribe" or not token or not challenge:
            return JsonResponse({"error": "Missing verification parameters"}, status=400)
        ok = WhatsAppConfig.objects.filter(verify_token=token).exists()
        if not ok and settings.WHATSAPP_VERIFY_TOKEN and token == settings.WHATSAPP_VERIFY_TOKEN:
            ok = True
        if ok:
            WhatsAppConfig.objects.filter(verify_token=token).update(connected=True)
            logger.info("WhatsApp webhook verified.")
            return HttpResponse(challenge, content_type="text/plain")  # Meta wants the raw challenge
        logger.warning("WhatsApp webhook verification failed (token=%s)", token)
        return JsonResponse({"error": "Verification failed"}, status=403)

    def post(self, request):
        raw = request.body
        try:
            payload = json.loads(raw or b"{}")
        except ValueError:
            return HttpResponse(status=200)

        # Signature check with the app secret of the number this webhook is for
        pnid = ""
        try:
            pnid = payload["entry"][0]["changes"][0]["value"]["metadata"]["phone_number_id"]
        except (KeyError, IndexError, TypeError):
            pass
        cfg = WhatsAppConfig.objects.filter(phone_number_id=pnid).first() if pnid else None
        secret = (cfg.app_secret if cfg else "") or settings.WHATSAPP_APP_SECRET
        if not verify_signature(secret, raw, request.headers.get("X-Hub-Signature-256")):
            logger.warning("Rejected WhatsApp webhook with a bad signature (phone_number_id=%s)", pnid)
            return HttpResponse(status=401)

        # Template approvals arrive on their own field
        for entry in payload.get("entry", []) or []:
            for change in entry.get("changes", []) or []:
                if change.get("field") == "message_template_status_update":
                    apply_template_status(change.get("value") or {})

        messages, statuses = parse_webhook(payload)
        for s in statuses:
            try:
                with transaction.atomic():
                    apply_status(s)
            except Exception:
                logger.exception("Failed to apply status %s", s.message_id)
        for m in messages:
            try:
                process_inbound(m)
            except Exception:
                logger.exception("Error processing WhatsApp message %s from %s", m.message_id, m.wa_id)
        return HttpResponse(status=200)
