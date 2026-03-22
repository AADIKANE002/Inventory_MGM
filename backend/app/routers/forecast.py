from datetime import date
from io import BytesIO

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import InventoryMovement, MonthlySale, MovementType, Product, Purchase, User
from app.schemas import ForecastRequest
from app.services.forecasting import (
    aggregate_weekly_from_monthly,
    build_recommendation_excel,
    evaluate_models_on_last_month,
    expiry_adjustment,
    forecast_future,
    horizon_steps,
    pick_best_model_name,
)
from app.services.setup_status import distinct_months_count, has_purchase_history

router = APIRouter(prefix="/forecast", tags=["forecast"])


def estimated_stock(db: Session, product_id: int) -> float:
    buy_p = db.query(func.coalesce(func.sum(Purchase.quantity), 0)).filter(Purchase.product_id == product_id).scalar()
    buy_m = (
        db.query(func.coalesce(func.sum(InventoryMovement.quantity), 0))
        .filter(
            InventoryMovement.product_id == product_id,
            InventoryMovement.movement_type == MovementType.buy,
        )
        .scalar()
    )
    sell_m = (
        db.query(func.coalesce(func.sum(InventoryMovement.quantity), 0))
        .filter(
            InventoryMovement.product_id == product_id,
            InventoryMovement.movement_type == MovementType.sell,
        )
        .scalar()
    )
    return max(float(buy_p or 0) + float(buy_m or 0) - float(sell_m or 0), 0.0)


def monthly_series_for_product(db: Session, user_id: int, product_id: int) -> pd.Series:
    rows = (
        db.query(MonthlySale)
        .filter(MonthlySale.user_id == user_id, MonthlySale.product_id == product_id)
        .order_by(MonthlySale.year_month.asc())
        .all()
    )
    if not rows:
        return pd.Series(dtype=float)
    idx = [r.year_month for r in rows]
    vals = [float(r.quantity_sold) for r in rows]
    return pd.Series(vals, index=pd.to_datetime(idx))


@router.get("/status")
def forecast_status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services.setup_status import refresh_forecast_allowed

    refresh_forecast_allowed(db, user)
    return {
        "forecast_unlocked": user.allow_forecast,
        "distinct_months_sales": distinct_months_count(db, user.id),
        "has_purchase_history": has_purchase_history(db, user.id),
        "min_months_required": 3,
    }


@router.post("/run")
def run_forecast(
    body: ForecastRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.allow_forecast:
        raise HTTPException(
            status_code=400,
            detail="Complete setup: at least one purchase upload and monthly sales covering 3 distinct months.",
        )
    products = db.query(Product).filter(Product.user_id == user.id).all()
    result_rows: list[dict] = []
    for p in products:
        s = monthly_series_for_product(db, user.id, p.id)
        if len(s) < 2:
            continue
        y = s.values.astype(float)
        evals, _, _ = evaluate_models_on_last_month(y)
        best = pick_best_model_name(evals)
        best_mape = next(e.mape for e in evals if e.name == best)
        best_r2 = next(e.r2 for e in evals if e.name == best)
        steps = horizon_steps(body.horizon)
        future = forecast_future(y, best, steps)
        if body.horizon == "weekly":
            monthly_demand = float(future[0]) if len(future) else float(y[-1])
            demand = aggregate_weekly_from_monthly(monthly_demand)
        elif body.horizon == "monthly":
            demand = float(future[0]) if len(future) else 0.0
        else:
            demand = float(np.sum(future)) if len(future) else 0.0
        demand *= body.safety_stock_factor
        adj = expiry_adjustment(p.default_expiry_days, body.horizon, demand)
        stock = estimated_stock(db, p.id)
        net_buy = max(adj - stock, 0.0)
        result_rows.append(
            {
                "product_key": p.product_key,
                "product_name": p.name,
                "category": p.category or "",
                "best_model": best,
                "test_mape": round(best_mape, 6) if best_mape < 1e8 else None,
                "test_r2": round(best_r2, 6) if best_r2 == best_r2 else None,
                "horizon": body.horizon,
                "forecasted_demand_units": round(demand, 4),
                "estimated_stock_units": round(stock, 4),
                "suggested_purchase_units": round(adj, 4),
                "net_to_buy_after_stock": round(net_buy, 4),
                "notes": "Demand scaled by safety factor; expiry adjusts lot size; net subtracts estimated stock.",
            }
        )
    if not result_rows:
        raise HTTPException(status_code=400, detail="No monthly sales series with at least 2 months found.")
    excel_bytes = build_recommendation_excel(result_rows)
    filename = f"inventory_purchase_plan_{date.today().isoformat()}.xlsx"
    return StreamingResponse(
        BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/preview")
def preview_forecast_json(
    body: ForecastRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.allow_forecast:
        raise HTTPException(status_code=400, detail="Setup not complete.")
    products = db.query(Product).filter(Product.user_id == user.id).all()
    out = []
    for p in products:
        s = monthly_series_for_product(db, user.id, p.id)
        if len(s) < 2:
            continue
        y = s.values.astype(float)
        evals, _, _ = evaluate_models_on_last_month(y)
        best = pick_best_model_name(evals)
        best_mape = next(e.mape for e in evals if e.name == best)
        best_r2 = next(e.r2 for e in evals if e.name == best)
        steps = horizon_steps(body.horizon)
        future = forecast_future(y, best, steps)
        if body.horizon == "weekly":
            monthly_demand = float(future[0]) if len(future) else float(y[-1])
            demand = aggregate_weekly_from_monthly(monthly_demand)
        elif body.horizon == "monthly":
            demand = float(future[0]) if len(future) else 0.0
        else:
            demand = float(np.sum(future)) if len(future) else 0.0
        demand *= body.safety_stock_factor
        suggested = max(expiry_adjustment(p.default_expiry_days, body.horizon, demand), 0.0)
        stock = estimated_stock(db, p.id)
        out.append(
            {
                "product_name": p.name,
                "best_model": best,
                "test_mape": best_mape,
                "test_r2": best_r2,
                "forecasted_demand_units": demand,
                "estimated_stock_units": stock,
                "suggested_purchase_units": suggested,
                "net_to_buy_after_stock": max(suggested - stock, 0.0),
            }
        )
    return {"items": out}
