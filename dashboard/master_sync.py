"""
天宏平台 1.6万辆主数据融合引擎 (Master Sync Engine)
- 以天宏平台 16,012 辆在网车辆为核心主表 (Master Source of Truth)
- 与财务账本精准匹配，清晰标注【已建财务账】与【待录财务/漏收预警】
- 每日凌晨 00:00:00 自动定时从天宏 API 拉取同步
"""
import requests, hashlib, time, json, os, datetime, threading

BASE = "http://157.148.122.36:8088/CGO8"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DATA_FILE = os.path.join(DATA_DIR, "dashboard_data.json")
DOCS_DATA_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "data", "dashboard_data.json")

def clean_plate(plate):
    if not plate:
        return ""
    return str(plate).strip().replace(" ", "").replace("\t", "").replace("\r", "").replace("\n", "").upper()

def login_tianhong():
    session = requests.Session()
    session.trust_env = False
    session.proxies = {"http": None, "https": None}
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    try:
        session.get(BASE + "/Login", timeout=15)
        session.post(BASE + "/Login/setSessionAbandon", data={"userId": "admin"},
                     headers={"X-Requested-With": "XMLHttpRequest"}, timeout=15)
        pwd = hashlib.md5("Aa146250Aa@".encode()).hexdigest()
        r = session.post(BASE + "/Login/ProSubmit", data={
            "user": "admin", "pwd": pwd, "pType": "m", "isRemember": "0",
            "url": "http://157.148.122.36:8088", "vcode": "", "lType": "0"
        }, headers={"X-Requested-With": "XMLHttpRequest"}, timeout=30)
        ok = r.text.strip().split("|")[0] == "0"
        return session if ok else None
    except Exception as e:
        print("天宏登录失败:", e)
        return None

def fetch_tianhong_vehicles(session):
    try:
        r = session.post(BASE + "/realtime/indexrs/getallvehiclelist", data={
            "orgId": "", "orgList": "", "pageIndex": 1, "pageSize": 35000, "winformMode": "false"
        }, headers={"X-Requested-With": "XMLHttpRequest"}, timeout=60)
        if r.status_code != 200:
            return []
        j = r.json()
        return j.get("Data", [])
    except Exception as e:
        print("拉取天宏全量车辆失败:", e)
        return []

def run_master_fusion():
    print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 正在以天宏平台 1.6万辆 为主表执行数据融合与差异标注...")
    start_t = time.time()
    
    # 1. 登录天宏获取 16,012 辆车
    session = login_tianhong()
    if not session:
        return False, "天宏平台登录失败"
    
    th_vehicles = fetch_tianhong_vehicles(session)
    if not th_vehicles:
        return False, "未能拉取到天宏平台车辆数据"
    
    print(f"成功从天宏平台拉取 {len(th_vehicles)} 辆在网车辆主表！")

    # 2. 读取当前财务账本数据
    if not os.path.exists(DATA_FILE):
        import etl_process
        etl_process.run_etl()
    
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        old_data = json.load(f)
    
    raw_finance_records = old_data.get("records", [])
    print(f"读取到原始财务账本 {len(raw_finance_records)} 条记录。")

    # 3. 建立财务索引
    finance_map = {}
    used_finance_plates = set()
    for r in raw_finance_records:
        p = clean_plate(r.get("plate_no"))
        if p and p not in finance_map:
            finance_map[p] = r

    # 4. 以天宏为主表进行融合
    merged_records = []
    matched_count = 0
    unmatched_th_count = 0
    record_id = 1

    for v in th_vehicles:
        raw_plate = v.get("name") or v.get("originalPlateNum") or ""
        p_clean = clean_plate(raw_plate)
        th_org = v.get("orgName") or "天宏在网组织"
        th_terminal = v.get("terminalTypeName") or "天宏标准终端"
        th_sim = v.get("simNum") or ""
        th_frame = v.get("frameNo") or ""
        th_install = (v.get("InstallTime") or "")[:10]
        th_operate = v.get("VehicleOperateStateName") or "正常营运"

        if p_clean and p_clean in finance_map:
            # 🟢 匹对成功：已建财务台账
            matched_count += 1
            used_finance_plates.add(p_clean)
            fin_item = dict(finance_map[p_clean])
            fin_item["id"] = record_id
            fin_item["match_status"] = "已建财务账"
            fin_item["th_matched"] = True
            fin_item["th_org_name"] = th_org
            fin_item["th_terminal_type"] = th_terminal
            fin_item["th_sim_num"] = th_sim
            fin_item["th_frame_no"] = th_frame
            fin_item["th_install_time"] = th_install
            fin_item["th_operate_state"] = th_operate
            merged_records.append(fin_item)
        else:
            # ⚠️ 匹对不上：天宏在网但未录财务账本（漏收预警）
            unmatched_th_count += 1
            new_item = {
                "id": record_id,
                "plate_no": raw_plate.strip(),
                "org_name": th_org,
                "biz_category": "待核算",
                "biz_type": "天宏在网·待录财务",
                "manager": "待分配",
                "service_receivable": 0.0,
                "service_received": 0.0,
                "service_unreceived": 0.0,
                "service_received_date": None,
                "service_due_date": th_install or None,
                "third_receivable": 0.0,
                "third_received": 0.0,
                "third_unreceived": 0.0,
                "third_received_date": None,
                "third_due_date": None,
                "device_name": th_terminal,
                "device_receivable": 0.0,
                "device_received": 0.0,
                "device_unreceived": 0.0,
                "device_received_date": None,
                "device_install_date": th_install or None,
                "aftersales_item": "",
                "aftersales_receivable": 0.0,
                "aftersales_received": 0.0,
                "aftersales_unreceived": 0.0,
                "other_received": 0.0,
                "other_unreceived": 0.0,
                "total_receivable": 0.0,
                "total_received": 0.0,
                "total_unreceived": 0.0,
                "payment_status": "待录财务",
                "expiry_status": "待核验",
                "primary_due_date": th_install or None,
                "remark": "天宏平台在网运行车辆，5月财务账本暂未建账",
                "match_status": "待录财务",
                "th_matched": True,
                "th_org_name": th_org,
                "th_terminal_type": th_terminal,
                "th_sim_num": th_sim,
                "th_frame_no": th_frame,
                "th_install_time": th_install,
                "th_operate_state": th_operate
            }
            merged_records.append(new_item)
        record_id += 1

    # 5. 补充 历史财务台账（天宏已无此车/已拆机）
    history_count = 0
    for r in raw_finance_records:
        p = clean_plate(r.get("plate_no"))
        if p not in used_finance_plates:
            history_count += 1
            hist_item = dict(r)
            hist_item["id"] = record_id
            hist_item["match_status"] = "历史台账(已拆机)"
            hist_item["th_matched"] = False
            hist_item["th_org_name"] = ""
            hist_item["th_terminal_type"] = r.get("device_name") or "原设备"
            hist_item["th_sim_num"] = ""
            hist_item["th_frame_no"] = ""
            hist_item["th_install_time"] = ""
            hist_item["th_operate_state"] = "已离网/拆机"
            merged_records.append(hist_item)
            record_id += 1

    # 6. 计算重构后的汇总 KPI 指标
    total_rec = round(sum(r["total_receivable"] for r in merged_records), 2)
    total_paid = round(sum(r["total_received"] for r in merged_records), 2)
    total_unrec = round(sum(r["total_unreceived"] for r in merged_records), 2)
    
    unique_orgs = set(r["org_name"] for r in merged_records if r["org_name"])
    
    kpis = {
        "total_vehicles": len(th_vehicles), # 以天宏平台 16,012 辆为准
        "total_records": len(merged_records),
        "total_orgs": len(unique_orgs),
        "total_receivable": total_rec,
        "total_received": total_paid,
        "total_unreceived": total_unrec,
        "collection_rate": round((total_paid / total_rec * 100), 2) if total_rec > 0 else 0,
        "matched_count": matched_count,
        "unmatched_count": unmatched_th_count,
        "history_count": history_count,
        "match_rate": round(matched_count / len(th_vehicles) * 100, 1),
        "cleared_count": sum(1 for r in merged_records if r["payment_status"] == "已结清"),
        "partial_count": sum(1 for r in merged_records if r["payment_status"] == "部分收款"),
        "unpaid_count": sum(1 for r in merged_records if r["payment_status"] == "未交款"),
        "unrecorded_count": unmatched_th_count,
        "expired_count": sum(1 for r in merged_records if r["expiry_status"] == "已过期"),
        "expiring_30_count": sum(1 for r in merged_records if r["expiry_status"] == "30天内到期"),
        "normal_count": sum(1 for r in merged_records if r["expiry_status"] == "正常服务中")
    }

    # 7. 负责人与组织排行聚合
    manager_map = {}
    for r in merged_records:
        m = r.get("manager") or "待分配"
        if m not in manager_map:
            manager_map[m] = {"manager": m, "vehicle_count": 0, "receivable": 0.0, "received": 0.0, "unreceived": 0.0}
        manager_map[m]["vehicle_count"] += 1
        manager_map[m]["receivable"] += r["total_receivable"]
        manager_map[m]["received"] += r["total_received"]
        manager_map[m]["unreceived"] += r["total_unreceived"]
    
    managers = []
    for m, stat in manager_map.items():
        stat["receivable"] = round(stat["receivable"], 2)
        stat["received"] = round(stat["received"], 2)
        stat["unreceived"] = round(stat["unreceived"], 2)
        stat["rate"] = round(stat["received"] / stat["receivable"] * 100, 1) if stat["receivable"] > 0 else 0
        managers.append(stat)
    managers.sort(key=lambda x: x["received"], reverse=True)

    # 8. 欠款大客户排行
    debtor_map = {}
    for r in merged_records:
        if r["total_unreceived"] > 0:
            org = r.get("org_name") or "未知客户"
            if org not in debtor_map:
                debtor_map[org] = {"org_name": org, "debt_vehicles": 0, "receivable": 0.0, "received": 0.0, "unreceived": 0.0}
            debtor_map[org]["debt_vehicles"] += 1
            debtor_map[org]["receivable"] += r["total_receivable"]
            debtor_map[org]["received"] += r["total_received"]
            debtor_map[org]["unreceived"] += r["total_unreceived"]
    
    top_debtors = []
    for org, stat in debtor_map.items():
        stat["receivable"] = round(stat["receivable"], 2)
        stat["received"] = round(stat["received"], 2)
        stat["unreceived"] = round(stat["unreceived"], 2)
        top_debtors.append(stat)
    top_debtors.sort(key=lambda x: x["unreceived"], reverse=True)

    # 9. 筛选选项
    managers_opt = sorted(list(set(r["manager"] for r in merged_records if r.get("manager"))))
    biz_opt = sorted(list(set(r["biz_category"] for r in merged_records if r.get("biz_category"))))

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    full_dataset = {
        "generated_at": now_str,
        "kpis": kpis,
        "streams": old_data.get("streams", []),
        "managers": managers,
        "biz_categories": old_data.get("biz_categories", []),
        "top_debtors": top_debtors[:25],
        "timeline": old_data.get("timeline", []),
        "options": {
            "managers": managers_opt,
            "biz_categories": biz_opt,
            "payment_statuses": ["全部", "已结清", "部分收款", "未交款", "待录财务"],
            "expiry_statuses": ["全部", "正常服务中", "30天内到期", "已过期", "待核验"],
            "match_statuses": ["全部", "已建财务账", "待录财务", "历史台账(已拆机)"]
        },
        "records": merged_records
    }

    # 写入本地与 docs 目录
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(full_dataset, f, ensure_ascii=False, indent=2)
    
    if os.path.exists(os.path.dirname(DOCS_DATA_FILE)):
        with open(DOCS_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(full_dataset, f, ensure_ascii=False, indent=2)

    elapsed = time.time() - start_t
    msg = f"天宏主表融合完成！天宏在网 {len(th_vehicles)} 辆车，已建财务账 {matched_count} 辆，待录财务 {unmatched_th_count} 辆，历史台账 {history_count} 辆，耗时 {elapsed:.1f} 秒。"
    print(msg)
    return True, msg

def schedule_midnight_master_sync():
    """每日凌晨 00:00:00 自动定时主表同步调度器"""
    def _worker():
        while True:
            now = datetime.datetime.now()
            tomorrow = now.date() + datetime.timedelta(days=1)
            target = datetime.datetime.combine(tomorrow, datetime.time(0, 0, 0))
            wait_seconds = (target - now).total_seconds()
            print(f"[天宏主表定时器] 下次自动同步将于明日凌晨 00:00:00 执行（等待 {wait_seconds/3600:.2f} 小时）")
            time.sleep(max(5, wait_seconds))
            print("[天宏主表定时器] ⏰ 到达凌晨 00:00，正在执行每日天宏平台主数据拉取与对齐...")
            run_master_fusion()
            time.sleep(120)
            
    t = threading.Thread(target=_worker, daemon=True, name="TianhongMidnightMasterSyncThread")
    t.start()
    print("[天宏主表定时器] 每日凌晨 00:00:00 自动同步调度服务已启动！")

if __name__ == "__main__":
    ok, msg = run_master_fusion()
    print(msg)
