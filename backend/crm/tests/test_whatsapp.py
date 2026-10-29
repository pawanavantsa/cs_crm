"""Pure tests for the Cloud API parser/client — no database needed."""
import hashlib
import hmac
import unittest
from unittest import mock

from crm.services import whatsapp as wa


def webhook(*values):
    return {"object": "whatsapp_business_account", "entry": [{"id": "WABA", "changes": [{"field": "messages", "value": v} for v in values]}]}


META = {"messaging_product": "whatsapp", "metadata": {"display_phone_number": "919820041420", "phone_number_id": "PNID"}}


class ParseTests(unittest.TestCase):
    def test_text_message(self):
        p = webhook({**META, "contacts": [{"profile": {"name": "Kavya"}, "wa_id": "919820155018"}],
                     "messages": [{"from": "919820155018", "id": "wamid.1", "timestamp": "1700000000", "type": "text", "text": {"body": "Hi!"}}]})
        msgs, sts = wa.parse_webhook(p)
        self.assertEqual(len(msgs), 1)
        self.assertEqual(sts, [])
        m = msgs[0]
        self.assertEqual((m.wa_id, m.profile_name, m.text, m.kind, m.phone_number_id), ("919820155018", "Kavya", "Hi!", "text", "PNID"))

    def test_status_first_does_not_hide_message(self):
        p = webhook({**META, "statuses": [{"id": "wamid.out", "status": "read", "recipient_id": "91", "timestamp": "1"}]},
                    {**META, "messages": [{"from": "91", "id": "wamid.2", "type": "text", "text": {"body": "later"}}]})
        msgs, sts = wa.parse_webhook(p)
        self.assertEqual([m.text for m in msgs], ["later"])
        self.assertEqual([(s.message_id, s.status) for s in sts], [("wamid.out", "read")])

    def test_template_button_reply_carries_payload(self):
        p = webhook({**META, "messages": [{"from": "91", "id": "wamid.3", "type": "button", "context": {"id": "wamid.reminder"},
                                            "button": {"text": "Confirm", "payload": "CONFIRM:42"}}]})
        m = wa.parse_webhook(p)[0][0]
        self.assertEqual((m.kind, m.text, m.button_payload, m.context_message_id), ("button", "Confirm", "CONFIRM:42", "wamid.reminder"))

    def test_interactive_reply(self):
        p = webhook({**META, "messages": [{"from": "91", "id": "x", "type": "interactive", "interactive": {"type": "button_reply", "button_reply": {"id": "RESCHEDULE:7", "title": "Reschedule"}}}]})
        m = wa.parse_webhook(p)[0][0]
        self.assertEqual((m.kind, m.button_payload), ("button", "RESCHEDULE:7"))

    def test_media_and_failed_status(self):
        p = webhook({**META, "messages": [{"from": "91", "id": "i", "type": "image", "image": {"id": "MEDIA1", "mime_type": "image/jpeg", "caption": "my hair"}}],
                     "statuses": [{"id": "o", "status": "failed", "recipient_id": "91", "errors": [{"code": 131047, "title": "Re-engagement message"}]}]})
        msgs, sts = wa.parse_webhook(p)
        self.assertEqual((msgs[0].kind, msgs[0].media_id, msgs[0].text), ("image", "MEDIA1", "my hair"))
        self.assertEqual(sts[0].error, "Re-engagement message")

    def test_garbage_is_ignored(self):
        self.assertEqual(wa.parse_webhook({"entry": [{"changes": [{"value": None}]}]}), ([], []))
        self.assertEqual(wa.parse_webhook({}), ([], []))


class SignatureTests(unittest.TestCase):
    def test_signature(self):
        body = b'{"a":1}'
        sig = "sha256=" + hmac.new(b"secret", body, hashlib.sha256).hexdigest()
        self.assertTrue(wa.verify_signature("secret", body, sig))
        self.assertFalse(wa.verify_signature("secret", body, "sha256=bad"))
        self.assertFalse(wa.verify_signature("secret", body, None))
        self.assertTrue(wa.verify_signature("", body, None))


class SendTests(unittest.TestCase):
    def test_demo_mode_without_credentials(self):
        r = wa.CloudAPI("", "").send_text("+91 98200 41420", "hi")
        self.assertTrue(r.ok and r.demo and r.message_id.startswith("wamid.demo"))

    def test_template_payload(self):
        api = wa.CloudAPI("TOKEN", "PNID", "v22.0")
        resp = mock.Mock(ok=True)
        resp.json.return_value = {"messages": [{"id": "wamid.ok"}]}
        with mock.patch.object(wa.requests, "post", return_value=resp) as post:
            r = api.send_template("+91 98200-41420", "booking_reminder", "en", ["Kavya", "Facial"], button_payloads=["CONFIRM:1", "RESCHEDULE:1"])
        self.assertEqual(r.message_id, "wamid.ok")
        url = post.call_args.args[0]
        payload = post.call_args.kwargs["json"]
        self.assertEqual(url, "https://graph.facebook.com/v22.0/PNID/messages")
        self.assertEqual(payload["to"], "919820041420")
        comps = payload["template"]["components"]
        self.assertEqual(comps[0]["parameters"][1]["text"], "Facial")
        self.assertEqual(comps[2]["parameters"][0]["payload"], "RESCHEDULE:1")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer TOKEN")

    def test_api_error_is_reported(self):
        api = wa.CloudAPI("T", "P")
        resp = mock.Mock(ok=False, status_code=400, text="bad")
        resp.json.return_value = {"error": {"message": "Message failed to send because more than 24 hours have passed"}}
        with mock.patch.object(wa.requests, "post", return_value=resp):
            r = api.send_text("1", "hi")
        self.assertFalse(r.ok)
        self.assertIn("24 hours", r.error)

    def test_render_template(self):
        self.assertEqual(wa.render_template("Hi {{1}}, {{2}} · {{business_name}}", ["A", "B"], {"business_name": "Glow"}), "Hi A, B · Glow")
        self.assertIsNone(wa.render_template(None, []))


if __name__ == "__main__":
    unittest.main()
