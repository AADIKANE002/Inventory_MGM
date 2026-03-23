@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0frontend"
if not exist "node_modules\" call npm install
npm run dev
