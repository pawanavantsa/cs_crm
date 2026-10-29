"""End-to-end tests for the webhook → CRM pipeline (run with `python manage.py test crm`)."""
import json
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from crm.models import Booking, Contact, Conversation, Message, QuickReply, Service, Staff, Template, WhatsAppConfig, Workspace


def payload(wa_id="919800000001", text="Hi there", kind="text", pnid="PNID", name="Riya", **extra):
    msg = {"from": wa_id, "id": extra.pop("mid", f"wamid.{timezone.now().timestamp()}"), "timestamp": "1700000000", "type": kind}
    if kind == "text":
        msg["text"] = {"body": text}
    if kind == "button":
        msg["button"] = {"text": text, "payload": extra.pop("payload", "")}
    return {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": pnid}, "contacts": [{"wa_id": wa_id, "profile": {"name": name}}], "messages": [msg]}}]}]}


@override_settings(WHATSAPP_ACCESS_TOKEN="", WHATSAPP_PHONE_NUMBER_ID="", ANTHROPIC_API_KEY="", ENABLE_SIMULATOR=True)
class WebhookTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="Test Studio", timezone="UTC", hours={k: [0, 1440] for k in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]})
        WhatsAppConfig.objects.create(workspace=self.ws, phone_number_id="PNID", verify_token="vt")
        self.staff = Staff.objects.create(workspace=self.ws, name="Aarav Mehta")
        self.svc = Service.objects.create(workspace=self.ws, name="Haircut", minutes=45)
        self.client = APIClient()

    def post(self, body):
        return self.client.post("/api/webhooks/whatsapp/", data=json.dumps(body), content_type="application/json")

    def test_verification(self):
        r = self.client.get("/api/webhooks/whatsapp/", {"hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "123"})
        self.assertEqual((r.status_code, r.content), (200, b"123"))
        r = self.client.get("/api/webhooks/whatsapp/", {"hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1"})
        self.assertEqual(r.status_code, 403)

    def test_new_contact_conversation_and_greeting(self):
        self.assertEqual(self.post(payload()).status_code, 200)
        c = Contact.objects.get(wa_id="919800000001")
        self.assertEqual((c.name, c.opt_in), ("Riya", "opted_in"))
        conv = Conversation.objects.get(contact=c)
        self.assertEqual(conv.unread, 1)
        self.assertIsNotNone(conv.last_inbound_at)
        kinds = list(conv.messages.values_list("direction", "author_name"))
        self.assertEqual(kinds[0], ("in", None))
        self.assertIn(("out", "Greeting"), kinds)

    def test_duplicate_delivery_is_ignored(self):
        body = payload(mid="wamid.same")
        self.post(body)
        self.post(body)
        self.assertEqual(Message.objects.filter(direction="in").count(), 1)

    def test_keyword_reply(self):
        qr = QuickReply.objects.create(workspace=self.ws, title="Parking", body="Park behind the studio.")
        self.ws.auto_replies = {**self.ws.auto_replies, "greeting_enabled": False, "keywords": [{"id": 1, "keyword": "park", "reply_id": qr.id, "enabled": True}]}
        self.ws.save()
        self.post(payload(text="Where can I park?"))
        self.assertTrue(Message.objects.filter(direction="out", body="Park behind the studio.").exists())

    def test_reminder_confirm_button_confirms_booking(self):
        c = Contact.objects.create(workspace=self.ws, name="Kavya", phone="+91 98000 00002", opt_in="opted_in")
        start = timezone.now() + timedelta(days=1)
        b = Booking.objects.create(workspace=self.ws, contact=c, staff=self.staff, service=self.svc, start=start, end=start + timedelta(minutes=45))
        self.post(payload(wa_id=c.wa_id, kind="button", text="Confirm", payload=f"CONFIRM:{b.id}"))
        b.refresh_from_db()
        self.assertEqual((b.status, b.reminder), ("confirmed", "confirmed"))

    def test_stop_opts_out(self):
        self.post(payload(text="STOP"))
        self.assertEqual(Contact.objects.get().opt_in, "opted_out")

    def test_status_receipt_updates_message(self):
        self.post(payload())
        out = Message.objects.filter(direction="out").first()
        status_body = {"entry": [{"changes": [{"value": {"metadata": {"phone_number_id": "PNID"}, "statuses": [{"id": out.wa_id, "status": "read", "recipient_id": "1"}]}}]}]}
        self.post(status_body)
        out.refresh_from_db()
        self.assertEqual(out.status, "read")

    def test_ai_handoff(self):
        conv_contact = Contact.objects.create(workspace=self.ws, name="Oli", phone="+44 7000 000003", opt_in="opted_in")
        Conversation.objects.create(workspace=self.ws, contact=conv_contact, ai_mode="auto")
        self.post(payload(wa_id=conv_contact.wa_id, text="Can I talk to a real person please"))
        conv = Conversation.objects.get(contact=conv_contact)
        self.assertEqual(conv.ai_mode, "off")
        self.assertIn("Needs human", conv.labels)

    @override_settings(WHATSAPP_APP_SECRET="s3cret")
    def test_bad_signature_rejected(self):
        r = self.client.post("/api/webhooks/whatsapp/", data=json.dumps(payload(pnid="OTHER")), content_type="application/json", HTTP_X_HUB_SIGNATURE_256="sha256=bad")
        self.assertEqual(r.status_code, 401)


@override_settings(WHATSAPP_ACCESS_TOKEN="", ANTHROPIC_API_KEY="")
class ApiTests(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="Test Studio", timezone="UTC")
        user = get_user_model().objects.create_user("front", password="pw")
        self.me = Staff.objects.create(workspace=self.ws, name="Front Desk", is_agent=True, user=user)
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.contact = Contact.objects.create(workspace=self.ws, name="Neha Gupta", phone="+91 98000 00004", opt_in="opted_in")

    def test_bootstrap_and_today(self):
        self.assertEqual(self.client.get("/api/bootstrap").json()["me"]["name"], "Front Desk")
        self.assertIn("flow", self.client.get("/api/today").json())

    def test_closed_window_blocks_free_text(self):
        conv = self.client.post("/api/conversations", {"contact_id": self.contact.id}, format="json").json()
        r = self.client.post(f"/api/conversations/{conv['id']}/messages", {"body": "hello"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("24-hour", r.json()["error"])

    def test_reply_inside_window(self):
        conv = Conversation.objects.create(workspace=self.ws, contact=self.contact, last_inbound_at=timezone.now())
        r = self.client.post(f"/api/conversations/{conv.id}/messages", {"body": "Hi Neha!"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "sent")
        conv.refresh_from_db()
        self.assertEqual(conv.assignee, self.me)

    def test_send_template_reopens(self):
        t = Template.objects.create(workspace=self.ws, name="hello", status="approved", body="Hi {{1}}", variables=["first_name"])
        conv = Conversation.objects.create(workspace=self.ws, contact=self.contact)
        with mock.patch("crm.services.whatsapp.CloudAPI.send_template") as send:
            send.return_value = mock.Mock(ok=True, message_id="wamid.t", error="", demo=False)
            r = self.client.post(f"/api/conversations/{conv.id}/messages", {"template_id": t.id}, format="json")
        self.assertEqual(r.json()["body"], "Hi Neha")
        self.assertEqual(send.call_args.kwargs["body_params"], ["Neha"])
