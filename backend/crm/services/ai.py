"""Reply drafting with Claude — the CS Bot's "AI brain", scoped to a CRM.

Knowledge comes from the workspace itself (business details, hours, services and
prices, quick replies) instead of a vector store, so every business gets useful
answers on day one. Same guardrails as the CS Bot responder:

1. only answer from the provided context, never invent prices or policies;
2. hand over to a human for explicit requests, complaints and low confidence;
3. keep it short — this is WhatsApp.

No Django imports: callers pass plain dicts.
"""
from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

DAY_NAMES = [("mon", "Monday"), ("tue", "Tuesday"), ("wed", "Wednesday"), ("thu", "Thursday"), ("fri", "Friday"), ("sat", "Saturday"), ("sun", "Sunday")]

HEDGES = ("i'm not sure", "i am not sure", "i don't have", "connect you", "a teammate", "human", "can't confirm", "cannot confirm")


def _hm(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    suffix = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {suffix}" if m else f"{h12} {suffix}"


def business_context(ws: dict, services: list[dict], quick_replies: list[dict]) -> str:
    hours = []
    for key, label in DAY_NAMES:
        h = (ws.get("hours") or {}).get(key)
        hours.append(f"{label}: {_hm(h[0])}–{_hm(h[1])}" if h else f"{label}: closed")
    svc = [f"- {s['name']}: {s['minutes']} min, " + (f"₹{s['price']:,}" if s.get("price") else "free") for s in services]
    qr = [f"### {q['title']}\n{q['body']}" for q in quick_replies]
    return (
        f"Business: {ws.get('name')} ({ws.get('industry') or 'local business'})\n"
        f"Address: {ws.get('address')}\nPhone: {ws.get('phone')}\n"
        f"Opening hours:\n" + "\n".join(hours) + "\n\nServices:\n" + "\n".join(svc) + "\n\nApproved answers:\n" + "\n\n".join(qr)
    )


def wants_human(text: str, keywords: list[str]) -> bool:
    t = (text or "").lower()
    phrases = list(keywords or []) + ["real person", "not a bot", "speak to someone", "talk to someone", "call me"]
    return any(k and k.lower() in t for k in phrases)


def system_prompt(ws: dict, services: list[dict], quick_replies: list[dict], customer: dict) -> str:
    instructions = (ws.get("ai") or {}).get("instructions", "")
    return f"""<role>
You are the WhatsApp assistant for {ws.get('name')}. You write replies a front-desk teammate would send.
Use few words: 1–3 short sentences, friendly, no sign-off. Match the customer's language.
</role>

<rules>
- ONLY use facts from <business> and <customer>. If they don't cover the question, say a teammate will confirm — never guess.
- Never invent prices, discounts, availability or policies.
- You cannot book or move appointments yourself. Offer times only if they appear in <customer>; otherwise ask what day suits them.
- If the customer asks for a person, is upset, reports a reaction/injury, or asks for a refund, reply with one short line saying a teammate will pick it up.
- Never mention internal notes or alerts.
- Owner's instructions: {instructions}
</rules>

<business>
{business_context(ws, services, quick_replies)}
</business>

<customer>
Name: {customer.get('name')}
Next booking: {customer.get('next_booking') or 'none'}
Last visit: {customer.get('last_visit') or 'none'}
</customer>"""


def _fallback(last_text: str, first_name: str, quick_replies: list[dict]) -> dict[str, Any]:
    """Keyword match against quick replies when no API key is configured (same as the demo UI)."""
    t = (last_text or "").lower()
    by_title = {q["title"].lower(): q["body"] for q in quick_replies}
    rules = [
        (r"park|address|where|location|direction", ("location", "parking", "address")),
        (r"upi|card|cash|pay", ("payment",)),
        (r"price|cost|how much|rate|₹", ("price",)),
        (r"hour|open|close|timing|sunday", ("hour", "open")),
        (r"late|traffic|running", ("late",)),
        (r"bring|prepare|wash", ("bring",)),
    ]
    for pattern, words in rules:
        if re.search(pattern, t):
            for title, body in by_title.items():
                if any(w in title for w in words):
                    return {"suggestion": f"Hi {first_name}! {body}", "confidence": 0.85, "source": "quick replies"}
    if re.search(r"book|appointment|slot|available", t):
        return {"suggestion": f"Hi {first_name}! Happy to get you booked in. Which service would you like, and what day suits you best?", "confidence": 0.7, "source": "fallback"}
    return {"suggestion": f"Hi {first_name}, thanks for your message — let me check and get back to you in a moment.", "confidence": 0.4, "source": "fallback"}


def draft_reply(
    *,
    api_key: str,
    model: str,
    ws: dict,
    services: list[dict],
    quick_replies: list[dict],
    customer: dict,
    history: list[dict],
) -> dict[str, Any]:
    """Return {suggestion, confidence, source}. ``history`` is [{role: customer|agent|ai, content}]."""
    last_in = next((h["content"] for h in reversed(history) if h["role"] == "customer"), "")
    first = (customer.get("name") or "").split(" ")[0] or "there"
    if not api_key:
        return _fallback(last_in, first, quick_replies)
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        msgs: list[dict] = []
        for h in history[-20:]:
            role = "user" if h["role"] == "customer" else "assistant"
            if msgs and msgs[-1]["role"] == role:
                msgs[-1]["content"] += "\n" + h["content"]
            else:
                msgs.append({"role": role, "content": h["content"]})
        if not msgs or msgs[0]["role"] != "user":
            msgs.insert(0, {"role": "user", "content": "(conversation start)"})
        if msgs[-1]["role"] != "user":
            msgs.append({"role": "user", "content": "(Draft the next reply to the customer.)"})
        resp = client.messages.create(model=model, max_tokens=300, system=system_prompt(ws, services, quick_replies, customer), messages=msgs)
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        confidence = 0.9
        if any(h in text.lower() for h in HEDGES):
            confidence = 0.5
        if resp.stop_reason != "end_turn":
            confidence -= 0.2
        return {"suggestion": text, "confidence": round(confidence, 2), "source": "claude"}
    except Exception as exc:  # network, auth, rate limits — never break the inbox
        logger.warning("Claude draft failed, using fallback: %s", exc)
        return _fallback(last_in, first, quick_replies)
