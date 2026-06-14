"""
同步 static/models/ 目录下的 .glb 文件到 SQLite 数据库
功能：
  - 批量读取 .glb 文件，提取机型名称
  - 为每个机型自动匹配基础信息（全称/国家/服役时间/用途）
  - 用 trimesh 读取模型尺寸，计算记录真实长宽高（米）和比例
  - 将机型名称、介绍、长宽高、模型路径存入 SQLite

用法：
    python sync_models.py
    python sync_models.py --dry-run   # 仅预览，不写入数据库
"""
import sys
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "static" / "models"
DATABASE = BASE_DIR / "models.db"

# ═══════════════════════════════════════════════════════════════════════════
# 飞机知识库（真实世界规格）
# 键：文件名 stem（小写，去空格），值：(全称, 国家, 服役时间, 用途, 长m, 翼展m, 高m)
# ═══════════════════════════════════════════════════════════════════════════
AIRCRAFT_DB = {
    "mikoyanmig-29": (
        "Mikoyan MiG-29 Fulcrum", "苏联/俄罗斯", "1982年",
        "双发中型制空战斗机，北约代号「支点」，以优异机动性著称",
        17.37, 11.40, 4.73
    ),
    "milmi28": (
        "Mil Mi-28 Havoc", "苏联/俄罗斯", "2006年",
        "全天候武装直升机，北约代号「浩劫」，用于反装甲与近距空中支援",
        17.01, 17.20, 3.82
    ),
    "mitsubishia6m": (
        "Mitsubishi A6M Zero", "日本", "1940年",
        "零式舰载战斗机，太平洋战争初期最优秀的舰载战机",
        9.06, 12.00, 3.05
    ),
    "mitsubishif-15jv1": (
        "Mitsubishi F-15J Eagle", "日本（美国授权生产）", "1981年",
        "基于F-15C/D的日本航空自卫队制空战斗机",
        19.43, 13.05, 5.63
    ),
    "mitsubishif-2": (
        "Mitsubishi F-2 Viper Zero", "日本（日美合作）", "2000年",
        "基于F-16改型设计的多用途战斗机，用于对海攻击与空防",
        15.52, 11.13, 4.96
    ),
    "moranesalniern": (
        "Morane-Saulnier Type N", "法国", "1915年",
        "一战早期单翼战斗侦察机，螺旋桨带偏转板",
        6.70, 8.15, 2.25
    ),
    "nakajimab5n": (
        "Nakajima B5N Kate", "日本", "1937年",
        "九七式舰载攻击机，珍珠港攻击主力，可携带鱼雷",
        10.30, 15.52, 3.70
    ),
    "nakajimaki-27": (
        "Nakajima Ki-27 Nate", "日本", "1937年",
        "九七式战斗机，日军第一款单翼战斗机，诺门罕战役主力",
        7.53, 11.31, 3.28
    ),
    "nakajimaki-44": (
        "Nakajima Ki-44 Shoki", "日本", "1942年",
         "二式单座战斗机「钟馗」，侧重高空拦截能力",
        8.84, 9.45, 3.25
    ),
    "northamericanb-25jmitchell": (
        "North American B-25J Mitchell", "美国", "1941年",
        "双发中型轰炸机，杜立特空袭东京的机型",
        16.13, 20.60, 4.80
    ),
    "northamericanf-82twinmustang": (
        "North American F-82 Twin Mustang", "美国", "1946年",
        "双机身远程护航战斗机，朝鲜战争初期主力",
        12.93, 15.62, 4.22
    ),
    "northamericanf-86sabrev2": (
        "North American F-86 Sabre", "美国", "1949年",
        "后掠翼喷气战斗机，朝鲜战争中与MiG-15的空战名机",
        11.40, 11.30, 4.50
    ),
    "northamericanp-51dmustang": (
        "North American P-51D Mustang", "美国", "1944年",
        "二战最优秀的活塞战斗机之一，为B-17/B-24提供全程护航",
        9.83, 11.28, 4.08
    ),
    "northanericanf-100supersabre": (
        "North American F-100 Super Sabre", "美国", "1954年",
         "世界上第一款实用超音速战斗机，昵称「Hun」",
        15.20, 11.81, 4.95
    ),
    "north-american-p-51c-mustang": (
        "North American P-51C Mustang", "美国", "1943年",
        "P-51C型，换装Merlin发动机，高空性能大幅提升",
        9.83, 11.28, 3.71
    ),
    "northropgrummanea-6bprowler": (
        "Northrop Grumman EA-6B Prowler", "美国", "1971年",
        "舰载电子战飞机，执行雷达干扰与通信压制任务",
        17.98, 16.15, 4.42
    ),
    "northropt-38talon": (
        "Northrop T-38 Talon", "美国", "1961年",
        "双座超音速高级教练机，美国空军长期使用",
        14.14, 7.70, 3.92
    ),
    "northropt-38talonii": (
        "Northrop T-38 Talon II", "美国", "1961年",
        "双座超音速高级教练机，用于飞行员战斗转换训练",
        14.14, 7.70, 3.92
    ),
    "northrop-f5": (
        "Northrop F-5 Freedom Fighter", "美国", "1962年",
        "轻型超音速战斗机，广泛出口多国，性价比极高",
        14.45, 8.13, 4.08
    ),
    "northrop-yb-35": (
        "Northrop YB-35", "美国", "1946年",
        "飞翼战略轰炸机验证机，螺旋桨动力，为B-2的前身概念机",
        16.18, 52.43, 6.20
    ),
    "nortthamericant-2buckeyev1": (
        "North American T-2 Buckeye", "美国", "1958年",
        "双发中级教练机，用于美国海军飞行员基础训练",
        11.67, 11.62, 4.52
    ),
    "p-80ashootingstarv1": (
        "P-80A Shooting Star", "美国", "1945年",
        "美国第一款量产的喷气战斗机，二战末期投入测试",
        10.49, 11.81, 3.43
    ),
    "pac-jf-17-thunder-cac-fc-1-fighter-aircraft": (
        "PAC JF-17 Thunder / FC-1 枭龙", "中国 / 巴基斯坦", "2007年",
        "中巴联合研制的轻型多用途战斗机，性价比高，出口多国",
        14.93, 9.45, 4.72
    ),
    "pby-5acatalinav2": (
        "PBY-5A Catalina", "美国", "1936年",
        "双发水上巡逻/轰炸机，远程海上侦察与反潜作战",
        19.47, 31.70, 6.15
    ),
    "xiany-20v3": (
        "Xian Y-20 运-20", "中国", "2016年",
         "重型战略运输机，代号「鲲鹏」，最大起飞重量220吨",
        47.00, 45.00, 15.00
    ),
    "xiany-20": (
        "Xian Y-20 运-20", "中国", "2016年",
         "重型战略运输机，代号「鲲鹏」，填补了中国大飞机空白",
        47.00, 45.00, 15.00
    ),
}


def _normalize_key(stem: str) -> str:
    """将文件名 stem 归一化为知识库查找键（保留连字符以匹配型号）"""
    s = stem.lower().strip()
    # 替换空格/下划线为连字符
    s = re.sub(r"[\s_]+", "-", s)
    # 只保留小写字母、数字、连字符
    s = re.sub(r"[^a-z0-9\-]", "", s)
    # 合并连续连字符
    s = re.sub(r"-{2,}", "-", s)
    # 去除首尾连字符
    return s.strip("-")


def _compact_key(s: str) -> str:
    """去除所有连字符，生成紧凑键用于模糊匹配"""
    return s.replace("-", "")


def _lookup_aircraft(stem: str) -> dict | None:
    """
    先从精确键查找，再尝试模糊匹配（包含关系），
    使用带分隔符的键和紧凑键两轮匹配。
    返回 None 表示未找到。
    """
    key = _normalize_key(stem)
    compact = _compact_key(key)

    # 精确匹配
    if key in AIRCRAFT_DB:
        full, country, service, usage, l, w, h = AIRCRAFT_DB[key]
        return _build_result(full, country, service, usage, l, w, h)

    # 紧凑精确匹配
    if compact in AIRCRAFT_DB:
        full, country, service, usage, l, w, h = AIRCRAFT_DB[compact]
        return _build_result(full, country, service, usage, l, w, h)

    # 模糊匹配（带分隔符）
    for db_key, (full, country, service, usage, l, w, h) in AIRCRAFT_DB.items():
        if db_key in key or key in db_key:
            return _build_result(full, country, service, usage, l, w, h)

    # 模糊匹配（紧凑形式）
    for db_key, (full, country, service, usage, l, w, h) in AIRCRAFT_DB.items():
        db_compact = _compact_key(db_key)
        if db_compact and len(db_compact) >= 6:
            if db_compact in compact or compact in db_compact:
                return _build_result(full, country, service, usage, l, w, h)

    return None


def _build_result(full, country, service, usage, l, w, h):
    return {
        "full_name": full,
        "country": country,
        "service_period": service,
        "usage": usage,
        "real_length_m": l,
        "real_wingspan_m": w,
        "real_height_m": h,
    }


def _read_model_dimensions(filepath: Path) -> dict:
    """使用 trimesh 读取 .glb 文件的包围盒尺寸（原始单位）"""
    import trimesh
    try:
        scene = trimesh.load(str(filepath), force="scene")
    except Exception as exc:
        print(f"  [WARN] trimesh 无法加载 {filepath.name}: {exc}")
        return {"model_x": 0, "model_y": 0, "model_z": 0}

    # 收集所有几何体顶点
    all_vertices = []
    if isinstance(scene, trimesh.Scene):
        for name, geom in scene.geometry.items():
            if isinstance(geom, trimesh.Trimesh) and geom.vertices.shape[0] > 0:
                all_vertices.append(geom.vertices)
            elif isinstance(geom, trimesh.PointCloud):
                all_vertices.append(geom.vertices)
    elif isinstance(scene, trimesh.Trimesh):
        if scene.vertices.shape[0] > 0:
            all_vertices.append(scene.vertices)

    if not all_vertices:
        print(f"  [WARN] {filepath.name}: 无可读取顶点")
        return {"model_x": 0, "model_y": 0, "model_z": 0}

    import numpy as np
    verts = np.vstack(all_vertices)
    mins = verts.min(axis=0)
    maxs = verts.max(axis=0)
    extents = maxs - mins  # [x, y, z]

    return {
        "model_x": round(float(extents[0]), 6),
        "model_y": round(float(extents[1]), 6),
        "model_z": round(float(extents[2]), 6),
    }


def sync(dry_run: bool = False):
    """主同步逻辑"""
    # 目录检查
    if not MODELS_DIR.is_dir():
        print(f"[ERROR] 模型目录不存在: {MODELS_DIR}")
        print("         请先运行 optimize_models.py 或确保 static/models/ 中有 .glb 文件")
        sys.exit(1)

    glb_files = sorted(MODELS_DIR.glob("*.glb"))
    if not glb_files:
        print(f"[WARN] 在 {MODELS_DIR} 中未找到 .glb 文件。")
        return

    print(f"[INFO] 找到 {len(glb_files)} 个 .glb 文件\n")
    if dry_run:
        print("[DRY-RUN] 仅预览模式，不会实际修改数据库。\n")

    # 数据库
    import sqlite3
    conn = sqlite3.connect(str(DATABASE))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS models (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            filename         TEXT    NOT NULL UNIQUE,
            display_name     TEXT    NOT NULL,
            full_name        TEXT    DEFAULT '',
            country          TEXT    DEFAULT '',
            service_period   TEXT    DEFAULT '',
            usage_desc       TEXT    DEFAULT '',
            real_length_m    REAL    DEFAULT 0,
            real_wingspan_m  REAL    DEFAULT 0,
            real_height_m    REAL    DEFAULT 0,
            model_length     REAL    DEFAULT 0,
            model_wingspan   REAL    DEFAULT 0,
            model_height     REAL    DEFAULT 0,
            scale_ratio      TEXT    DEFAULT '',
            file_size        INTEGER NOT NULL DEFAULT 0,
            file_path        TEXT    NOT NULL,
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.commit()

    added = 0
    updated = 0

    for idx, glb_path in enumerate(glb_files, 1):
        filename = glb_path.name
        stem = glb_path.stem
        display_name = stem  # 去掉 .glb 后缀
        file_size = glb_path.stat().st_size
        rel_path = f"static/models/{filename}"

        # --- 查知识库 ---
        ac_info = _lookup_aircraft(stem)
        if ac_info is None:
            full_name = display_name
            country = ""
            service_period = ""
            usage_desc = ""
            real_l = real_w = real_h = 0.0
        else:
            full_name = ac_info["full_name"]
            country = ac_info["country"]
            service_period = ac_info["service_period"]
            usage_desc = ac_info["usage"]
            real_l = ac_info["real_length_m"]
            real_w = ac_info["real_wingspan_m"]
            real_h = ac_info["real_height_m"]

        # --- 读模型包围盒 ---
        dims = _read_model_dimensions(glb_path)
        mx, my, mz = dims["model_x"], dims["model_y"], dims["model_z"]

        # --- 计算比例 ---
        # 将模型尺寸和真实尺寸按对应轴比较，取平均比例
        ratios = []
        if real_l > 0 and mx > 0:
            ratios.append(real_l / mx)
        if real_w > 0 and mz > 0:      # Z 轴视为翼展
            ratios.append(real_w / mz)
        if real_h > 0 and my > 0:
            ratios.append(real_h / my)

        if ratios:
            avg_ratio = sum(ratios) / len(ratios)
            scale_denom = round(avg_ratio)
            if scale_denom < 1:
                scale_denom = 1
            scale_ratio = f"1:{scale_denom}"
        else:
            scale_ratio = ""

        # --- 预览 / 写入 ---
        if dry_run:
            print(f"[{idx}/{len(glb_files)}] {filename}")
            print(f"    全称: {full_name}")
            print(f"    国家: {country} | 服役: {service_period}")
            print(f"    用途: {usage_desc}")
            print(f"    真实尺寸: {real_l}×{real_w}×{real_h} m")
            print(f"    模型尺寸: X={mx:.6f} Y={my:.6f} Z={mz:.6f}")
            print(f"    估算比例: {scale_ratio}")
            print()
            continue

        cur = conn.execute("SELECT id FROM models WHERE filename = ?", (filename,))
        existing = cur.fetchone()
        if existing:
            conn.execute(
                """UPDATE models SET
                    display_name=?, full_name=?, country=?, service_period=?,
                    usage_desc=?, real_length_m=?, real_wingspan_m=?, real_height_m=?,
                    model_length=?, model_wingspan=?, model_height=?, scale_ratio=?,
                    file_size=?, file_path=?
                   WHERE filename=?""",
                (display_name, full_name, country, service_period,
                 usage_desc, real_l, real_w, real_h,
                 mx, mz, my, scale_ratio,
                 file_size, rel_path, filename),
            )
            updated += 1
            print(f"  [UPDATE] {filename}  {full_name}  {scale_ratio}")
        else:
            conn.execute(
                """INSERT INTO models
                   (filename, display_name, full_name, country, service_period,
                    usage_desc, real_length_m, real_wingspan_m, real_height_m,
                    model_length, model_wingspan, model_height, scale_ratio,
                    file_size, file_path)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (filename, display_name, full_name, country, service_period,
                 usage_desc, real_l, real_w, real_h,
                 mx, mz, my, scale_ratio,
                 file_size, rel_path),
            )
            added += 1
            print(f"  [ADD] {filename}  {full_name}  {scale_ratio}")

    # 清理孤立记录
    orphan_count = 0
    if not dry_run:
        all_filenames = {f.name for f in glb_files}
        db_filenames = {r[0] for r in conn.execute("SELECT filename FROM models").fetchall()}
        orphaned = db_filenames - all_filenames
        for fn in orphaned:
            conn.execute("DELETE FROM models WHERE filename = ?", (fn,))
            orphan_path = MODELS_DIR / fn
            if orphan_path.exists():
                orphan_path.unlink()
            print(f"  [REMOVE] {fn} (文件已删除)")
        orphan_count = len(orphaned)

    conn.commit()
    conn.close()

    if dry_run:
        print(f"\n[DONE] dry-run 完成。共 {len(glb_files)} 个文件待处理。")
    else:
        print(f"\n[DONE] 新增: {added}  更新: {updated}  删除: {orphan_count}")


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    sync(dry_run=dry)