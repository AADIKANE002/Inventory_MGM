# Inventory_MGM

Inventory management with historic uploads (CSV/Excel/images/OCR/manual), monthly sales, ongoing movements, and multi-model time-series forecasting with Excel export.

## What to install (full stack)

| Requirement | Purpose |
|-------------|---------|
| **[Python 3.11+](https://www.python.org/downloads/)** | FastAPI backend. During setup, enable **“Add python.exe to PATH”**. |
| **[Node.js LTS](https://nodejs.org/)** | Vite + React frontend (`npm`, `node`). After installing, **restart your terminal or PC** so `node` and `npm` are recognized (or add `C:\Program Files\nodejs` to your user PATH). |
| **[Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki)** (optional) | Reading text from receipt / handwritten **images**. Add the install folder to PATH (e.g. `C:\Program Files\Tesseract-OCR`). Without it, use **CSV/Excel** or **manual JSON** uploads instead. |
| **Git** (optional) | Clone/push the repo. |

**Backend Python packages** (no separate installer): created automatically with:

```text
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

**Frontend JavaScript packages** (from `frontend/package.json`):

```text
cd frontend
npm install
```

---

## Backend (FastAPI)

```text
cd backend
.venv\Scripts\uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Or run `run_backend.bat` from this folder (after venv + `pip install`). API: `http://127.0.0.1:8000`, interactive docs: `http://127.0.0.1:8000/docs`.

---

## Frontend (Vite + React)

```text
cd frontend
npm run dev
```

Or double‑click / run `run_frontend.bat` (prepends the usual Node path on Windows).

Open **http://localhost:5173** — the dev server **proxies** `/api` to the backend on port **8000**, so run the backend at the same time for login and data.

---

## Run everything at once

1. **Terminal 1 — backend:** `run_backend.bat` (or the `uvicorn` command above).
2. **Terminal 2 — frontend:** `run_frontend.bat` (or `npm run dev` inside `frontend`).
3. Browser: **http://localhost:5173**

If the backend feels slow to start the first time, heavy imports (e.g. pandas/statsmodels) can take a while. If it never starts, try moving the project **out of OneDrive** (sync folders sometimes delay file access).
