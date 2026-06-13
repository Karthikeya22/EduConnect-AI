@echo off
powershell -NoProfile -Command "Expand-Archive -Path '%~2' -DestinationPath '%~4' -Force"
