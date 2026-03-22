"""
Time-series models: compare on last-holdout month; pick best MAPE (primary) for each product.
Falls back to R2 when MAPE undefined (zero actuals).
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from typing import Callable, Literal

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.statespace.sarimax import SARIMAX

Horizon = Literal["weekly", "monthly", "quarterly"]


def mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mask = y_true != 0
    if not np.any(mask):
        return float("nan")
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])))


def safe_r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    if len(y_true) < 2 or np.var(y_true) == 0:
        return float("nan")
    return float(r2_score(y_true, y_pred))


def _naive_forecast(train: np.ndarray, steps: int) -> np.ndarray:
    last = float(train[-1]) if len(train) else 0.0
    return np.full(steps, last)


def _seasonal_naive_forecast(train: np.ndarray, steps: int, season: int = 12) -> np.ndarray:
    if len(train) >= season:
        base = float(train[-season])
    else:
        base = float(train[-1]) if len(train) else 0.0
    return np.full(steps, base)


def _ma_forecast(train: np.ndarray, steps: int, window: int = 3) -> np.ndarray:
    w = min(window, len(train))
    v = float(np.mean(train[-w:])) if w else 0.0
    return np.full(steps, v)


def _ses_forecast(train: np.ndarray, steps: int) -> np.ndarray:
    try:
        from statsmodels.tsa.holtwinters import SimpleExpSmoothing

        m = SimpleExpSmoothing(train, initialization_method="estimated").fit(optimized=True)
        return np.asarray(m.forecast(steps))
    except Exception:
        return _naive_forecast(train, steps)


def _holt_forecast(train: np.ndarray, steps: int) -> np.ndarray:
    try:
        m = ExponentialSmoothing(
            train,
            trend="add",
            seasonal=None,
            initialization_method="estimated",
        ).fit(optimized=True)
        return np.asarray(m.forecast(steps))
    except Exception:
        return _naive_forecast(train, steps)


def _arima_forecast(train: np.ndarray, steps: int) -> np.ndarray:
    try:
        m = SARIMAX(train, order=(1, 1, 1), seasonal_order=(0, 0, 0, 0), enforce_stationarity=False)
        fit = m.fit(disp=False)
        return np.asarray(fit.forecast(steps))
    except Exception:
        return _naive_forecast(train, steps)


def _linear_trend_forecast(train: np.ndarray, steps: int) -> np.ndarray:
    if len(train) < 2:
        return _naive_forecast(train, steps)
    x = np.arange(len(train)).reshape(-1, 1)
    lr = LinearRegression().fit(x, train)
    future_x = np.arange(len(train), len(train) + steps).reshape(-1, 1)
    return np.maximum(lr.predict(future_x), 0)


MODELS: dict[str, Callable[[np.ndarray, int], np.ndarray]] = {
    "naive_last": _naive_forecast,
    "seasonal_naive_12": lambda t, s: _seasonal_naive_forecast(t, s, 12),
    "moving_avg_3": lambda t, s: _ma_forecast(t, s, 3),
    "simple_exp_smoothing": _ses_forecast,
    "holt_linear": _holt_forecast,
    "arima_111": _arima_forecast,
    "linear_trend": _linear_trend_forecast,
}


@dataclass
class ModelEval:
    name: str
    mape: float
    r2: float
    test_pred: float


def evaluate_models_on_last_month(y: np.ndarray) -> tuple[list[ModelEval], np.ndarray, np.ndarray]:
    """
    y: monthly sales oldest -> newest. Last point is test; earlier is train.
    """
    if len(y) < 2:
        raise ValueError("Need at least 2 months of sales for one train and one test month.")
    train, test_actual = y[:-1], y[-1:]
    test_pred_list: list[ModelEval] = []
    for name, fn in MODELS.items():
        try:
            pred = fn(train, 1)
            pv = float(pred[-1]) if len(pred) else float(train[-1])
            pv = max(pv, 0.0)
            m = mape(test_actual, np.array([pv]))
            r = safe_r2(test_actual, np.array([pv]))
            if math.isnan(m):
                m = 1e9
            test_pred_list.append(ModelEval(name=name, mape=m, r2=r, test_pred=pv))
        except Exception:
            test_pred_list.append(
                ModelEval(name=name, mape=1e9, r2=float("nan"), test_pred=float(train[-1] if len(train) else 0))
            )
    test_pred_list.sort(key=lambda e: (e.mape, -e.r2 if not math.isnan(e.r2) else 0))
    return test_pred_list, train, test_actual


def horizon_steps(h: Horizon) -> int:
    if h == "weekly":
        return 1
    if h == "monthly":
        return 1
    return 3


def months_ahead_for_horizon(h: Horizon) -> int:
    if h == "weekly":
        return 0
    if h == "monthly":
        return 1
    return 3


def pick_best_model_name(evals: list[ModelEval]) -> str:
    return evals[0].name


def forecast_future(
    y: np.ndarray,
    model_name: str,
    steps: int,
) -> np.ndarray:
    fn = MODELS.get(model_name, _naive_forecast)
    return np.maximum(fn(y, steps), 0)


def build_recommendation_excel(
    rows: list[dict],
) -> bytes:
    df = pd.DataFrame(rows)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Purchase_plan", index=False)
    return buf.getvalue()


def expiry_adjustment(
    default_expiry_days: int | None,
    horizon: Horizon,
    suggested_qty: float,
) -> float:
    if not default_expiry_days or default_expiry_days <= 0:
        return suggested_qty
    days = 7 if horizon == "weekly" else 30 if horizon == "monthly" else 90
    rounds = max(1.0, days / float(default_expiry_days))
    return float(np.ceil(suggested_qty / rounds) * min(rounds, 3))


def aggregate_weekly_from_monthly(monthly_demand: float) -> float:
    return monthly_demand / 4.0
