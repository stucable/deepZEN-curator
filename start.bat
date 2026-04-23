@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo Python was not found on this computer.
    echo.
    echo Please install "Python 3.12" from the Microsoft Store (no admin rights
    echo needed^), or ask IT for Python via Company Portal. Once installed,
    echo double-click this file again.
    echo.
    pause
    exit /b 1
)
start "" "http://localhost:5173"
python -m http.server 5173 --directory build
