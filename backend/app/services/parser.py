import io
import re
from datetime import date, datetime  # noqa: F401 — date used in type checks
from typing import Any

import pandas as pd

DATE_ALIASES = {
    "date",
    "datetime",
    "time",
    "purchase_date",
    "purchased_at",
    "timestamp",
    "day",
}
NAME_ALIASES = {"product", "product_name", "item", "name", "sku", "description"}
QTY_ALIASES = {"quantity", "qty", "amount", "units", "count"}
CAT_ALIASES = {"category", "cat", "type", "group"}
EXP_ALIASES = {"expiry", "expiry_date", "expires", "best_before"}

MONTH_ALIASES = {
    "year_month",
    "month",
    "period",
    "date",
    "ym",
}
SOLD_ALIASES = {"quantity_sold", "sold", "sales", "qty_sold", "units_sold"}


def _norm_col(c: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(c).strip().lower()).strip("_")


def _find_column(df: pd.DataFrame, aliases: set[str]) -> str | None:
    cols = {_norm_col(c): c for c in df.columns}
    for a in aliases:
        if a in cols:
            return cols[a]
    for k, orig in cols.items():
        for a in aliases:
            if a in k or k in a:
                return orig
    return None


def _parse_date_series(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, errors="coerce")


def _parse_month_series(s: pd.Series) -> pd.Series:
    dt = pd.to_datetime(s, errors="coerce")
    return dt.dt.to_period("M").dt.to_timestamp()


def parse_purchase_dataframe(df: pd.DataFrame) -> list[dict[str, Any]]:
    df = df.copy()
    df.columns = [_norm_col(c) for c in df.columns]
    date_col = _find_column(df, DATE_ALIASES)
    name_col = _find_column(df, NAME_ALIASES)
    qty_col = _find_column(df, QTY_ALIASES)
    if not date_col or not name_col or not qty_col:
        raise ValueError(
            "Could not detect columns. Need date/datetime, product name, and quantity columns."
        )
    cat_col = _find_column(df, CAT_ALIASES)
    exp_col = _find_column(df, EXP_ALIASES)

    dates = _parse_date_series(df[date_col])
    rows: list[dict[str, Any]] = []
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
        cat = None
        if cat_col:
            v = df[cat_col].iloc[i]
            if pd.notna(v) and str(v).strip().lower() != "nan":
                cat = str(v).strip()
        exp = None
        if exp_col:
            ev = df[exp_col].iloc[i]
            if pd.notna(ev):
                try:
                    exp = pd.to_datetime(ev).date()
                except Exception:
                    pass
        if hasattr(d, "to_pydatetime"):
            dt_val = d.to_pydatetime()
        else:
            dt_val = datetime.combine(d, datetime.min.time()) if isinstance(d, date) else datetime.utcnow()
        rows.append(
            {
                "datetime": dt_val,
                "product_name": name,
                "quantity": qty,
                "category": cat,
                "expiry_date": exp,
            }
        )
    return rows


def parse_monthly_sales_dataframe(df: pd.DataFrame) -> list[dict[str, Any]]:
    df = df.copy()
    df.columns = [_norm_col(c) for c in df.columns]
    month_col = _find_column(df, MONTH_ALIASES)
    name_col = _find_column(df, NAME_ALIASES)
    sold_col = _find_column(df, SOLD_ALIASES)
    if not month_col or not name_col or not sold_col:
        raise ValueError(
            "Could not detect columns. Need month/period, product name, and quantity sold columns."
        )
    months = _parse_month_series(df[month_col])
    rows: list[dict[str, Any]] = []
    for i in range(len(df)):
        m = months.iloc[i]
        if pd.isna(m):
            continue
        name = str(df[name_col].iloc[i]).strip()
        if not name or name.lower() == "nan":
            continue
        try:
            sold = float(df[sold_col].iloc[i])
        except (TypeError, ValueError):
            continue
        if sold < 0:
            continue
        ym = m.to_pydatetime().date().replace(day=1)
        rows.append({"year_month": ym, "product_name": name, "quantity_sold": sold})
    return rows


def read_tabular_file(content: bytes, filename: str) -> pd.DataFrame:
    lower = filename.lower()
    bio = io.BytesIO(content)
    if lower.endswith(".csv"):
        return pd.read_csv(bio)
    if lower.endswith(".xlsx") or lower.endswith(".xlsm"):
        return pd.read_excel(bio, engine="openpyxl")
    if lower.endswith(".xls"):
        return pd.read_excel(bio, engine="xlrd")
    raise ValueError("Unsupported tabular format. Use CSV or Excel (.xlsx, .xls).")
