@echo off
chcp 65001 >nul
title 天宏平台车辆收款可视化系统
echo ======================================================================
echo           北斗平台车辆收款可视化分析看板 (天宏平台)
echo ======================================================================
echo.
echo [1/3] 检查 Python 环境...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Python，请先安装 Python 3.8+ 并添加至系统环境变量 PATH。
    pause
    exit /b 1
)

echo [2/3] 检查数据文件与依赖...
cd /d "%~dp0"
if not exist "data\dashboard_data.json" (
    echo 正在首次提取并清洗 Excel 数据，请稍候...
    python etl_process.py
)

echo [3/3] 启动 Web 可视化服务并在浏览器中打开看板...
echo 访问地址: http://localhost:8080
echo 提示: 按 Ctrl+C 可停止后台服务。
echo.
python app.py

pause
