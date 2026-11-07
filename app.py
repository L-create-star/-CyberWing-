"""
Flask + SQLite 飞机3D模型浏览器 - 后端
"""
import os
import re
import secrets
import sqlite3
from pathlib import Path

from flask import Flask, g, jsonify, render_template, send_from_directory, request, session, redirect, url_for
from flask_babel import Babel, _

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATABASE = str(BASE_DIR / "models.db")
MODELS_DIR = BASE_DIR / "static" / "models"

app = Flask(__name__)
app.config["SECRET_KEY"] = "aviation-3d-viewer-2024"
app.config["PERMANENT_SESSION_LIFETIME"] = 60 * 60 * 8  # 管理后台会话有效期 8 小时

# 禁用静态文件缓存（开发阶段）
@app.after_request
def add_no_cache_headers(response):
    if request.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response

# Flask-Babel 多语言配置
app.config["BABEL_DEFAULT_LOCALE"] = "zh"
app.config["BABEL_TRANSLATION_DIRECTORIES"] = str(BASE_DIR / "translations")
app.config["LANGUAGES"] = {
    "en": "English",
    "zh": "中文",
}
def get_locale():
    """根据 Cookie 或浏览器偏好选择语言"""
    locale = request.cookies.get("lang")
    if locale in app.config["LANGUAGES"]:
        return locale
    return request.accept_languages.best_match(app.config["LANGUAGES"].keys())


babel = Babel(app, locale_selector=get_locale)


# ---------------------------------------------------------------------------
# 数据库
# ---------------------------------------------------------------------------
def get_db():
    """获取当前请求的数据库连接"""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """初始化数据库表（与 sync_models.py 表结构一致）"""
    db = sqlite3.connect(DATABASE)
    db.execute(
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
    # 兼容旧表迁移：如果旧表存在但缺少新列，自动追加
    existing_cols = {r[1] for r in db.execute("PRAGMA table_info(models)")}
    new_cols = {
        "full_name": "TEXT DEFAULT ''",
        "country": "TEXT DEFAULT ''",
        "service_period": "TEXT DEFAULT ''",
        "usage_desc": "TEXT DEFAULT ''",
        "real_length_m": "REAL DEFAULT 0",
        "real_wingspan_m": "REAL DEFAULT 0",
        "real_height_m": "REAL DEFAULT 0",
        "model_length": "REAL DEFAULT 0",
        "model_wingspan": "REAL DEFAULT 0",
        "model_height": "REAL DEFAULT 0",
        "scale_ratio": "TEXT DEFAULT ''",
        "weight": "REAL DEFAULT 0.5",
        "glide_coe": "REAL DEFAULT 1.0",
        "wind_coe": "REAL DEFAULT 0.3",
        "bounce": "REAL DEFAULT 0.5",
        "category": "TEXT DEFAULT 'fighter'",
    }
    for col, col_def in new_cols.items():
        if col not in existing_cols:
            db.execute(f"ALTER TABLE models ADD COLUMN {col} {col_def}")
    db.commit()

    # ── 按机型分类设定物理参数 ──
    seed_physics_params(db)

    db.close()


def seed_physics_params(db):
    """为新字段填充三类机型的固定物理参数"""
    # 机型 → 类型映射（基于 display_name 匹配）
    category_map = {
        # 战斗机
        "Mikoyan MIG-29": "fighter",
        "mil mi 28": "fighter",
        "Mitsubishi A6M": "fighter",
        "Mitsubishi F-15J v1": "fighter",
        "Mitsubishi F-2": "fighter",
        "Morane Salnier N": "fighter",
        "Nakajima B5N": "fighter",
        "Nakajima Ki-27": "fighter",
        "Nakajima KI-44": "fighter",
        "North American F-82 Twin Mustang": "fighter",
        "North American F-86 Sabre v2": "fighter",
        "North American P-51D Mustang": "fighter",
        "North Anerican F-100 Super Sabre": "fighter",
        "north-american-p-51c-mustang": "fighter",
        "Northrop T-38 Talon II": "fighter",
        "Northrop T-38 Talon": "fighter",
        "northrop-f5": "fighter",
        "P-80A Shooting Star v1": "fighter",
        "pac-jf-17-thunder-cac-fc-1-fighter-aircraft": "fighter",
        "Nortth American T-2 Buckeye v1": "fighter",
        # 运输机 / 大型机
        "North American B-25J Mitchell": "transport",
        "Northrop Grumman EA-6B Prowler": "transport",
        "northrop-yb-35": "transport",
        "PBY-5A  Catalina v2": "transport",
        "Xian Y-20 v3_20260611103948": "transport",
        "Xian Y-20": "transport",
    }
    # 类型 → (weight, glide_coe, wind_coe, bounce)
    params_map = {
        "fighter":   (0.4, 0.7, 0.3, 0.5),
        "airliner":  (0.8, 1.3, 0.2, 0.3),
        "transport": (1.0, 1.0, 0.8, 0.7),
    }

    # 对已有记录，若 category 为空则按映射赋值
    rows = db.execute("SELECT id, display_name, category FROM models").fetchall()
    for row in rows:
        model_id, name, cat = row
        if cat and cat in ("fighter", "airliner", "transport"):
            continue  # 已有有效分类，跳过
        new_cat = category_map.get(name, "fighter")
        w, g, wc, b = params_map.get(new_cat, (0.5, 1.0, 0.3, 0.5))
        db.execute(
            "UPDATE models SET category=?, weight=?, glide_coe=?, wind_coe=?, bounce=? WHERE id=?",
            (new_cat, w, g, wc, b, model_id),
        )
    db.commit()


# ---------------------------------------------------------------------------
# 路由 - 页面
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    """主页面"""
    locale = get_locale()
    return render_template("index.html", locale=locale)


@app.route("/api/set-language/<lang>")
def set_language(lang):
    """切换语言"""
    if lang not in app.config["LANGUAGES"]:
        return jsonify({"error": "不支持的语言"}), 400
    resp = jsonify({"lang": lang, "status": "ok"})
    resp.set_cookie("lang", lang, max_age=60 * 60 * 24 * 365)  # 1年有效期
    return resp


# ---------------------------------------------------------------------------
# 路由 - 后台管理
# ---------------------------------------------------------------------------
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123"
ALLOWED_MODEL_EXT = {".glb", ".gltf"}


def _admin_logged_in():
    return session.get("admin_logged_in") is True


def _require_admin():
    """管理 API 鉴权：未登录返回 401 响应，否则返回 None"""
    if not _admin_logged_in():
        return jsonify({"error": "未登录或会话已过期，请重新登录"}), 401
    return None


@app.route("/admin")
def admin_page():
    """后台管理页面（未登录时前端渲染登录卡片）"""
    return render_template("admin.html")


@app.route("/api/admin/login", methods=["POST"])
def api_admin_login():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    password = (body.get("password") or "").strip()
    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        session["admin_logged_in"] = True
        session.permanent = True
        return jsonify({"status": "ok"})
    return jsonify({"error": "用户名或密码错误"}), 401


@app.route("/api/admin/logout", methods=["POST"])
def api_admin_logout():
    session.pop("admin_logged_in", None)
    return jsonify({"status": "ok"})


@app.route("/api/admin/status")
def api_admin_status():
    """前端启动时查询登录状态，避免刷新后丢失状态"""
    return jsonify({"logged_in": _admin_logged_in()})


# ---------------------------------------------------------------------------
# 路由 - API
# ---------------------------------------------------------------------------
@app.route("/api/models")
def api_models():
    """返回所有模型列表（含简要信息）"""
    db = get_db()
    rows = db.execute(
        """SELECT id, filename, display_name, full_name, country,
                  service_period, scale_ratio, file_size, created_at, category
           FROM models ORDER BY display_name"""
    ).fetchall()
    models = [dict(r) for r in rows]
    for m in models:
        m["exists"] = (MODELS_DIR / m["filename"]).is_file()
    return jsonify(models)


@app.route("/api/models/<int:model_id>")
def api_model_detail(model_id):
    """返回单个模型完整详情（包括介绍、尺寸、比例）"""
    db = get_db()
    row = db.execute("SELECT * FROM models WHERE id = ?", (model_id,)).fetchone()
    if row is None:
        return jsonify({"error": "模型不存在"}), 404
    m = dict(row)
    m["exists"] = (MODELS_DIR / m["filename"]).is_file()
    return jsonify(m)


# ---------------------------------------------------------------------------
# 路由 - 静态文件（模型 .glb）
# ---------------------------------------------------------------------------
@app.route("/static/models/<path:filename>")
def serve_model(filename):
    """提供 .glb 模型文件"""
    return send_from_directory(str(MODELS_DIR), filename)


# 贴图文件夹路由（存放墙面/地面共用纹理和城市GLB模型）
TEXTURE_DIR = BASE_DIR / "static" / "texture"

@app.route("/static/texture/<path:filename>")
def serve_texture(filename):
    """提供贴图文件夹内的纹理文件和GLB模型"""
    return send_from_directory(str(TEXTURE_DIR), filename)


# ---------------------------------------------------------------------------
# 路由 - 航空知识竞答 API
# ---------------------------------------------------------------------------
import json

# 资料库 JSON 路径
QUIZ_KNOWLEDGE_FILE = str(BASE_DIR / "static" / "data" / "aviation_knowledge.json")
QUIZ_BANK_FILE = str(BASE_DIR / "static" / "data" / "quiz_bank.json")


def _read_json(filepath):
    """安全读取 JSON 文件（兼容 JS 风格注释 // 和 /* */）"""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            raw = f.read()
        # 移除 /* ... */ 多行注释
        raw = re.sub(r'/\*.*?\*/', '', raw, flags=re.DOTALL)
        # 移除 // 单行注释（仅移除行内注释，不误删 URL 中的 //）
        cleaned = []
        for line in raw.split('\n'):
            in_string = False
            quote_char = None
            i = 0
            while i < len(line):
                ch = line[i]
                if not in_string:
                    if ch in ('"', "'"):
                        in_string = True
                        quote_char = ch
                    elif ch == '/' and i + 1 < len(line) and line[i + 1] == '/' and (i == 0 or line[i - 1] != ':'):
                        # 发现 // 注释（确保不是 URL 中的 //）
                        line = line[:i]
                        break
                else:
                    if ch == '\\' and i + 1 < len(line):
                        i += 1  # 跳过转义字符
                    elif ch == quote_char:
                        in_string = False
                        quote_char = None
                i += 1
            cleaned.append(line)
        cleaned_text = '\n'.join(cleaned)
        return json.loads(cleaned_text)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[Quiz] JSON 解析失败: {filepath} - {e}")
        return None


def _write_json(filepath, data):
    """安全写入 JSON 文件"""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


@app.route("/api/quiz/knowledge")
def api_quiz_knowledge():
    """返回航空知识资料库"""
    data = _read_json(QUIZ_KNOWLEDGE_FILE)
    if data is None:
        return jsonify({"error": "资料库数据文件不存在"}), 500
    return jsonify(data)


@app.route("/api/quiz/bank")
def api_quiz_bank():
    """返回题库"""
    data = _read_json(QUIZ_BANK_FILE)
    if data is None:
        return jsonify({"questions": []})
    return jsonify(data)


@app.route("/api/quiz/bank", methods=["POST"])
def api_quiz_add_question():
    """手动添加试题（POST JSON）
    请求体示例:
    {
        "id": "q026",
        "kb_id": "kb001",
        "category": "aircraft_types",
        "question": "问题文本",
        "options": ["A", "B", "C", "D"],
        "answer": 0,
        "explanation": "解析文本"
    }
    """
    new_q = request.get_json(silent=True)
    if not new_q:
        return jsonify({"error": "无效的 JSON 数据"}), 400
    # 必填字段校验
    required = ["id", "question", "options", "answer"]
    for field in required:
        if field not in new_q:
            return jsonify({"error": f"缺少必填字段: {field}"}), 400
    if not isinstance(new_q["options"], list) or len(new_q["options"]) != 4:
        return jsonify({"error": "options 必须是长度为4的数组"}), 400
    if not isinstance(new_q["answer"], int) or new_q["answer"] < 0 or new_q["answer"] > 3:
        return jsonify({"error": "answer 必须是 0-3 的整数"}), 400

    data = _read_json(QUIZ_BANK_FILE) or {"questions": []}
    # 检查 ID 是否重复
    if any(q.get("id") == new_q["id"] for q in data["questions"]):
        return jsonify({"error": f"试题 ID '{new_q['id']}' 已存在"}), 409
    # 补充默认字段
    new_q.setdefault("kb_id", "")
    new_q.setdefault("category", "aircraft_types")
    new_q.setdefault("explanation", "")
    data["questions"].append(new_q)
    _write_json(QUIZ_BANK_FILE, data)
    return jsonify({"status": "ok", "message": f"试题 {new_q['id']} 添加成功", "total": len(data["questions"])}), 201


# ---------------------------------------------------------------------------
# 路由 - 错题导出 API
# ---------------------------------------------------------------------------
WRONG_EXPORT_DIR = str(BASE_DIR / "wrong_exports")


@app.route("/api/quiz/wrong/export", methods=["POST"])
def api_quiz_wrong_export():
    """导出错题文档为TXT文件，保存至项目 wrong_exports/ 目录"""
    body = request.get_json(silent=True)
    if not body or "content" not in body:
        return jsonify({"status": "error", "error": "缺少 content 字段"}), 400

    content = body.get("content", "")
    # 生成带时间戳的文件名
    from datetime import datetime
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"wrong_answers_{timestamp}.txt"

    os.makedirs(WRONG_EXPORT_DIR, exist_ok=True)
    filepath = os.path.join(WRONG_EXPORT_DIR, filename)

    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"status": "ok", "filename": filename})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


# ---------------------------------------------------------------------------
# 路由 - 后台管理：知识条目 CRUD（aviation_knowledge.json）
# ---------------------------------------------------------------------------
def _knowledge_data():
    return _read_json(QUIZ_KNOWLEDGE_FILE) or {"categories": [], "knowledge_items": []}


def _gen_next_id(items, prefix):
    """生成下一个自增 ID，如 kb026 / q026"""
    max_num = 0
    for it in items:
        m = re.match(r"^(?:[a-zA-Z]+)(\d+)$", str(it.get("id", "")))
        if m:
            max_num = max(max_num, int(m.group(1)))
    return f"{prefix}{max_num + 1:03d}"


def _validate_kb_item(item):
    """知识条目字段校验，返回错误信息或 None"""
    if not (item.get("title") or "").strip():
        return "标题不能为空"
    if not (item.get("content") or "").strip():
        return "内容不能为空"
    category = (item.get("category") or "").strip()
    if not category:
        return "请选择分类"
    return None


@app.route("/api/admin/knowledge", methods=["GET"])
def api_admin_knowledge_list():
    if _require_admin(): return _require_admin()
    return jsonify(_knowledge_data())


@app.route("/api/admin/knowledge", methods=["POST"])
def api_admin_knowledge_add():
    if _require_admin(): return _require_admin()
    body = request.get_json(silent=True) or {}
    item = {
        "id": body.get("id") or None,
        "category": body.get("category", ""),
        "title": body.get("title", ""),
        "content": body.get("content", ""),
        "source": body.get("source", ""),
        "keywords": body.get("keywords") or [],
    }
    err = _validate_kb_item(item)
    if err:
        return jsonify({"error": err}), 400
    data = _knowledge_data()
    valid_cats = {c["id"] for c in data.get("categories", [])}
    if item["category"] not in valid_cats:
        return jsonify({"error": f"分类 '{item['category']}' 不存在"}), 400
    if not item["id"]:
        item["id"] = _gen_next_id(data["knowledge_items"], "kb")
    if any(it.get("id") == item["id"] for it in data["knowledge_items"]):
        return jsonify({"error": f"条目 ID '{item['id']}' 已存在"}), 409
    data["knowledge_items"].append(item)
    _write_json(QUIZ_KNOWLEDGE_FILE, data)
    return jsonify({"status": "ok", "item": item, "total": len(data["knowledge_items"])}), 201


@app.route("/api/admin/knowledge/<item_id>", methods=["PUT"])
def api_admin_knowledge_update(item_id):
    if _require_admin(): return _require_admin()
    body = request.get_json(silent=True) or {}
    data = _knowledge_data()
    target = None
    for it in data["knowledge_items"]:
        if it.get("id") == item_id:
            target = it
            break
    if target is None:
        return jsonify({"error": f"条目 {item_id} 不存在"}), 404
    merged = {
        "id": item_id,
        "category": body.get("category", target.get("category", "")),
        "title": body.get("title", target.get("title", "")),
        "content": body.get("content", target.get("content", "")),
        "source": body.get("source", target.get("source", "")),
        "keywords": body.get("keywords", target.get("keywords", [])),
    }
    err = _validate_kb_item(merged)
    if err:
        return jsonify({"error": err}), 400
    data["knowledge_items"] = [merged if it.get("id") == item_id else it for it in data["knowledge_items"]]
    _write_json(QUIZ_KNOWLEDGE_FILE, data)
    return jsonify({"status": "ok", "item": merged})


@app.route("/api/admin/knowledge/<item_id>", methods=["DELETE"])
def api_admin_knowledge_delete(item_id):
    if _require_admin(): return _require_admin()
    data = _knowledge_data()
    before = len(data["knowledge_items"])
    data["knowledge_items"] = [it for it in data["knowledge_items"] if it.get("id") != item_id]
    if len(data["knowledge_items"]) == before:
        return jsonify({"error": f"条目 {item_id} 不存在"}), 404
    # 同步删除题库中引用该知识点的题目，避免悬空引用
    bank = _read_json(QUIZ_BANK_FILE) or {"questions": []}
    bank["questions"] = [q for q in bank.get("questions", []) if q.get("kb_id") != item_id]
    _write_json(QUIZ_BANK_FILE, bank)
    _write_json(QUIZ_KNOWLEDGE_FILE, data)
    return jsonify({"status": "ok", "total": len(data["knowledge_items"])})


# ---------------------------------------------------------------------------
# 路由 - 后台管理：题库 CRUD（quiz_bank.json）
# ---------------------------------------------------------------------------
def _bank_data():
    return _read_json(QUIZ_BANK_FILE) or {"questions": []}


def _validate_question(q):
    if not (q.get("question") or "").strip():
        return "题干不能为空"
    options = q.get("options")
    if not isinstance(options, list) or len(options) != 4 or any(not str(o).strip() for o in options):
        return "选项必须是 4 个非空文本"
    answer = q.get("answer")
    if not isinstance(answer, int) or answer < 0 or answer > 3:
        return "正确答案必须是 0-3 的选项序号"
    return None


@app.route("/api/admin/questions", methods=["GET"])
def api_admin_question_list():
    if _require_admin(): return _require_admin()
    return jsonify(_bank_data())


@app.route("/api/admin/questions", methods=["POST"])
def api_admin_question_add():
    if _require_admin(): return _require_admin()
    body = request.get_json(silent=True) or {}
    q = {
        "id": body.get("id") or None,
        "kb_id": body.get("kb_id", ""),
        "category": body.get("category", "aircraft_types"),
        "question": body.get("question", ""),
        "options": body.get("options") or [],
        "answer": body.get("answer"),
        "explanation": body.get("explanation", ""),
    }
    err = _validate_question(q)
    if err:
        return jsonify({"error": err}), 400
    data = _bank_data()
    if not q["id"]:
        q["id"] = _gen_next_id(data["questions"], "q")
    if any(x.get("id") == q["id"] for x in data["questions"]):
        return jsonify({"error": f"题目 ID '{q['id']}' 已存在"}), 409
    data["questions"].append(q)
    _write_json(QUIZ_BANK_FILE, data)
    return jsonify({"status": "ok", "item": q, "total": len(data["questions"])}), 201


@app.route("/api/admin/questions/<qid>", methods=["PUT"])
def api_admin_question_update(qid):
    if _require_admin(): return _require_admin()
    body = request.get_json(silent=True) or {}
    data = _bank_data()
    target = next((x for x in data["questions"] if x.get("id") == qid), None)
    if target is None:
        return jsonify({"error": f"题目 {qid} 不存在"}), 404
    merged = {
        "id": qid,
        "kb_id": body.get("kb_id", target.get("kb_id", "")),
        "category": body.get("category", target.get("category", "aircraft_types")),
        "question": body.get("question", target.get("question", "")),
        "options": body.get("options", target.get("options", [])),
        "answer": body.get("answer", target.get("answer", 0)),
        "explanation": body.get("explanation", target.get("explanation", "")),
    }
    err = _validate_question(merged)
    if err:
        return jsonify({"error": err}), 400
    data["questions"] = [merged if x.get("id") == qid else x for x in data["questions"]]
    _write_json(QUIZ_BANK_FILE, data)
    return jsonify({"status": "ok", "item": merged})


@app.route("/api/admin/questions/<qid>", methods=["DELETE"])
def api_admin_question_delete(qid):
    if _require_admin(): return _require_admin()
    data = _bank_data()
    before = len(data["questions"])
    data["questions"] = [x for x in data["questions"] if x.get("id") != qid]
    if len(data["questions"]) == before:
        return jsonify({"error": f"题目 {qid} 不存在"}), 404
    _write_json(QUIZ_BANK_FILE, data)
    return jsonify({"status": "ok", "total": len(data["questions"])})


# ---------------------------------------------------------------------------
# 路由 - 后台管理：模型管理（SQLite + 文件）
# ---------------------------------------------------------------------------
MODEL_TEXT_FIELDS = [
    "display_name", "full_name", "country", "service_period", "usage_desc",
    "scale_ratio", "category",
]
MODEL_REAL_FIELDS = [
    "real_length_m", "real_wingspan_m", "real_height_m",
    "model_length", "model_wingspan", "model_height",
    "weight", "glide_coe", "wind_coe", "bounce",
]


def _model_row_to_dict(row):
    m = dict(row)
    m["exists"] = (MODELS_DIR / m["filename"]).is_file()
    return m


@app.route("/api/admin/models", methods=["GET"])
def api_admin_model_list():
    if _require_admin(): return _require_admin()
    db = get_db()
    rows = db.execute("SELECT * FROM models ORDER BY display_name").fetchall()
    return jsonify([_model_row_to_dict(r) for r in rows])


@app.route("/api/admin/models", methods=["POST"])
def api_admin_model_upload():
    """上传新模型（multipart/form-data）:
    file: .glb/.gltf 文件
    meta: JSON 字符串（display_name 必填，其余元数据可选）
    """
    if _require_admin(): return _require_admin()
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify({"error": "请选择模型文件"}), 400
    orig_name = file.filename
    suffix = Path(orig_name).suffix.lower()
    if suffix not in ALLOWED_MODEL_EXT:
        return jsonify({"error": f"仅支持 {', '.join(sorted(ALLOWED_MODEL_EXT))} 格式"}), 400

    import json as _json
    try:
        meta = _json.loads(request.form.get("meta") or "{}")
    except _json.JSONDecodeError:
        return jsonify({"error": "meta 不是合法的 JSON"}), 400

    display_name = (meta.get("display_name") or "").strip()
    if not display_name:
        return jsonify({"error": "显示名称不能为空"}), 400

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    # 文件名防冲突：重名时自动追加序号
    safe_base = re.sub(r"[\\/:*?\"<>|]+", "_", Path(orig_name).stem) or "model"
    filename = f"{safe_base}{suffix}"
    counter = 2
    db = get_db()
    while True:
        dup = db.execute("SELECT id FROM models WHERE filename = ?", (filename,)).fetchone()
        file_exists = (MODELS_DIR / filename).is_file()
        if dup is None and not file_exists:
            break
        filename = f"{safe_base}_{counter}{suffix}"
        counter += 1

    save_path = MODELS_DIR / filename
    file.save(str(save_path))
    file_size = save_path.stat().st_size

    # 物理参数：优先用表单值，否则按 category 取默认值
    category = meta.get("category") or "fighter"
    defaults = {"fighter": (0.4, 0.7, 0.3, 0.5),
                "airliner": (0.8, 1.3, 0.2, 0.3),
                "transport": (1.0, 1.0, 0.8, 0.7)}
    w, gl, wc, bo = defaults.get(category, (0.5, 1.0, 0.3, 0.5))

    def _num(key, fallback):
        try:
            return float(meta[key]) if meta.get(key) not in (None, "") else fallback
        except (TypeError, ValueError):
            return fallback

    db.execute(
        """INSERT INTO models
           (filename, display_name, full_name, country, service_period, usage_desc,
            real_length_m, real_wingspan_m, real_height_m,
            model_length, model_wingspan, model_height, scale_ratio,
            file_size, file_path, category, weight, glide_coe, wind_coe, bounce)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            filename, display_name, meta.get("full_name", ""), meta.get("country", ""),
            meta.get("service_period", ""), meta.get("usage_desc", ""),
            _num("real_length_m", 0), _num("real_wingspan_m", 0), _num("real_height_m", 0),
            _num("model_length", 0), _num("model_wingspan", 0), _num("model_height", 0),
            meta.get("scale_ratio", ""), file_size, f"/static/models/{filename}",
            category, _num("weight", w), _num("glide_coe", gl), _num("wind_coe", wc), _num("bounce", bo),
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM models WHERE filename = ?", (filename,)).fetchone()
    return jsonify({"status": "ok", "model": _model_row_to_dict(row)}), 201


@app.route("/api/admin/models/<int:model_id>", methods=["PUT"])
def api_admin_model_update(model_id):
    """编辑模型元数据（不含文件本身）"""
    if _require_admin(): return _require_admin()
    db = get_db()
    row = db.execute("SELECT * FROM models WHERE id = ?", (model_id,)).fetchone()
    if row is None:
        return jsonify({"error": f"模型 {model_id} 不存在"}), 404
    body = request.get_json(silent=True) or {}
    sets, vals = [], []
    for f in MODEL_TEXT_FIELDS:
        if f in body:
            sets.append(f"{f} = ?")
            vals.append(str(body[f]) if body[f] is not None else "")
    for f in MODEL_REAL_FIELDS:
        if f in body:
            try:
                sets.append(f"{f} = ?")
                vals.append(float(body[f]) if body[f] not in (None, "") else 0.0)
            except (TypeError, ValueError):
                return jsonify({"error": f"字段 {f} 必须是数字"}), 400
    if not sets:
        return jsonify({"error": "没有可更新的字段"}), 400
    vals.append(model_id)
    db.execute(f"UPDATE models SET {', '.join(sets)} WHERE id = ?", vals)
    db.commit()
    new_row = db.execute("SELECT * FROM models WHERE id = ?", (model_id,)).fetchone()
    return jsonify({"status": "ok", "model": _model_row_to_dict(new_row)})


@app.route("/api/admin/models/<int:model_id>", methods=["DELETE"])
def api_admin_model_delete(model_id):
    """删除模型：数据库记录 + 磁盘文件"""
    if _require_admin(): return _require_admin()
    db = get_db()
    row = db.execute("SELECT * FROM models WHERE id = ?", (model_id,)).fetchone()
    if row is None:
        return jsonify({"error": f"模型 {model_id} 不存在"}), 404
    filename = row["filename"]
    db.execute("DELETE FROM models WHERE id = ?", (model_id,))
    db.commit()
    target = MODELS_DIR / filename
    file_removed = False
    if target.is_file():
        try:
            target.unlink()
            file_removed = True
        except OSError as e:
            print(f"[Admin] 模型文件删除失败: {target} - {e}")
    return jsonify({"status": "ok", "file_removed": file_removed})


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    print(f"[INFO] 数据库: {DATABASE}")
    print(f"[INFO] 模型目录: {MODELS_DIR}")
    print("[INFO] 启动 Flask 开发服务器 -> http://127.0.0.1:5000")
    app.run(debug=True, host="0.0.0.0", port=5000)
