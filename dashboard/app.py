# -*- coding: utf-8 -*-
"""
天宏平台车辆收款可视化平台 Web 后端服务
"""
import os
import sys
import json
import csv
import io
import urllib.parse
from typing import Optional
from fastapi import FastAPI, Query, HTTPException, Response
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import webbrowser
import threading

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data", "dashboard_data.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(title="天宏平台车辆收款可视化系统", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_CACHE = {
    "data": None
}

import master_sync

def load_data():
    if not os.path.exists(DATA_FILE):
        print("未找到缓存数据文件，正在执行天宏主表融合...")
        master_sync.run_master_fusion()
    
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        _CACHE["data"] = json.load(f)
    print(f"数据加载完成，共 {_CACHE['data']['kpis']['total_records']} 条记录 (天宏在网 {_CACHE['data']['kpis']['total_vehicles']} 辆)。")

@app.on_event("startup")
def startup_event():
    load_data()
    # 启动每日凌晨 00:00:00 自动定时主表同步调度服务
    master_sync.schedule_midnight_master_sync()

@app.get("/api/overview")
def get_overview():
    if not _CACHE["data"]:
        load_data()
    d = _CACHE["data"]
    return {
        "generated_at": d.get("generated_at"),
        "kpis": d.get("kpis"),
        "streams": d.get("streams"),
        "managers": d.get("managers"),
        "biz_categories": d.get("biz_categories"),
        "top_debtors": d.get("top_debtors"),
        "timeline": d.get("timeline"),
        "options": d.get("options")
    }

@app.get("/api/records")
def get_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=10, le=500),
    keyword: Optional[str] = None,
    manager: Optional[str] = None,
    biz_category: Optional[str] = None,
    payment_status: Optional[str] = None,
    expiry_status: Optional[str] = None,
    match_status: Optional[str] = None,
    sort_by: Optional[str] = "id",
    sort_order: Optional[str] = "asc"
):
    if not _CACHE["data"]:
        load_data()
    
    records = _CACHE["data"]["records"]
    filtered = records

    # 1. 关键词检索
    if keyword and keyword.strip():
        kw = keyword.strip().lower()
        filtered = [
            r for r in filtered
            if kw in r["plate_no"].lower()
            or kw in r["org_name"].lower()
            or kw in r["remark"].lower()
            or kw in r["biz_type"].lower()
            or kw in r.get("device_name", "").lower()
            or kw in r.get("th_org_name", "").lower()
            or kw in r.get("th_terminal_type", "").lower()
            or kw in r.get("th_sim_num", "").lower()
            or kw in r.get("match_status", "").lower()
            or kw in r.get("aftersales_item", "").lower()
        ]

    # 2. 负责人筛选
    if manager and manager != "全部":
        filtered = [r for r in filtered if r["manager"] == manager]

    # 3. 业务类别筛选
    if biz_category and biz_category != "全部":
        filtered = [r for r in filtered if r["biz_category"] == biz_category]

    # 4. 收款状态筛选
    if payment_status and payment_status != "全部":
        filtered = [r for r in filtered if r["payment_status"] == payment_status]

    # 5. 到期状态筛选
    if expiry_status and expiry_status != "全部":
        filtered = [r for r in filtered if r["expiry_status"] == expiry_status]

    # 6. 财务建账与匹对状态筛选 (全部 / 已建财务账 / 待录财务 / 历史台账)
    if match_status and match_status != "全部":
        filtered = [r for r in filtered if r.get("match_status") == match_status]

    # 7. 计算筛选结果的汇总统计
    total_count = len(filtered)
    filter_receivable = round(sum(r["total_receivable"] for r in filtered), 2)
    filter_received = round(sum(r["total_received"] for r in filtered), 2)
    filter_unreceived = round(sum(r["total_unreceived"] for r in filtered), 2)

    # 8. 排序
    reverse = (sort_order == "desc")
    if sort_by in ["total_receivable", "total_received", "total_unreceived", "id"]:
        filtered.sort(key=lambda x: x.get(sort_by, 0), reverse=reverse)
    elif sort_by in ["primary_due_date", "service_due_date", "third_due_date"]:
        filtered.sort(key=lambda x: x.get(sort_by, "") or "", reverse=reverse)
    elif sort_by in ["plate_no", "org_name", "manager", "match_status"]:
        filtered.sort(key=lambda x: x.get(sort_by, "") or "", reverse=reverse)

    # 9. 分页切片
    start = (page - 1) * page_size
    end = start + page_size
    page_records = filtered[start:end]

    return {
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": (total_count + page_size - 1) // page_size if total_count > 0 else 1,
        "summary": {
            "total_receivable": filter_receivable,
            "total_received": filter_received,
            "total_unreceived": filter_unreceived,
            "collection_rate": round(filter_received / filter_receivable * 100, 2) if filter_receivable > 0 else 0
        },
        "records": page_records
    }

@app.get("/api/vehicle/{vehicle_id}")
def get_vehicle_detail(vehicle_id: int):
    if not _CACHE["data"]:
        load_data()
    records = _CACHE["data"]["records"]
    for r in records:
        if r["id"] == vehicle_id:
            return r
    raise HTTPException(status_code=404, detail="未找到该车辆档案")

@app.get("/api/sync/tianhong")
@app.get("/api/reload")
def reload_data():
    try:
        ok, msg = master_sync.run_master_fusion()
        load_data()
        return {"status": "ok" if ok else "error", "message": msg}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/export")
def export_csv(
    keyword: Optional[str] = None,
    manager: Optional[str] = None,
    biz_category: Optional[str] = None,
    payment_status: Optional[str] = None,
    expiry_status: Optional[str] = None
):
    if not _CACHE["data"]:
        load_data()
    
    records = _CACHE["data"]["records"]
    filtered = records

    if keyword and keyword.strip():
        kw = keyword.strip().lower()
        filtered = [
            r for r in filtered
            if kw in r["plate_no"].lower()
            or kw in r["org_name"].lower()
            or kw in r["remark"].lower()
            or kw in r["biz_type"].lower()
        ]
    if manager and manager != "全部":
        filtered = [r for r in filtered if r["manager"] == manager]
    if biz_category and biz_category != "全部":
        filtered = [r for r in filtered if r["biz_category"] == biz_category]
    if payment_status and payment_status != "全部":
        filtered = [r for r in filtered if r["payment_status"] == payment_status]
    if expiry_status and expiry_status != "全部":
        filtered = [r for r in filtered if r["expiry_status"] == expiry_status]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "序号", "车牌号码", "车辆组织", "业务分类", "详细业务类型", "业务负责人",
        "总应收", "总已收", "总未收", "收款状态", "到期状态", "服务到期日",
        "服务费_应收", "服务费_已收", "服务费_未收",
        "第三方_应收", "第三方_已收", "第三方_未收",
        "设备_名称", "设备_应收", "设备_已收", "设备_未收",
        "售后_项目", "售后_应收", "售后_已收", "售后_未收",
        "其他_已收", "其他_未收", "备注"
    ])
    for r in filtered:
        writer.writerow([
            r["id"], r["plate_no"], r["org_name"], r["biz_category"], r["biz_type"], r["manager"],
            r["total_receivable"], r["total_received"], r["total_unreceived"], r["payment_status"], r["expiry_status"], r["primary_due_date"],
            r["service_receivable"], r["service_received"], r["service_unreceived"],
            r["third_receivable"], r["third_received"], r["third_unreceived"],
            r["device_name"], r["device_receivable"], r["device_received"], r["device_unreceived"],
            r["aftersales_item"], r["aftersales_receivable"], r["aftersales_received"], r["aftersales_unreceived"],
            r["other_received"], r["other_unreceived"], r["remark"]
        ])

    csv_data = "\ufeff" + output.getvalue()
    response = Response(content=csv_data.encode("utf-8-sig"), media_type="text/csv; charset=utf-8")
    filename = urllib.parse.quote("天宏平台车辆收款明细导出.csv")
    response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{filename}"
    return response

# 挂载静态文件目录
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/styles.css")
def serve_css():
    return FileResponse(os.path.join(STATIC_DIR, "styles.css"))

@app.get("/app.js")
def serve_js():
    return FileResponse(os.path.join(STATIC_DIR, "app.js"))

@app.get("/")
def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>Web 前端页面正在构建中...</h1>")

def open_browser():
    webbrowser.open("http://localhost:8080")

if __name__ == "__main__":
    print("==================================================")
    print(" 北斗平台车辆收款可视化系统 (天宏平台)")
    print(" 访问地址: http://localhost:8080")
    print("==================================================")
    threading.Timer(1.2, open_browser).start()
    uvicorn.run(app, host="0.0.0.0", port=8080)
