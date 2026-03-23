from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import InventoryMovement, MovementType, Product, Purchase, User
from app.routers.products import get_or_create_product
from app.services.parser import read_tabular_file

router = APIRouter(prefix="/inventory", tags=["inventory"])


# ---------------------------------------------------------------------------
# Manual JSON entry
# ---------------------------------------------------------------------------

@router.post("/movements/manual")
def add_movements_manual(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows_in = payload.get("rows") or []
    n = 0
    for r in rows_in:
        try:
            at = datetime.fromisoformat(str(r["occurred_at"]).replace("Z", "+00:00"))
        except Exception:
            continue
        name = str(r.get("product_name", "")).strip()
        qty = float(r.get("quantity", 0))
        mt = str(r.get("movement_type", "")).lower()
        if not name or qty <= 0 or mt not in ("buy", "sell"):
            continue
        p = get_or_create_product(db, user, name, None)
        db.add(
            InventoryMovement(
                user_id=user.id,
                product_id=p.id,
                occurred_at=at,
                movement_type=MovementType.buy if mt == "buy" else MovementType.sell,
                quantity=qty,
            )
        )
        n += 1
    db.commit()
    return {"inserted": n}


# ---------------------------------------------------------------------------
# Quick-entry: list of {product_id, buy_qty, sell_qty} — UI table shortcut
# ---------------------------------------------------------------------------

@router.post("/quick-entry")
def quick_entry(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Body: { "rows": [ { "product_id": int, "buy_qty": float, "sell_qty": float } ] }
    Inserts purchase movements for buy_qty > 0 and sell movements for sell_qty > 0.
    """
    rows_in = payload.get("rows") or []
    n = 0
    now = datetime.utcnow()
    for r in rows_in:
        pid = r.get("product_id")
        if not pid:
            continue
        # Verify product belongs to this user
        p = db.query(Product).filter(Product.id == pid, Product.user_id == user.id).first()
        if not p:
            continue
        buy_qty = float(r.get("buy_qty") or 0)
        sell_qty = float(r.get("sell_qty") or 0)
        if buy_qty > 0:
            db.add(
                InventoryMovement(
                    user_id=user.id,
                    product_id=p.id,
                    occurred_at=now,
                    movement_type=MovementType.buy,
                    quantity=buy_qty,
                )
            )
            n += 1
        if sell_qty > 0:
            db.add(
                InventoryMovement(
                    user_id=user.id,
                    product_id=p.id,
                    occurred_at=now,
                    movement_type=MovementType.sell,
                    quantity=sell_qty,
                )
            )
            n += 1
    db.commit()
    return {"inserted": n}


# ---------------------------------------------------------------------------
# Bulk file upload for movements (CSV / Excel)
# ---------------------------------------------------------------------------

_BUY_ALIASES = {"buy", "purchase", "purchased", "restock", "in"}
_SELL_ALIASES = {"sell", "sale", "sold", "out", "dispatch"}

def _parse_movement_type(val: str) -> str | None:
    v = val.strip().lower()
    if v in _BUY_ALIASES:
        return "buy"
    if v in _SELL_ALIASES:
        return "sell"
    return None


@router.post("/movements/tabular")
def upload_movements_tabular(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Upload CSV/Excel with columns: datetime/date, product_name, quantity, movement_type(buy|sell).
    """
    import re

    raw = file.file.read()
    try:
        df = read_tabular_file(raw, file.filename or "data.csv")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    def _norm(c: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", str(c).strip().lower()).strip("_")

    df.columns = [_norm(c) for c in df.columns]

    # Detect columns
    date_col = next((c for c in df.columns if c in {"date", "datetime", "occurred_at", "timestamp", "time"}), None)
    name_col = next((c for c in df.columns if c in {"product_name", "product", "name", "item", "sku"}), None)
    qty_col = next((c for c in df.columns if c in {"quantity", "qty", "amount", "units"}), None)
    type_col = next((c for c in df.columns if c in {"movement_type", "type", "action", "direction"}), None)

    if not date_col or not name_col or not qty_col:
        raise HTTPException(
            status_code=400,
            detail="Could not detect columns. Need: date, product_name, quantity, movement_type(buy/sell).",
        )

    import pandas as pd

    dates = pd.to_datetime(df[date_col], errors="coerce")
    n = 0
    for i in range(len(df)):
        d = dates.iloc[i]
        if pd.isna(d):
            continue
        name = str(df[name_col].iloc[i]).strip()
        if not name or name.lower() == "nan":
            continue
        try:
            qty = float(df[qty_col].iloc[i])
        except (TypeError, ValueError):
            continue
        if qty <= 0:
            continue
        # Guess movement type
        if type_col:
            mt = _parse_movement_type(str(df[type_col].iloc[i]))
        else:
            mt = "buy"  # default
        if mt not in ("buy", "sell"):
            continue
        p = get_or_create_product(db, user, name, None)
        db.add(
            InventoryMovement(
                user_id=user.id,
                product_id=p.id,
                occurred_at=d.to_pydatetime(),
                movement_type=MovementType.buy if mt == "buy" else MovementType.sell,
                quantity=qty,
            )
        )
        n += 1
    db.commit()
    return {"inserted": n, "message": f"Recorded {n} inventory movements."}


# ---------------------------------------------------------------------------
# Stock levels
# ---------------------------------------------------------------------------

@router.get("/stock")
def stock_levels(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    products = db.query(Product).filter(Product.user_id == user.id).all()
    out = []
    for p in products:
        buy_p = db.query(func.coalesce(func.sum(Purchase.quantity), 0)).filter(Purchase.product_id == p.id).scalar()
        buy_m = (
            db.query(func.coalesce(func.sum(InventoryMovement.quantity), 0))
            .filter(
                InventoryMovement.product_id == p.id,
                InventoryMovement.movement_type == MovementType.buy,
            )
            .scalar()
        )
        sell_m = (
            db.query(func.coalesce(func.sum(InventoryMovement.quantity), 0))
            .filter(
                InventoryMovement.product_id == p.id,
                InventoryMovement.movement_type == MovementType.sell,
            )
            .scalar()
        )
        est = float(buy_p or 0) + float(buy_m or 0) - float(sell_m or 0)
        out.append({
            "product_id": p.id,
            "name": p.name,
            "category": p.category,
            "product_key": p.product_key,
            "estimated_stock": max(est, 0.0),
        })
    return out


# ---------------------------------------------------------------------------
# Recent movements
# ---------------------------------------------------------------------------

@router.get("/movements/recent")
def recent_movements(limit: int = 50, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = (
        db.query(InventoryMovement)
        .filter(InventoryMovement.user_id == user.id)
        .order_by(InventoryMovement.occurred_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    products = {p.id: p.name for p in db.query(Product).filter(Product.user_id == user.id).all()}
    return [
        {
            "id": m.id,
            "product_id": m.product_id,
            "product_name": products.get(m.product_id, ""),
            "occurred_at": m.occurred_at.isoformat(),
            "movement_type": m.movement_type.value,
            "quantity": m.quantity,
        }
        for m in q
    ]
