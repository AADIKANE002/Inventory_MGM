"""Extract text from receipt / handwritten images. Requires Tesseract installed on the system."""

from pathlib import Path

from PIL import Image

from app.config import settings


def image_to_text(path: Path) -> str:
    import pytesseract

    img = Image.open(path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return pytesseract.image_to_string(img)


def parse_lines_from_ocr(text: str) -> list[str]:
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if s:
            lines.append(s)
    return lines


def heuristic_purchase_lines(lines: list[str]) -> list[dict]:
    """
    Very loose parser: lines like '2024-01-15 Milk 2' or 'Milk x2 15/1/2024'.
    Returns list of dicts with keys datetime, product_name, quantity, category, expiry_date.
    """
    import re
    from datetime import datetime

    date_pat = re.compile(
        r"(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]\d{4})|(\d{1,2}[-/]\d{1,2}[-/]\d{2})"
    )
    qty_pat = re.compile(r"(?:qty|x|×)\s*[:=]?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:pcs|units|kg|g)\b", re.I)
    out: list[dict] = []
    for line in lines:
        dt = None
        for m in date_pat.finditer(line):
            for g in m.groups():
                if g:
                    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%m-%d-%Y"):
                        try:
                            dt = datetime.strptime(g.replace("/", "-"), fmt.replace("/", "-"))
                            break
                        except ValueError:
                            continue
                    if dt:
                        break
        qm = qty_pat.search(line)
        qty = 1.0
        if qm:
            qty = float(next(g for g in qm.groups() if g is not None))
        rest = date_pat.sub("", line)
        rest = qty_pat.sub("", rest)
        name = re.sub(r"\s+", " ", rest).strip(" ,.-")
        if len(name) < 2:
            continue
        if dt is None:
            dt = datetime.utcnow()
        out.append(
            {
                "datetime": dt,
                "product_name": name[:500],
                "quantity": qty,
                "category": None,
                "expiry_date": None,
            }
        )
    return out


def save_upload_bytes(data: bytes, suffix: str) -> Path:
    import uuid

    name = f"{uuid.uuid4().hex}{suffix}"
    path = settings.upload_dir / name
    path.write_bytes(data)
    return path
