@echo off
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
  echo Create venv first: python -m venv .venv ^& .venv\Scripts\pip install -r requirements.txt
  exit /b 1
)
call .venv\Scripts\activate.bat
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
