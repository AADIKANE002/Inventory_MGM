from datetime import date

from sqlalchemy import distinct, func
from sqlalchemy.orm import Session

from app.models import MonthlySale, Purchase, User


def distinct_months_count(db: Session, user_id: int) -> int:
    q = db.query(func.count(distinct(MonthlySale.year_month))).filter(MonthlySale.user_id == user_id)
    return int(q.scalar() or 0)


def has_purchase_history(db: Session, user_id: int) -> bool:
    return db.query(Purchase).filter(Purchase.user_id == user_id).first() is not None


def refresh_forecast_allowed(db: Session, user: User) -> None:
    months = distinct_months_count(db, user.id)
    ok = has_purchase_history(db, user.id) and months >= 3
    user.allow_forecast = ok
    db.commit()
    db.refresh(user)
