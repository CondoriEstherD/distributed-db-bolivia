@echo off
rem Abre el panel del SGBDD (API FastAPI + frontend React compilado en web\dist).
rem Usa el .env de esta carpeta. Cerrar esta ventana detiene el panel.
cd /d "%~dp0"
echo Panel en http://localhost:8000  (cierre esta ventana para detenerlo)
start "" http://localhost:8000
".venv\Scripts\python.exe" -m uvicorn api.main:app --host 127.0.0.1 --port 8000
pause
