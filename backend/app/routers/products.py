from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Product, User
from app.product_key import make_product_key

router = APIRouter(prefix="/products", tags=["products"])


@router.get("")
def list_products(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    items = db.query(Product).filter(Product.user_id == user.id).order_by(Product.name).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "category": p.category,
            "product_key": p.product_key,
            "default_expiry_days": p.default_expiry_days,
        }
        for p in items
    ]


def get_or_create_product(
    db: Session,
    user: User,
    name: str,
    category: str | None,
    default_expiry_days: int | None = None,
) -> Product:
    key = make_product_key(user.id, name)
    p = db.query(Product).filter(Product.user_id == user.id, Product.product_key == key).first()
    if p:
        if category and not p.category:
            p.category = category
        if default_expiry_days and not p.default_expiry_days:
            p.default_expiry_days = default_expiry_days
        return p
    p = Product(
        user_id=user.id,
        name=name.strip(),
        category=category,
        product_key=key,
        default_expiry_days=default_expiry_days,
    )
    db.add(p)
    db.flush()
    return p


@router.patch("/{product_id}/expiry")
def set_expiry_days(
    product_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    p = db.query(Product).filter(Product.id == product_id, Product.user_id == user.id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    days = payload.get("default_expiry_days")
    if days is not None:
        p.default_expiry_days = int(days) if int(days) > 0 else None
    db.commit()
    db.refresh(p)
    return {"id": p.id, "default_expiry_days": p.default_expiry_days}
