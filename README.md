# Inventory_MGM

Inventory management with historic uploads (CSV/Excel/images/OCR/manual), monthly sales, ongoing movements, and multi-model time-series forecasting with Excel export.

## Backend (FastAPI)

```text
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Or run `run_backend.bat` from this folder. API: `http://127.0.0.1:8000`, docs: `/docs`.

**OCR:** Install [Tesseract](https://github.com/tesseract-ocr/tesseract) and ensure it is on your PATH for receipt/image parsing.

## Frontend (Vite + React)

Requires Node.js. From the `frontend` folder:

```text
npm install
npm run dev
```

Open `http://localhost:5173` (proxies `/api` to the backend on port 8000).
