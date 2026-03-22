import hashlib


def make_product_key(user_id: int, product_name: str) -> str:
    raw = f"{user_id}:{product_name.strip().lower()}"
    return "P-" + hashlib.sha256(raw.encode()).hexdigest()[:12].upper()
