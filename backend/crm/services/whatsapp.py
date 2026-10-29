"""WhatsApp Business Cloud API — parsing and sending.

Ported from the Xeroura CS Bot (channels_app/whatsapp.py) and extended for a CRM:

* the webhook parser walks **every** entry/change (CS Bot fix: a leading status update
  must not hide the user message) and also returns delivery/read receipts;
* text, image, video, audio, document, location, button and interactive replies;
* outbound text, approved templates (with quick-reply button payloads), interactive
  reply buttons, mark-as-read, and media download;
* X-Hub-Signature-256 verification with the app secret.

This module has no Django imports so it can be unit-tested on its own.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

import requests

logger = logging.getLogger(__name__)

GRAPH_URL = "https://graph.facebook.com"


# --------------------------------------------------------------------------- parsing
@dataclass
class InboundMessage:
    wa_id: str  # customer's number, digits only
    profile_name: str
    text: str
    kind: str  # text | image | video | audio | document | location | button | interactive | unsupported
    message_id: str
    phone_number_id: str  # business number that received it
    timestamp: int = 0
    button_payload: str = ""
    media_id: str = ""
    mime_type: str = ""
    context_message_id: str = ""  # message this one replies to (e.g. the reminder template)
    raw: dict = field(default_factory=dict)


@dataclass
class StatusUpdate:
    message_id: str
    status: str  # sent | delivered | read | failed
    recipient: str
    phone_number_id: str
    timestamp: int = 0
    error: str = ""


def _text_for(msg: dict) -> tuple[str, str, str]:
    """Return (kind, text, button_payload) for one webhook message object."""
    t = msg.get("type", "")
    if t == "text":
        return "text", (msg.get("text") or {}).get("body", ""), ""
    if t in ("image", "video", "document"):
        return t, (msg.get(t) or {}).get("caption", "") or "", ""
    if t == "audio":
        return "audio", "", ""
    if t == "button":  # quick-reply button on a template message
        b = msg.get("button") or {}
        return "button", b.get("text", ""), b.get("payload", "")
    if t == "interactive":
        it = msg.get("interactive") or {}
        if it.get("type") == "button_reply":
            br = it.get("button_reply") or {}
            return "button", br.get("title", ""), br.get("id", "")
        if it.get("type") == "list_reply":
            lr = it.get("list_reply") or {}
            return "button", lr.get("title", ""), lr.get("id", "")
        return "interactive", "", ""
    if t == "location":
        loc = msg.get("location") or {}
        label = loc.get("name") or loc.get("address") or ""
        return "location", f"📍 {label} ({loc.get('latitude')}, {loc.get('longitude')})".strip(), ""
    if t == "reaction":
        return "reaction", (msg.get("reaction") or {}).get("emoji", ""), ""
    return "unsupported", f"[{t or 'unknown'} message]", ""


def parse_webhook(payload: dict) -> tuple[list[InboundMessage], list[StatusUpdate]]:
    """Parse a Cloud API webhook body into inbound messages and status receipts."""
    messages: list[InboundMessage] = []
    statuses: list[StatusUpdate] = []
    try:
        for entry in payload.get("entry", []) or []:
            for change in entry.get("changes", []) or []:
                value = change.get("value", {}) or {}
                phone_number_id = (value.get("metadata") or {}).get("phone_number_id", "")
                names = {c.get("wa_id"): (c.get("profile") or {}).get("name", "") for c in value.get("contacts", []) or []}
                for m in value.get("messages", []) or []:
                    kind, text, payload_id = _text_for(m)
                    if kind == "reaction":
                        continue
                    media = m.get(kind) if kind in ("image", "video", "audio", "document") else None
                    sender = m.get("from", "")
                    messages.append(
                        InboundMessage(
                            wa_id=sender,
                            profile_name=names.get(sender) or "Unknown",
                            text=text,
                            kind=kind,
                            message_id=m.get("id", ""),
                            phone_number_id=phone_number_id,
                            timestamp=int(m.get("timestamp") or time.time()),
                            button_payload=payload_id,
                            media_id=(media or {}).get("id", ""),
                            mime_type=(media or {}).get("mime_type", ""),
                            context_message_id=(m.get("context") or {}).get("id", ""),
                            raw=m,
                        )
                    )
                for s in value.get("statuses", []) or []:
                    errs = s.get("errors") or []
                    statuses.append(
                        StatusUpdate(
                            message_id=s.get("id", ""),
                            status=s.get("status", ""),
                            recipient=s.get("recipient_id", ""),
                            phone_number_id=phone_number_id,
                            timestamp=int(s.get("timestamp") or time.time()),
                            error=(errs[0].get("title") or errs[0].get("message") or "") if errs else "",
                        )
                    )
    except (AttributeError, TypeError) as exc:  # malformed payloads: acknowledge, don't crash
        logger.exception("Failed to parse WhatsApp webhook payload: %s", exc)
    return messages, statuses


def verify_signature(app_secret: str, raw_body: bytes, header: str | None) -> bool:
    """Check Meta's X-Hub-Signature-256 header (sha256=<hex hmac of the raw body>)."""
    if not app_secret:
        return True  # not configured — accept (same as the CS Bot today)
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.split("=", 1)[1])


def to_wa_id(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


# --------------------------------------------------------------------------- sending
@dataclass
class SendResult:
    ok: bool
    message_id: str = ""
    error: str = ""
    demo: bool = False


class CloudAPI:
    """Thin client for the Graph API messages endpoint."""

    def __init__(self, access_token: str, phone_number_id: str, version: str = "v22.0", timeout: int = 30):
        self.token = access_token
        self.phone_number_id = phone_number_id
        self.base = f"{GRAPH_URL}/{version}"
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.token and self.phone_number_id)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def _post(self, payload: dict) -> SendResult:
        if not self.configured:
            # Demo mode: no credentials yet. Pretend it was sent so the CRM stays usable.
            fake = f"wamid.demo.{int(time.time() * 1000)}"
            logger.info("WhatsApp demo send (no credentials) to=%s type=%s", payload.get("to"), payload.get("type"))
            return SendResult(ok=True, message_id=fake, demo=True)
        url = f"{self.base}/{self.phone_number_id}/messages"
        try:
            resp = requests.post(url, json=payload, headers=self._headers(), timeout=self.timeout)
        except requests.RequestException as exc:
            logger.exception("WhatsApp request failed: %s", exc)
            return SendResult(ok=False, error=str(exc))
        if not resp.ok:
            # Mismatched token vs phone_number_id is the classic cause (see CS Bot notes).
            try:
                err = resp.json().get("error", {})
                msg = err.get("error_data", {}).get("details") or err.get("message") or resp.text[:300]
            except ValueError:
                msg = resp.text[:300]
            logger.error("WhatsApp API error HTTP %s to=%s phone_number_id=%s: %s", resp.status_code, payload.get("to"), self.phone_number_id, msg)
            return SendResult(ok=False, error=msg)
        data = resp.json()
        mid = ((data.get("messages") or [{}])[0]).get("id", "")
        return SendResult(ok=True, message_id=mid)

    def send_text(self, to: str, body: str, reply_to: str | None = None) -> SendResult:
        payload: dict[str, Any] = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to_wa_id(to),
            "type": "text",
            "text": {"preview_url": False, "body": body[:4096]},
        }
        if reply_to:
            payload["context"] = {"message_id": reply_to}
        return self._post(payload)

    def send_template(
        self,
        to: str,
        name: str,
        language: str = "en",
        body_params: list[str] | None = None,
        header_params: list[str] | None = None,
        button_payloads: list[str] | None = None,
    ) -> SendResult:
        """Send an approved template. ``button_payloads`` fill quick-reply buttons in order,
        so the webhook can tell which booking a "Confirm" tap belongs to."""
        components: list[dict] = []
        if header_params:
            components.append({"type": "header", "parameters": [{"type": "text", "text": p} for p in header_params]})
        if body_params:
            components.append({"type": "body", "parameters": [{"type": "text", "text": str(p)[:1024]} for p in body_params]})
        for i, p in enumerate(button_payloads or []):
            components.append({"type": "button", "sub_type": "quick_reply", "index": str(i), "parameters": [{"type": "payload", "payload": p}]})
        payload = {
            "messaging_product": "whatsapp",
            "to": to_wa_id(to),
            "type": "template",
            "template": {"name": name, "language": {"code": language}, "components": components},
        }
        return self._post(payload)

    def send_buttons(self, to: str, body: str, buttons: list[tuple[str, str]]) -> SendResult:
        """Interactive reply buttons (max 3) — only inside the 24-hour window."""
        payload = {
            "messaging_product": "whatsapp",
            "to": to_wa_id(to),
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": body[:1024]},
                "action": {"buttons": [{"type": "reply", "reply": {"id": bid, "title": title[:20]}} for bid, title in buttons[:3]]},
            },
        }
        return self._post(payload)

    def mark_read(self, message_id: str) -> None:
        if not self.configured or not message_id:
            return
        try:
            requests.post(
                f"{self.base}/{self.phone_number_id}/messages",
                json={"messaging_product": "whatsapp", "status": "read", "message_id": message_id},
                headers=self._headers(),
                timeout=10,
            )
        except requests.RequestException:
            logger.warning("Could not mark %s as read", message_id)

    def download_media(self, media_id: str) -> tuple[bytes, str]:
        """Two-step download: resolve the media URL, then fetch it with the same token."""
        if not self.configured or not media_id:
            return b"", ""
        try:
            meta = requests.get(f"{self.base}/{media_id}", headers=self._headers(), timeout=30)
            meta.raise_for_status()
            info = meta.json()
            url, mime = info.get("url", ""), info.get("mime_type", "")
            if not url:
                return b"", mime
            f = requests.get(url, headers=self._headers(), timeout=60)
            f.raise_for_status()
            return f.content, mime
        except requests.RequestException:
            logger.exception("Failed to download WhatsApp media %s", media_id)
            return b"", ""

    def phone_number_info(self) -> dict:
        """Verified name, display number and quality rating — used by Settings → WhatsApp."""
        if not self.configured:
            return {}
        try:
            r = requests.get(
                f"{self.base}/{self.phone_number_id}",
                params={"fields": "verified_name,display_phone_number,quality_rating,messaging_limit_tier"},
                headers=self._headers(),
                timeout=15,
            )
            return r.json() if r.ok else {}
        except requests.RequestException:
            return {}


def render_template(text: str | None, values: list[str], extra: dict | None = None) -> str | None:
    """Fill {{1}}, {{2}}… (and named {{business_name}}) the way WhatsApp renders it."""
    if text is None:
        return None
    extra = extra or {}

    def sub(m: re.Match) -> str:
        k = m.group(1)
        if k.isdigit():
            i = int(k) - 1
            return values[i] if 0 <= i < len(values) else m.group(0)
        return str(extra.get(k, m.group(0)))

    return re.sub(r"\{\{\s*(\w+)\s*\}\}", sub, text)
