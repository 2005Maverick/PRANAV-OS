"""Day-close composition tile: the day rendered as a PNG in the locked identity."""
import datetime as dt
import io

from PIL import Image, ImageDraw, ImageFont

from .. import config, db

INK = (12, 13, 11)
LIFT = (17, 19, 16)
LINE = (34, 38, 31)
BONE = (239, 237, 228)
DIM = (154, 163, 150)
ACID = (63, 224, 197)
W, H = 720, 900
PAD = 48
AXIS_TOP, AXIS_BOT = 150, 780


def _hex(c: str) -> tuple:
    c = (c or "#3E433C").lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _font(size: int):
    for name in ("consola.ttf", "cour.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


async def render_day(date: dt.date) -> bytes | None:
    day = await db.fetchrow("SELECT id FROM days WHERE date=$1", date)
    if not day:
        return None
    blocks = await db.fetch(
        """SELECT b.title, b.start_at, b.end_at, b.status, d.color
           FROM blocks b LEFT JOIN domains d ON d.id=b.domain_id
           WHERE b.day_id=$1 ORDER BY b.start_at""", day["id"])
    if not blocks:
        return None

    img = Image.new("RGB", (W, H), INK)
    dr = ImageDraw.Draw(img)
    f_big, f_mid, f_sm = _font(40), _font(20), _font(15)

    lo = min(b["start_at"].astimezone(config.TZ) for b in blocks)
    hi = max(b["end_at"].astimezone(config.TZ) for b in blocks)
    lo = lo.replace(minute=0)
    span = max((hi - lo).total_seconds() / 60, 60)

    def y(t: dt.datetime) -> float:
        return AXIS_TOP + ((t - lo).total_seconds() / 60) / span * (AXIS_BOT - AXIS_TOP)

    dr.text((PAD, 44), date.strftime("%a %d %b").upper(), font=f_big, fill=BONE)
    done = sum(1 for b in blocks if b["status"] == "done")
    dr.text((PAD, 96), f"{done}/{len(blocks)} blocks done", font=f_mid, fill=DIM)

    # hour ticks
    t = lo
    while t <= hi:
        yy = y(t)
        dr.line([(PAD, yy), (W - PAD, yy)], fill=LINE, width=1)
        dr.text((PAD, yy - 22), t.strftime("%H:%M"), font=f_sm, fill=DIM)
        t += dt.timedelta(hours=3)

    for b in blocks:
        s = b["start_at"].astimezone(config.TZ)
        e = b["end_at"].astimezone(config.TZ)
        y0, y1 = y(s), max(y(e), y(s) + 12)
        col = _hex(b["color"])
        if b["status"] in ("skipped", "sacrificed"):
            col = tuple(int(c * 0.35) for c in col)
        fill = tuple(int(c * 0.55 + i * 0.45) for c, i in zip(col, LIFT))
        dr.rounded_rectangle([PAD + 78, y0, W - PAD, y1], radius=8, fill=fill)
        dr.rectangle([PAD + 78, y0, PAD + 82, y1], fill=col)
        if y1 - y0 >= 26:
            dr.text((PAD + 96, y0 + 6), b["title"][:38], font=f_sm, fill=BONE)

    dr.line([(PAD, 828), (W - PAD, 828)], fill=LINE, width=1)
    dr.text((PAD, 844), "PRANAV OS", font=f_sm, fill=DIM)
    dr.text((W - PAD - 120, 844), "day closed", font=f_sm, fill=ACID)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
