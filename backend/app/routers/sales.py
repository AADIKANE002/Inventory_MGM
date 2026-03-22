from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import MonthlySale, User
from app.routers.products import get_or_create_product
from app.services.ocr import heuristic_purchase_lines, image_to_text, parse_lines_from_ocr, save_upload_bytes
from app.services.parser import parse_monthly_sales_dataframe, read_tabular_file
from app.services.setup_status import refresh_forecast_allowed

router = APIRouter(prefix="/sales", tags=["sales"])


@router.post("/monthly/tabular")
def upload_monthly_sales_tabular(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    raw = file.file.read()
    try:
        df = read_tabular_file(raw, file.filename or "data.csv")
        rows = parse_monthly_sales_dataframe(df)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    n = 0
    for r in rows:
        p = get_or_create_product(db, user, r["product_name"], None)
        existing = (
            db.query(MonthlySale)
            .filter(
                MonthlySale.user_id == user.id,
                MonthlySale.product_id == p.id,
                MonthlySale.year_month == r["year_month"],
            )
            .first()
        )
        if existing:
            existing.quantity_sold = r["quantity_sold"]
        else:
            db.add(
                MonthlySale(
                    user_id=user.id,
                    product_id=p.id,
                    year_month=r["year_month"],
                    quantity_sold=r["quantity_sold"],
                )
            )
        n += 1
    db.commit()
    refresh_forecast_allowed(db, user)
    return {"upserted": n}


@router.post("/monthly/image")
def upload_monthly_sales_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    suffix = ".png"
    fn = (file.filename or "").lower()
    if fn.endswith(".jpg") or fn.endswith(".jpeg"):
        suffix = ".jpg"
    raw = file.file.read()
    path = save_upload_bytes(raw, suffix)
    try:
        text = image_to_text(path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OCR failed ({e}).")
    lines = parse_lines_from_ocr(text)
    parsed = heuristic_purchase_lines(lines)
    n = 0
    from datetime import date

    for r in parsed:
        dt = r["datetime"]
        ym = date(dt.year, dt.month, 1)
        p = get_or_create_product(db, user, r["product_name"], None)
        existing = (
            db.query(MonthlySale)
            .filter(
                MonthlySale.user_id == user.id,
                MonthlySale.product_id == p.id,
                MonthlySale.year_month == ym,
            )
            .first()
        )
        q = r["quantity"]
        if existing:
            existing.quantity_sold = q
        else:
            db.add(
                MonthlySale(
                    user_id=user.id,
                    product_id=p.id,
                    year_month=ym,
                    quantity_sold=q,
                )
            )
        n += 1
    db.commit()
    refresh_forecast_allowed(db, user)
    return {"upserted": n, "ocr_preview": text[:1500]}


@router.post("/monthly/manual")
def upload_monthly_sales_manual(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from datetime import date, datetime

    rows_in = payload.get("rows") or []
    n = 0
    for r in rows_in:
        try:
            ym = datetime.fromisoformat(str(r["year_month"]).replace("Z", "+00:00")).date()
            ym = ym.replace(day=1)
        except Exception:
            continue
        name = str(r.get("product_name", "")).strip()
        sold = float(r.get("quantity_sold", -1))
        if not name or sold < 0:
            continue
        p = get_or_create_product(db, user, name, None)
        existing = (
            db.query(MonthlySale)
            .filter(
                MonthlySale.user_id == user.id,
                MonthlySale.product_id == p.id,
                MonthlySale.year_month == ym,
            )
            .first()
        )
        if existing:
            existing.quantity_sold = sold
        else:
            db.add(
                MonthlySale(
                    user_id=user.id,
                    product_id=p.id,
                    year_month=ym,
                    quantity_sold=sold,
                )
            )
        n += 1
    db.commit()
    refresh_forecast_allowed(db, user)
    return {"upserted": n}


@router.get("/summary")
def sales_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services.setup_status import distinct_months_count, has_purchase_history, refresh_forecast_allowed

    refresh_forecast_allowed(db, user)
    months = distinct_months_count(db, user.id)
    return {
        "distinct_months_of_sales": months,
        "has_purchase_history": has_purchase_history(db, user.id),
        "forecast_unlocked": user.allow_forecast,
        "requirements": {
            "min_months_sales": 3,
            "purchase_history_required": True,
        },
    }
