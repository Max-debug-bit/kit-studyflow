@echo off
title KIT StudyFlow - Lokaler Server
echo Starte KIT StudyFlow auf http://localhost:8080 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-local.ps1" -Port 8080
pause
