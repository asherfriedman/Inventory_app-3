@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if "%PORT%"=="" set "PORT=3004"

echo Starting local static server on http://localhost:%PORT%
npm run dev:local
