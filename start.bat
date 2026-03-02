@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "PORT=3004"
set "ENV_FILE=.env.local"

if not exist "%ENV_FILE%" (
  if exist "api.txt" (
    echo Creating %ENV_FILE% from api.txt...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$url = (Get-Content 'api.txt' | Where-Object { $_ -match '^supabase project url\s+' } | Select-Object -First 1) -replace '^supabase project url\s+', '';" ^
      "$anon = (Get-Content 'api.txt' | Where-Object { $_ -match '^supabase anon key\s+' } | Select-Object -First 1) -replace '^supabase anon key\s+', '';" ^
      "if ([string]::IsNullOrWhiteSpace($url) -or [string]::IsNullOrWhiteSpace($anon)) { exit 1 };" ^
      "Set-Content '.env.local' -Encoding ascii -Value ('SUPABASE_URL=' + $url), ('SUPABASE_ANON_KEY=' + $anon)"
    if errorlevel 1 (
      echo Failed to create %ENV_FILE% from api.txt.
      echo Create .env.local with SUPABASE_URL and SUPABASE_ANON_KEY and run again.
      exit /b 1
    )
  ) else (
    echo Missing %ENV_FILE% and api.txt.
    echo Create .env.local with SUPABASE_URL and SUPABASE_ANON_KEY, then run again.
    exit /b 1
  )
)

for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
  set "name=%%A"
  if not "!name!"=="" if /i not "!name:~0,1!"=="#" set "%%A=%%B"
)

if "%SUPABASE_URL%"=="" (
  echo SUPABASE_URL is not set. Check %ENV_FILE%.
  exit /b 1
)

if "%SUPABASE_ANON_KEY%"=="" if "%SUPABASE_SERVICE_KEY%"=="" (
  echo SUPABASE_ANON_KEY or SUPABASE_SERVICE_KEY must be set. Check %ENV_FILE%.
  exit /b 1
)

echo Starting local server on http://localhost:%PORT%
npx vercel dev --local --yes --listen 127.0.0.1:%PORT%
