"""Dashboard numbers for Today, Schedule and Reports (ported from the demo server).

Works on plain dicts from ``.values()`` so it stays fast and easy to test.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from statistics import median
from zoneinfo import ZoneInfo

DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
SETTLED = ("done", "no_show")


def day_bounds(d: date, tz: str) -> tuple[datetime, datetime]:
    z = ZoneInfo(tz)
    start = datetime.combine(d, time(0), tzinfo=z)
    return start, datetime.combine(d + timedelta(days=1), time(0), tzinfo=z)


def local_date(dt: datetime, tz: str) -> date:
    return dt.astimezone(ZoneInfo(tz)).date()


def minutes_of_day(dt: datetime, tz: str) -> int:
    t = dt.astimezone(ZoneInfo(tz))
    return t.hour * 60 + t.minute


def hours_for(ws_hours: dict, d: date):
    return (ws_hours or {}).get(DAY_KEYS[d.weekday()])


def capacity_minutes(ws_hours: dict, lunch, d: date, providers: int) -> int:
    h = hours_for(ws_hours, d)
    if not h:
        return 0
    l = (lunch[1] - lunch[0]) if lunch else 0
    return (h[1] - h[0] - l) * providers


def no_show_rate(rows: list[dict]) -> float:
    settled = [r for r in rows if r["status"] in SETTLED]
    if not settled:
        return 0.0
    return sum(1 for r in settled if r["status"] == "no_show") / len(settled)


def reply_minutes(messages: list[dict], since: datetime) -> list[float]:
    """Minutes from the first unanswered customer message to the next human/AI reply.

    ``messages`` must be ordered by conversation then time and contain
    conversation_id, direction, author, created_at.
    """
    out: list[float] = []
    conv, wait = None, None
    for m in messages:
        if m["conversation_id"] != conv:
            conv, wait = m["conversation_id"], None
        if m["direction"] == "in":
            wait = wait or m["created_at"]
        elif wait and m["author"] in ("agent", "ai"):
            if wait >= since:
                out.append((m["created_at"] - wait).total_seconds() / 60)
            wait = None
    return out


def med(values: list[float]) -> int:
    return round(median(values)) if values else 0


def week_starts(today: date, weeks: int) -> list[date]:
    monday = today - timedelta(days=today.weekday())
    return [monday - timedelta(weeks=weeks - 1 - i) for i in range(weeks)]


def heatmap(rows: list[dict], tz: str, ws_hours: dict, lunch) -> dict:
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    hours = list(range(9, 19))
    cells = [[0 for _ in hours] for _ in days]
    z = ZoneInfo(tz)
    for r in rows:
        if r["status"] == "cancelled":
            continue
        t = r["start"].astimezone(z)
        di, hi = t.weekday(), t.hour - hours[0]
        if di < 6 and 0 <= hi < len(hours):
            cells[di][hi] += 1
    mx, busiest = 0, None
    for di, row in enumerate(cells):
        for hi, v in enumerate(row):
            if v > mx:
                mx, busiest = v, {"day": days[di], "hour": hours[hi], "count": v}
    closed = []
    for di in range(6):
        h = (ws_hours or {}).get(DAY_KEYS[di])
        closed.append([
            (not h) or hr * 60 < h[0] or hr * 60 >= h[1] or bool(lunch and lunch[0] <= hr * 60 < lunch[1])
            for hr in hours
        ])
    return {"days": days, "hours": hours, "cells": cells, "closed": closed, "max": mx, "busiest": busiest}
