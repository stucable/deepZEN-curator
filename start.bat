@echo off
cd /d "%~dp0"

if exist "%~dp0miniserve.exe" goto :have_miniserve
if exist "%~dp0miniserve-*.exe" goto :unrenamed
goto :missing

:unrenamed
echo.
echo It looks like miniserve was downloaded but not renamed.
echo Found in this folder:
for %%f in ("%~dp0miniserve-*.exe") do echo   %%~nxf
echo.
echo Please rename that file to exactly:
echo   miniserve.exe
echo (no version number, no architecture suffix). Then double-click
echo start.bat again.
echo.
echo Tip: if Windows hides extensions, turn on "File name extensions"
echo in File Explorer's View menu before renaming, otherwise you may
echo end up with "miniserve.exe.exe" by mistake.
echo.
pause
exit /b 1

:missing
echo.
echo miniserve.exe is missing from this folder.
echo.
echo It should sit next to start.bat. If this is your first install,
echo download it from:
echo   https://github.com/svenstaro/miniserve/releases/latest
echo (pick the file ending in "x86_64-pc-windows-msvc.exe",
echo rename to "miniserve.exe", and drop it next to start.bat).
echo See README.txt step 2 for details.
echo.
pause
exit /b 1

:have_miniserve

if not exist "%~dp0build\index.html" (
    echo.
    echo The build\ folder is missing or incomplete.
    echo Make sure you unzipped the full deepZEN-curator-vX.X folder.
    echo.
    pause
    exit /b 1
)

echo.
echo Starting deepZEN-curator at http://localhost:5173
echo Keep this window open while you use the app. Close it to stop.
echo.

start "" /min cmd /c "timeout /t 2 >nul & start """" http://localhost:5173"

miniserve.exe --port 5173 --index index.html --spa build

echo.
echo ----------------------------------------------------------------
echo miniserve has exited.
echo.
echo If the app never loaded, common causes are:
echo   - Windows blocked miniserve.exe. Right-click miniserve.exe ^>
echo     Properties ^> tick "Unblock" ^> OK, then try again.
echo   - Port 5173 is already in use by another program.
echo   - You downloaded the wrong architecture (must end in
echo     "x86_64-pc-windows-msvc.exe").
echo ----------------------------------------------------------------
echo.
pause
