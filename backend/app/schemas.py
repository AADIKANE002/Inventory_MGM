from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class UserOut(BaseModel):
    id: int
    email: str
    allow_forecast: bool

    class Config:
        from_attributes = True


class PurchaseRowIn(BaseModel):
    datetime: datetime
    product_name: str
    quantity: float = Field(gt=0)
    category: Optional[str] = None
    expiry_date: Optional[date] = None


class MonthlySaleRowIn(BaseModel):
    year_month: date
    product_name: str
    quantity_sold: float = Field(ge=0)


class MovementRowIn(BaseModel):
    occurred_at: datetime
    product_name: str
    quantity: float = Field(gt=0)
    movement_type: Literal["buy", "sell"]


class ForecastRequest(BaseModel):
    horizon: Literal["weekly", "monthly", "quarterly"] = "monthly"
    safety_stock_factor: float = Field(default=1.0, ge=0.1, le=5.0)
