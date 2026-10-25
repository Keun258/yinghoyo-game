@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 应猴传说：高塘爆破战
echo 正在启动游戏服务器...
echo.
echo 启动后会显示你的局域网 IP，把它发给同一 Wi-Fi 下的同学即可联机！
echo 关闭本窗口即停止服务器。
echo.
node server.js
pause
