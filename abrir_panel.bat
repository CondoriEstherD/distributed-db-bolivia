@echo off
rem Abre el panel del SGBDD con doble clic (Windows). Usa el .env de esta carpeta.
rem Cerrar esta ventana detiene el panel.
cd /d "%~dp0"
echo Abriendo el panel en http://localhost:8501 ...
".venv\Scripts\streamlit.exe" run dashboard\app.py
pause
