from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import InventoryMovement, MovementType, Product, Purchase, User
from app.routers.products import get_or_create_product

router = APIRouter(prefix="/inventory", tags=["inventory"])


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
        out.append({"product_id": p.id, "name": p.name, "estimated_stock": max(est, 0.0)})
    return out


@router.get("/movements/recent")
def recent_movements(limit: int = 50, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = (
        db.query(InventoryMovement)
        .filter(InventoryMovement.user_id == user.id)
        .order_by(InventoryMovement.occurred_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    return [
        {
            "id": m.id,
            "product_id": m.product_id,
            "occurred_at": m.occurred_at.isoformat(),
            "movement_type": m.movement_type.value,
            "quantity": m.quantity,
        }
        for m in q
    ]
