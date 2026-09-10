@echo off
REM ============================================================
REM  Booming - installatie op deze computer (een keer per PC)
REM
REM  Dubbelklik dit bestand. Het zet Booming in
REM    C:\BoomingSolutions\EagleBridge
REM  installeert wat nodig is, en koppelt Booming aan het dashboard.
REM ============================================================
setlocal EnableDelayedExpansion
title Booming installeren
set "DOEL=C:\BoomingSolutions\EagleBridge"

echo.
echo ==========================================================
echo   Booming installeren
echo   (vooruitbetalingen Keukendepot boeken in Eagle)
echo ==========================================================
echo.

if not exist "%~dp0eagle_bridge.py" (
  echo [FOUT] Het bestand eagle_bridge.py staat niet naast dit installatiebestand.
  echo.
  echo Pak eerst het hele zip-bestand uit (rechtermuisknop, "Alles uitpakken")
  echo en dubbelklik dan in de uitgepakte map op installeer-booming.bat.
  echo.
  pause
  exit /b 1
)

REM ---------------------------------------------------------------
REM  STAP 1  Bestanden op de vaste plek zetten
REM ---------------------------------------------------------------
echo STAP 1  Bestanden kopieren naar %DOEL% ...
if /i not "%~dp0"=="%DOEL%\" (
  if not exist "%DOEL%" mkdir "%DOEL%" >nul 2>&1
  if not exist "%DOEL%" (
    echo [FOUT] Kan de map %DOEL% niet aanmaken. Meld dit bij Jeroen.
    pause
    exit /b 1
  )
  REM config.json van een eerdere installatie bewaren (daar staan
  REM de op deze PC geleerde instellingen in); de nieuwe komt ernaast.
  if exist "%DOEL%\config.json" copy /y "%DOEL%\config.json" "%DOEL%\config.vorige.json" >nul
  xcopy "%~dp0*" "%DOEL%\" /E /Y /I /Q >nul
  if exist "%DOEL%\config.vorige.json" (
    copy /y "%DOEL%\config.json" "%DOEL%\config.nieuw.json" >nul
    copy /y "%DOEL%\config.vorige.json" "%DOEL%\config.json" >nul
    del "%DOEL%\config.vorige.json" >nul 2>&1
  )
)
cd /d "%DOEL%"
echo         gereed.
echo.

REM ---------------------------------------------------------------
REM  STAP 2  Python zoeken
REM  Windows heeft een nep-"python" die naar de Microsoft Store wijst;
REM  alleen uitvoer die echt begint met "Python 3." telt.
REM ---------------------------------------------------------------
echo STAP 2  Python controleren ...
set "PYEXE="
py -3 --version 2>&1 | findstr /r /c:"^Python 3\.[0-9]" >nul 2>&1
if not errorlevel 1 set "PYEXE=py -3"
if not defined PYEXE (
  python --version 2>&1 | findstr /r /c:"^Python 3\.[0-9]" >nul 2>&1
  if not errorlevel 1 set "PYEXE=python"
)
if not defined PYEXE (
  for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"
)
if not defined PYEXE (
  for /d %%D in ("%LOCALAPPDATA%\Python\pythoncore-3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"
)

if not defined PYEXE (
  echo.
  echo         Python staat nog niet op deze computer. Dat is nodig voor Booming.
  echo.
  echo         DOEN:
  echo           1. Er opent zo een webpagina van python.org.
  echo           2. Klik daar op de gele knop "Download Python 3.x".
  echo           3. Open het gedownloade bestand en klik op "Install Now".
  echo              (het vinkje "Add python.exe to PATH" mag aan, hoeft niet)
  echo           4. Wacht tot "Setup was successful" verschijnt en sluit dat venster.
  echo           5. Dubbelklik daarna dit installatiebestand OPNIEUW.
  echo.
  echo         Let op: neem Python van python.org, NIET uit de Microsoft Store.
  echo.
  pause
  start "" "https://www.python.org/downloads/"
  exit /b 1
)
echo         gevonden:
%PYEXE% --version
echo.

REM ---------------------------------------------------------------
REM  STAP 3  Onderdelen installeren
REM ---------------------------------------------------------------
echo STAP 3  Onderdelen installeren (kan een minuut duren) ...
%PYEXE% -m pip install --upgrade pip --quiet >nul 2>&1
%PYEXE% -m pip install pywinauto pillow --quiet
if errorlevel 1 (
  echo.
  echo [FOUT] Het installeren van de onderdelen is mislukt.
  echo        Meestal: geen internet, of het netwerk blokkeert de download.
  echo        Maak een foto/schermafdruk van dit venster en stuur die naar Jeroen.
  echo.
  pause
  exit /b 1
)
echo         gereed.
echo.

REM ---------------------------------------------------------------
REM  STAP 4  Koppelen aan het dashboard
REM ---------------------------------------------------------------
echo STAP 4  Booming koppelen aan het dashboard ...
%PYEXE% eagle_bridge.py register
if errorlevel 1 (
  echo [FOUT] Koppelen mislukt. Stuur een schermafdruk van dit venster naar Jeroen.
  pause
  exit /b 1
)
echo.

REM ---------------------------------------------------------------
REM  STAP 5  Controle met Eagle open
REM ---------------------------------------------------------------
echo STAP 5  Controle.
echo.
echo         Open nu Eagle en ga naar:
echo           Accounts Payable  ^>  Daily Procedures  ^>  New A/P Transactions
echo         Laat dat scherm leeg staan (niets invullen).
echo.
pause
echo.
%PYEXE% eagle_bridge.py doctor
echo.

echo ==========================================================
echo   Klaar. Booming is geinstalleerd.
echo.
echo   Staat hierboven bij de controle "alle velden gevonden" of
echo   iets vergelijkbaars, dan kun je vanuit het dashboard boeken.
echo   Staat er een FOUT of "niet gevonden": stuur een schermafdruk
echo   van dit venster naar Jeroen.
echo ==========================================================
echo.
pause
