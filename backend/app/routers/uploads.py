from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Purchase, User
from app.routers.products import get_or_create_product
from app.services.ocr import heuristic_purchase_lines, image_to_text, parse_lines_from_ocr, save_upload_bytes
from app.services.parser import parse_purchase_dataframe, read_tabular_file
from app.services.setup_status import refresh_forecast_allowed

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/purchases/tabular")
def upload_purchases_tabular(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    raw = file.file.read()
    try:
        df = read_tabular_file(raw, file.filename or "data.csv")
        rows = parse_purchase_dataframe(df)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    n = 0
    for r in rows:
        p = get_or_create_product(db, user, r["product_name"], r.get("category"))
        db.add(
            Purchase(
                user_id=user.id,
                product_id=p.id,
                purchased_at=r["datetime"],
                quantity=r["quantity"],
                expiry_date=r.get("expiry_date"),
            )
        )
        n += 1
    db.commit()
    refresh_forecast_allowed(db, user)
    return {"inserted": n, "message": f"Recorded {n} purchase rows."}


@router.post("/purchases/image")
def upload_purchases_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    suffix = ".png"
    fn = (file.filename or "").lower()
    if fn.endswith(".jpg") or fn.endswith(".jpeg"):
        suffix = ".jpg"
    elif fn.endswith(".webp"):
        suffix = ".webp"
    raw = file.file.read()
    path = save_upload_bytes(raw, suffix)
    try:
        text = image_to_text(path)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"OCR failed ({e}). Install Tesseract and ensure it is on PATH, or use CSV/Excel/manual.",
        )
    lines = parse_lines_from_ocr(text)
    parsed = heuristic_purchase_lines(lines)
    n = 0
    for r in parsed:
        p = get_or_create_product(db, user, r["product_name"], r.get("category"))
        db.add(
            Purchase(
                user_id=user.id,
                product_id=p.id,
                purchased_at=r["datetime"],
                quantity=r["quantity"],
                expiry_date=r.get("expiry_date"),
            )
        )
        n += 1
    db.commit()
    refresh_forecast_allowed(db, user)
    return {"inserted": n, "ocr_preview": text[:2000], "message": f"Recorded {n} purchase rows from image."}


@router.post("/purchases/manual")
def upload_purchases_manual(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    JSON: { "rows": [ { "datetime": ISO, "product_name": str, "quantity": float, "category": optional, "expiry_date": optional } ] }
    """
    rows_in = payload.get("rows") or []
    n = 0
    from datetime import datetime

    for r in rows_in:
        try:
            dt = datetime.fromisoformat(str(r["datetime"]).replace("Z", "+00:00"))
        except Exception:
            continue
        name = str(r.get("product_name", "")).strip()
        qty = float(r.get("quantity", 0))
        if not name or qty <= 0:
            continue
        cat = r.get("category")
        exp = r.get("expiry_date")
        from datetime import date as date_cls

        exp_d = None
        if exp:
            try:
                exp_d = datetime.fromisoformat(str(exp)).date()
            except Exception:
                exp_d = None
        p = get_or_create_product(db, user, name, cat)
        db.add(
            Purchase(
                user_id=user.id,
                product_id=p.id,
                purchased_at=dt,
                quantity=qty,
                expiry_date=exp_d,
            )
        )
        n += 1
    db.commit()
    refresh_forecast_allowed(db, user)
    return {"inserted": n}
