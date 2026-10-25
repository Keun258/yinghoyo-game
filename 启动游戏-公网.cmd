@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 应猴传说 - 公网分享模式
node share.js
pause
