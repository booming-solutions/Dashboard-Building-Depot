@echo off
REM ============================================================
REM  Eagle Bridge — installatie
REM  Zet dit bestand in dezelfde map als eagle_bridge.py
REM  en dubbelklik het. Eén keer per computer.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo ==========================================================
echo   Eagle Bridge installeren
echo ==========================================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [FOUT] Python is niet gevonden.
  echo.
  echo Installeer Python 3 via de Microsoft Store of python.org
  echo en zet bij de installatie een vinkje bij "Add Python to PATH".
  echo Start dit bestand daarna opnieuw.
  echo.
  pause
  exit /b 1
)

echo Python gevonden:
python --version
echo.

echo Benodigde onderdelen installeren...
python -m pip install --upgrade pip --quiet
python -m pip install pywinauto pillow --quiet
if errorlevel 1 (
  echo.
  echo [FOUT] Installeren van pywinauto/pillow is mislukt.
  echo Mogelijk blokkeert het netwerk de download. Meld dit bij Jeroen.
  echo.
  pause
  exit /b 1
)
echo Gereed.
echo.

echo Bestandstype .eaglebatch koppelen en eagleprepay:// registreren...
python eagle_bridge.py register
echo.

echo Controle...
python eagle_bridge.py doctor
echo.

echo ==========================================================
echo   Klaar.
echo.
echo   Volgende stap: open Eagle op
echo     Accounts Payable ^> Daily Procedures ^> New A/P Transactions
echo   en draai daarna:
echo     python eagle_bridge.py calibrate
echo.
echo   Stuur het bestand controls.txt dat dan opent door naar
echo   Jeroen, zodat de velden gekoppeld kunnen worden.
echo ==========================================================
echo.
pause
