"""
Flask + SQLite 飞机3D模型浏览器 - 后端
"""
import os
import sqlite3
from pathlib import Path

from flask import Flask, g, jsonify, render_template, send_from_directory, request
from flask_babel import Babel, _

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATABASE = str(BASE_DIR / "models.db")
MODELS_DIR = BASE_DIR / "static" / "models"

app = Flask(__name__)
app.config["SECRET_KEY"] = "aviation-3d-viewer-2024"

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
    }
    for col, col_def in new_cols.items():
        if col not in existing_cols:
            db.execute(f"ALTER TABLE models ADD COLUMN {col} {col_def}")
    db.commit()
    db.close()


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
# 路由 - API
# ---------------------------------------------------------------------------
@app.route("/api/models")
def api_models():
    """返回所有模型列表（含简要信息）"""
    db = get_db()
    rows = db.execute(
        """SELECT id, filename, display_name, full_name, country,
                  service_period, scale_ratio, file_size, created_at
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