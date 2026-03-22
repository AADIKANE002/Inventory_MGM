import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.database import Base


class MovementType(str, enum.Enum):
    buy = "buy"
    sell = "sell"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    allow_forecast = Column(Boolean, default=False)

    products = relationship("Product", back_populates="user")
    purchases = relationship("Purchase", back_populates="user")
    monthly_sales = relationship("MonthlySale", back_populates="user")
    movements = relationship("InventoryMovement", back_populates="user")


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("user_id", "product_key", name="uq_user_product_key"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(512), nullable=False)
    category = Column(String(256), nullable=True)
    product_key = Column(String(64), nullable=False, index=True)
    default_expiry_days = Column(Integer, nullable=True)

    user = relationship("User", back_populates="products")
    purchases = relationship("Purchase", back_populates="product")
    monthly_sales = relationship("MonthlySale", back_populates="product")
    movements = relationship("InventoryMovement", back_populates="product")


class Purchase(Base):
    __tablename__ = "purchases"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    purchased_at = Column(DateTime, nullable=False)
    quantity = Column(Float, nullable=False)
    expiry_date = Column(Date, nullable=True)

    user = relationship("User", back_populates="purchases")
    product = relationship("Product", back_populates="purchases")


class MonthlySale(Base):
    __tablename__ = "monthly_sales"
    __table_args__ = (UniqueConstraint("user_id", "product_id", "year_month", name="uq_user_product_month"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    year_month = Column(Date, nullable=False)
    quantity_sold = Column(Float, nullable=False)

    user = relationship("User", back_populates="monthly_sales")
    product = relationship("Product", back_populates="monthly_sales")


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    occurred_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    movement_type = Column(Enum(MovementType), nullable=False)
    quantity = Column(Float, nullable=False)

    user = relationship("User", back_populates="movements")
    product = relationship("Product", back_populates="movements")
