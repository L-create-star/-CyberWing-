// ═══════════════════════════════════════════════════════════════
// 航空知识竞答板块 JS (Quiz Battle Module)
// Phase 1: 知识库/题库加载、渲染、答题逻辑
// Phase 2: 跨模块联动 - 3D模型↔知识库↔竞答 完整跳转
// ═══════════════════════════════════════════════════════════════

// ===== 0. 全局状态 =====
var QuizState = {
    showing: 'library',  // 'library' | 'solo' | 'pvp' | 'result' | 'mode'
    knowledgeData: null,
    quizBank: null,
    wrongSet: [],          // 错题集
    configQuestionCount: 10,
    configTimeMode: 'unlimited',
    configTimePerQ: 30,
    configDifficulty: 'all',
    soloQuestions: [],
    soloIndex: 0,
    soloScore: 0,
    soloAnsweredList: [],
    soloQuestionTimes: [],
    soloQuestionStartTime: null,
    soloTimer: null,
    pvpTotal: 10,
    pvpQuestions: [],
    pvpIndex: 0,
    pvpCurrentPlayer: 1,
    pvpScore: { 1: 0, 2: 0 },
    pvpAnsweredCount: { 1: 0, 2: 0 },
    pvpAnsweredList: [],
    pvpQuestionTimes: [],
    pvpCurrentAnswered: false,
    pvpQuestionStartTime: null,
    pvpTimer: null,
    lastResultType: null,
    // 知识库分页
    kbPage: 1,
    kbPageSize: 10,
    kbSearchQuery: '',
    kbFilterCategory: '',
};

// ===== 0. 国际化辅助 =====
var _quizLang = document.documentElement.lang || 'zh';
function qt(key, fallback) {
    if (window._t) return window._t(key) || fallback || key;
    return fallback || key;
}

// 机型显示名称映射（用于导航到3D模型时匹配）
var MODEL_NAME_MAP = {
    'mig-29': 'Mikoyan MIG-29',
    'mi-28': 'mil mi 28',
    'a6m': 'Mitsubishi A6M',
    'f-2': 'Mitsubishi F-2',
    'f-15j': 'Mitsubishi F-15J v1',
    'ms-n': 'Morane Salnier N',
    'b5n': 'Nakajima B5N',
    'ki-27': 'Nakajima Ki-27',
    'ki-44': 'Nakajima KI-44',
    'b-25j': 'North American B-25J Mitchell',
    'f-82': 'North American F-82 Twin Mustang',
    'f-86': 'North American F-86 Sabre v2',
    'p-51d': 'North American P-51D Mustang',
    'f-100': 'North Anerican F-100 Super Sabre',
    'p-51c': 'north-american-p-51c-mustang',
    'ea-6b': 'Northrop Grumman EA-6B Prowler',
    't-38': 'Northrop T-38 Talon',
    't-38-ii': 'Northrop T-38 Talon II',
    'f-5': 'northrop-f5',
    'yb-35': 'northrop-yb-35',
    't-2': 'Nortth American T-2 Buckeye v1',
    'p-80a': 'P-80A Shooting Star v1',
    'jf-17': 'pac-jf-17-thunder-cac-fc-1-fighter-aircraft',
    'pby-5a': 'PBY-5A  Catalina v2',
    'y-20': 'Xian Y-20',
};

// ===== 1. 知识库加载与渲染 =====
function quizLoadKnowledgeData(callback) {
    if (QuizState.knowledgeData) {
        if (callback) callback(QuizState.knowledgeData);
        return;
    }
    fetch('/static/data/aviation_knowledge.json?v=' + Date.now())
        .then(function (r) { return r.json(); })
        .then(function (data) {
            QuizState.knowledgeData = data;
            if (callback) callback(data);
        })
        .catch(function () {
            console.error('[quiz] 知识库加载失败');
        });
}

function quizLoadQuizBank(callback) {
    if (QuizState.quizBank) {
        if (callback) callback(QuizState.quizBank);
        return;
    }
    fetch('/static/data/quiz_bank.json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            QuizState.quizBank = data;
            if (callback) callback(data);
        })
        .catch(function () {
            console.error('[quiz] 题库加载失败');
        });
}

// ===== 2. 知识库面板渲染 =====
function quizRenderKBLibrary() {
    QuizState.showing = 'library';
    hideAllBattlePanels();
    var panel = document.getElementById('quiz-library-panel');
    if (!panel) {
        // 如果library面板不存在，尝试创建
        var container = document.getElementById('quiz-panel-library');
        if (!container) {
            // 尝试在quiz-content中创建
            var qc = document.getElementById('quiz-content');
            if (qc) {
                qc.innerHTML = '<div id="quiz-library-panel"><div id="kb-list"></div><div id="kb-pagination"></div></div>';
                panel = document.getElementById('quiz-library-panel');
            }
        }
    }
    if (!panel) {
        // 新布局下 library 面板随答题区隐藏，回到资料库主态
        quizShowKBHome();
        return;
    }
    panel.style.display = 'block';

    if (QuizState.knowledgeData) {
        _renderKBList(panel);
    } else {
        panel.innerHTML = '<div style="text-align:center;padding:40px;">知识库加载中...</div>';
        quizLoadKnowledgeData(function (data) {
            if (QuizState.showing === 'library') {
                _renderKBList(panel);
            }
        });
    }
}

function _renderKBList(panel) {
    var data = QuizState.knowledgeData;
    if (!data || !data.knowledge_items) {
        panel.innerHTML = '<div style="text-align:center;padding:40px;">知识库数据为空</div>';
        return;
    }

    var allItems = data.knowledge_items;
    // 筛选
    var filtered = allItems;
    if (QuizState.kbSearchQuery) {
        var q = QuizState.kbSearchQuery.toLowerCase();
        filtered = filtered.filter(function (item) {
            return (item.title || '').toLowerCase().indexOf(q) >= 0 ||
                (item.content || '').toLowerCase().indexOf(q) >= 0;
        });
    }
    if (QuizState.kbFilterCategory) {
        filtered = filtered.filter(function (item) {
            return item.category === QuizState.kbFilterCategory;
        });
    }

    var totalPages = Math.ceil(filtered.length / QuizState.kbPageSize);
    var startIdx = (QuizState.kbPage - 1) * QuizState.kbPageSize;
    var pageItems = filtered.slice(startIdx, startIdx + QuizState.kbPageSize);

    // 分类筛选
    var categories = {};
    allItems.forEach(function (item) {
        var cat = item.category || 'other';
        if (!categories[cat]) categories[cat] = 0;
        categories[cat]++;
    });
    var catMap = { 'aircraft_types': '民航机型', 'aircraft_structure': '飞行器结构', 'airworthiness': '航空适航标准', 'engine': '航发知识', 'regulations': '航空行业法规', 'aviation_history': '航空历史与里程碑', 'aerodynamics': '飞行原理与空气动力学', 'avionics': '航空电子与航电系统', 'materials': '航空材料与制造工艺', 'atm': '空中交通管理与空域', 'safety': '航空安全与事故调查', 'military_aviation': '军用航空与著名战机', 'meteorology': '航空气象', 'helicopter': '直升机与旋翼机', 'spaceflight': '航天工程与太空飞行', 'airport': '机场与基础设施', 'aviation_medicine': '航空医学与人体工程', 'flight_sim': '飞行模拟与训练', 'aerial_survey': '航空摄影与遥感', 'aviation_economy': '航空经济与运营', 'uav_drones': '无人机与新兴应用', 'other': '其他' };

    var html = '';

    // 搜索和筛选栏
    html += '<div class="kb-toolbar">';
    html += '<div class="kb-search-wrap"><input type="text" id="kb-search-input" placeholder="搜索知识库..." value="' + escapeHtml(QuizState.kbSearchQuery) + '" oninput="quizKBSearch()"></div>';
    html += '<div class="kb-filter-wrap"><select id="kb-filter-select" onchange="quizKBFilter(this.value)">';
    html += '<option value="">全部分类 (' + allItems.length + ')</option>';
    for (var c in categories) {
        if (!categories.hasOwnProperty(c)) continue;
        var cn = catMap[c] || c;
        var sel = (QuizState.kbFilterCategory === c) ? ' selected' : '';
        html += '<option value="' + c + '"' + sel + '>' + cn + ' (' + categories[c] + ')</option>';
    }
    html += '</select></div>';
    html += '</div>';

    // 知识点卡片列表
    html += '<div class="kb-card-list">';
    if (pageItems.length === 0) {
        html += '<div class="kb-empty">没有找到匹配的知识点</div>';
    } else {
        pageItems.forEach(function (item) {
            var catName = catMap[item.category] || item.category;
            var contentPreview = (item.content || '').length > 120 ? item.content.substring(0, 120) + '...' : (item.content || '');
            html += '<div class="kb-card" data-kb-id="' + item.id + '">';
            html += '<div class="kb-card-header">';
            html += '<span class="kb-card-cat">' + catName + '</span>';
            html += '<span class="kb-card-title">' + escapeHtml(item.title) + '</span>';
            html += '</div>';
            html += '<div class="kb-card-body">' + escapeHtml(contentPreview) + '</div>';
            html += '<div class="kb-card-source">来源: ' + escapeHtml(item.source || '无') + '</div>';
            html += '<div class="kb-card-actions">';
            html += '<button class="kb-card-btn detail-btn" onclick="quizShowKBDetailModal(\'' + item.id + '\')">📖 查看详情</button>';
            html += '<button class="kb-card-btn model3d-btn" onclick="quizNavTo3DModel(\'' + item.id + '\')">✈ 查看对应3D模型</button>';
            html += '<button class="kb-card-btn quiz-btn" onclick="quizNavToQuizByCat(\'' + (item.category || '') + '\')">🏆 同类题目练习</button>';
            html += '</div>';
            html += '</div>';
        });
    }
    html += '</div>';

    // 分页
    if (totalPages > 1) {
        html += '<div class="kb-pagination">';
        html += '<button class="kb-page-btn" ' + (QuizState.kbPage <= 1 ? 'disabled' : '') + ' onclick="quizKBGoPage(' + (QuizState.kbPage - 1) + ')">◀ 上一页</button>';
        html += '<span class="kb-page-info">第 ' + QuizState.kbPage + ' / ' + totalPages + ' 页</span>';
        html += '<button class="kb-page-btn" ' + (QuizState.kbPage >= totalPages ? 'disabled' : '') + ' onclick="quizKBGoPage(' + (QuizState.kbPage + 1) + ')">下一页 ▶</button>';
        html += '</div>';
    }

    panel.innerHTML = html;
}

function quizKBSearch() {
    var input = document.getElementById('kb-search-input');
    QuizState.kbSearchQuery = input ? input.value : '';
    QuizState.kbPage = 1;
    quizRenderKBLibrary();
}

// ===== 2.5 左侧航空资料库面板（quiz-kb-panel）渲染 =====
// 面板 DOM：#quiz-kb-categories（分类目录）/ #quiz-kb-list（知识点列表）/ #quiz-kb-pagination（分页）
// 搜索框 #quiz-search-input 绑定 quizSearchKeyup

var QUIZ_KB_CAT_MAP = {
    'aircraft_types': '民航机型',
    'aircraft_structure': '飞行器结构',
    'airworthiness': '航空适航标准',
    'engine': '航发知识',
    'regulations': '航空行业法规',
    'aviation_history': '航空历史与里程碑',
    'aerodynamics': '飞行原理与空气动力学',
    'avionics': '航空电子与航电系统',
    'materials': '航空材料与制造工艺',
    'atm': '空中交通管理与空域',
    'safety': '航空安全与事故调查',
    'military_aviation': '军用航空与著名战机',
    'meteorology': '航空气象',
    'helicopter': '直升机与旋翼机',
    'spaceflight': '航天工程与太空飞行',
    'airport': '机场与基础设施',
    'aviation_medicine': '航空医学与人体工程',
    'flight_sim': '飞行模拟与训练',
    'aerial_survey': '航空摄影与遥感',
    'aviation_economy': '航空经济与运营',
    'uav_drones': '无人机与新兴应用',
    'other': '其他'
};

/** 渲染左侧面板：分类目录 + 知识点列表 + 分页器（数据未加载时自动等待） */
function quizRenderKBSidebar() {
    // 先渲染卡片墙
    quizRenderKBCardWall();

    var catBox = document.getElementById('quiz-kb-categories');
    var listBox = document.getElementById('quiz-kb-list');
    if (!catBox || !listBox) return;

    if (!QuizState.knowledgeData || !QuizState.knowledgeData.knowledge_items) {
        catBox.innerHTML = '';
        listBox.innerHTML = '<div class="kb-empty">资料库加载中...</div>';
        quizLoadKnowledgeData(function () {
            if (document.getElementById('quiz-container') &&
                document.getElementById('quiz-container').style.display !== 'none') {
                quizRenderKBSidebar();
            }
        });
        return;
    }
    _renderKBCategories(catBox);
    _renderKBListLeft(listBox);
    _renderKBPagination();
    var libTab = document.getElementById('quiz-tab-library');
    var quizTab = document.getElementById('quiz-tab-quiz');
    if (libTab) libTab.classList.add('active');
    if (quizTab) quizTab.classList.remove('active');
}

/** 渲染知识卡片墙 */
function quizRenderKBCardWall() {
    var grid = document.getElementById('kb-card-grid');
    if (!grid) return;

    if (!QuizState.knowledgeData || !QuizState.knowledgeData.knowledge_items) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-mid);">加载中...</div>';
        quizLoadKnowledgeData(function () {
            quizRenderKBCardWall();
        });
        return;
    }

    var cats = QuizState.knowledgeData.categories;
    var items = QuizState.knowledgeData.knowledge_items;
    var counts = {};
    items.forEach(function (it) {
        var c = it.category || 'other';
        counts[c] = (counts[c] || 0) + 1;
    });

    var html = '';
    cats.forEach(function (cat) {
        var count = counts[cat.id] || 0;
        var imgPath = '/static/images/kb-covers/' + cat.id + '.jpg';
        html += '<div class="kb-category-card" onclick="quizOpenCategoryDetail(\'' + cat.id + '\')">';
        html += '<img src="' + imgPath + '" alt="' + cat.name + '" loading="lazy" decoding="async" onerror="this.style.display=\'none\'">';
        html += '<div class="kb-card-overlay">';
        html += '<div class="kb-card-name">' + cat.name + '</div>';
        html += '<div class="kb-card-count">' + count + ' 条</div>';
        html += '</div></div>';
    });
    grid.innerHTML = html;

    // 默认显示卡片墙，隐藏详情
    var wall = document.getElementById('kb-card-wall');
    var detail = document.getElementById('kb-category-detail');
    if (wall) wall.style.display = '';
    if (detail) detail.style.display = 'none';
}

/** 点击卡片进入分类详情 */
function quizOpenCategoryDetail(catId) {
    var cat = null;
    var cats = QuizState.knowledgeData.categories;
    for (var i = 0; i < cats.length; i++) {
        if (cats[i].id === catId) { cat = cats[i]; break; }
    }
    if (!cat) return;

    // 切换视图
    document.getElementById('kb-card-wall').style.display = 'none';
    document.getElementById('kb-category-detail').style.display = '';

    // 设置标题
    var titleEl = document.getElementById('kb-detail-title');
    if (titleEl) titleEl.textContent = cat.name;

    // 筛选该分类
    QuizState.kbFilterCategory = catId;
    QuizState.kbPage = 1;
    QuizState.kbSearchQuery = '';

    // 渲染列表
    var listBox = document.getElementById('quiz-kb-list');
    var pagBox = document.getElementById('quiz-kb-pagination');
    if (listBox) _renderKBListLeft(listBox);
    if (pagBox) _renderKBPagination();
}

/** 返回卡片墙 */
function quizBackToCardWall() {
    document.getElementById('kb-card-wall').style.display = '';
    document.getElementById('kb-category-detail').style.display = 'none';
    QuizState.kbFilterCategory = '';
    QuizState.kbPage = 1;
}

/** 左侧分类目录（含"全部"项） */
function _renderKBCategories(catBox) {
    var items = QuizState.knowledgeData.knowledge_items;
    var counts = {};
    items.forEach(function (it) {
        var c = it.category || 'other';
        counts[c] = (counts[c] || 0) + 1;
    });
    var html = '<div class="kb-cat-item kb-cat-all' + (QuizState.kbFilterCategory === '' ? ' active' : '') + '" onclick="quizKBSidebarFilter(\'\')">▸ 全部条目 (' + items.length + ')</div>';
    for (var c in counts) {
        if (!counts.hasOwnProperty(c)) continue;
        var cn = QUIZ_KB_CAT_MAP[c] || c;
        html += '<div class="kb-cat-item' + (QuizState.kbFilterCategory === c ? ' active' : '') + '" onclick="quizKBSidebarFilter(\'' + c + '\')">▸ ' + cn + ' (' + counts[c] + ')</div>';
    }
    catBox.innerHTML = html;
}

/** 左侧知识点列表（卡片形式，点击查看详情弹窗） */
function _renderKBListLeft(listBox) {
    var data = QuizState.knowledgeData;
    var filtered = data.knowledge_items;
    if (QuizState.kbSearchQuery) {
        var q = QuizState.kbSearchQuery.toLowerCase();
        filtered = filtered.filter(function (item) {
            return (item.title || '').toLowerCase().indexOf(q) >= 0 ||
                (item.content || '').toLowerCase().indexOf(q) >= 0;
        });
    }
    if (QuizState.kbFilterCategory) {
        filtered = filtered.filter(function (item) { return item.category === QuizState.kbFilterCategory; });
    }
    var totalPages = Math.ceil(filtered.length / QuizState.kbPageSize);
    if (QuizState.kbPage > totalPages && totalPages > 0) QuizState.kbPage = totalPages;
    var startIdx = (QuizState.kbPage - 1) * QuizState.kbPageSize;
    var pageItems = filtered.slice(startIdx, startIdx + QuizState.kbPageSize);

    var html = '';
    if (pageItems.length === 0) {
        html = '<div class="kb-empty">没有找到匹配的知识点</div>';
    } else {
        pageItems.forEach(function (item) {
            var catName = QUIZ_KB_CAT_MAP[item.category] || item.category || '其他';
            var preview = (item.content || '').length > 100 ? item.content.substring(0, 100) + '...' : (item.content || '');
            html += '<div class="kb-card" data-kb-id="' + item.id + '">';
            html += '<div class="kb-card-header"><span class="kb-card-cat">' + catName + '</span>';
            html += '<span class="kb-card-title">' + escapeHtml(item.title) + '</span></div>';
            html += '<div class="kb-card-body">' + escapeHtml(preview) + '</div>';
            html += '<div class="kb-card-source">来源: ' + escapeHtml(item.source || '无') + '</div>';
            html += '<div class="kb-card-actions">';
            html += '<button class="kb-card-btn detail-btn" onclick="quizShowKBDetailModal(\'' + item.id + '\')">📖 查看详情</button>';
            html += '<button class="kb-card-btn model3d-btn" onclick="quizNavTo3DModel(\'' + item.id + '\')">✈ 3D模型</button>';
            html += '</div></div>';
        });
    }
    listBox.innerHTML = html;
}

/** 左侧分页器（写入 #quiz-kb-pagination） */
function _renderKBPagination() {
    var pageBox = document.getElementById('quiz-kb-pagination');
    if (!pageBox) return;
    var data = QuizState.knowledgeData;
    var filtered = data.knowledge_items;
    if (QuizState.kbSearchQuery) {
        var q = QuizState.kbSearchQuery.toLowerCase();
        filtered = filtered.filter(function (item) {
            return (item.title || '').toLowerCase().indexOf(q) >= 0 ||
                (item.content || '').toLowerCase().indexOf(q) >= 0;
        });
    }
    if (QuizState.kbFilterCategory) {
        filtered = filtered.filter(function (item) { return item.category === QuizState.kbFilterCategory; });
    }
    var totalPages = Math.ceil(filtered.length / QuizState.kbPageSize);
    if (totalPages <= 1) { pageBox.innerHTML = ''; return; }
    var html = '<button class="kb-page-btn" ' + (QuizState.kbPage <= 1 ? 'disabled' : '') + ' onclick="quizKBSidebarGoPage(' + (QuizState.kbPage - 1) + ')">◀ 上一页</button>';
    html += '<span class="kb-page-info">第 ' + QuizState.kbPage + ' / ' + totalPages + ' 页</span>';
    html += '<button class="kb-page-btn" ' + (QuizState.kbPage >= totalPages ? 'disabled' : '') + ' onclick="quizKBSidebarGoPage(' + (QuizState.kbPage + 1) + ')">下一页 ▶</button>';
    pageBox.innerHTML = html;
}

/** 左侧分类筛选（保持右侧同步） */
function quizKBSidebarFilter(category) {
    QuizState.kbFilterCategory = category;
    QuizState.kbPage = 1;
    quizRenderKBSidebar();
}

/** 左侧分页跳转 */
function quizKBSidebarGoPage(page) {
    QuizState.kbPage = page < 1 ? 1 : page;
    if (_kbIsCategoryDetailView()) {
        // 分类详情视图：只重绘列表与分页器，避免触发卡片墙重绘导致跳回主页
        var listBox = document.getElementById('quiz-kb-list');
        var pagBox = document.getElementById('quiz-kb-pagination');
        if (listBox) _renderKBListLeft(listBox);
        if (pagBox) _renderKBPagination();
        return;
    }
    quizRenderKBSidebar();
}

/** 左侧搜索框 keyup（HTML 绑定，此前函数不存在） */
function quizSearchKeyup(event) {
    var input = document.getElementById('quiz-search-input');
    QuizState.kbSearchQuery = input ? input.value : '';
    QuizState.kbPage = 1;
    if (_kbIsCategoryDetailView()) {
        // 分类详情页：仅重绘列表与分页器，保持详情视图
        var listBox = document.getElementById('quiz-kb-list');
        var pagBox = document.getElementById('quiz-kb-pagination');
        if (listBox) _renderKBListLeft(listBox);
        if (pagBox) _renderKBPagination();
        return;
    }
    quizRenderKBSidebar();
}

/** 判断当前是否处于分类详情视图（卡片点开后的详情页） */
function _kbIsCategoryDetailView() {
    var detail = document.getElementById('kb-category-detail');
    return !!(detail && detail.style.display !== 'none');
}

function quizKBFilter(val) {
    QuizState.kbFilterCategory = val;
    QuizState.kbPage = 1;
    quizRenderKBLibrary();
}

function quizKBGoPage(page) {
    var data = QuizState.knowledgeData;
    if (!data || !data.knowledge_items) return;
    var filtered = data.knowledge_items;
    if (QuizState.kbSearchQuery) {
        var q = QuizState.kbSearchQuery.toLowerCase();
        filtered = filtered.filter(function (item) {
            return (item.title || '').toLowerCase().indexOf(q) >= 0 ||
                (item.content || '').toLowerCase().indexOf(q) >= 0;
        });
    }
    if (QuizState.kbFilterCategory) {
        filtered = filtered.filter(function (item) { return item.category === QuizState.kbFilterCategory; });
    }
    var totalPages = Math.ceil(filtered.length / QuizState.kbPageSize);
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    QuizState.kbPage = page;
    quizRenderKBLibrary();
}

// ===== 3. 题库加载和筛选 =====
function quizLoadBankAndStart(mode) {
    quizLoadQuizBank(function () {
        if (mode === 'solo') quizStartSolo();
        else if (mode === 'pvp') quizStartPvP();
    });
}

function quizFilterBankByDifficulty() {
    var bank = QuizState.quizBank;
    if (!bank || !bank.questions) return [];
    var questions = bank.questions;
    if (QuizState.configDifficulty === 'all') return questions;
    return questions.filter(function (q) {
        return q.difficulty === parseInt(QuizState.configDifficulty);
    });
}

// ===== 4. 模式选择面板 =====
function quizShowModeSelect() {
    QuizState.showing = 'mode';
    hideAllBattlePanels();
    var panel = document.getElementById('quiz-mode-panel');
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML =
        '<div class="quiz-mode-card">' +
        '<h2 class="quiz-mode-title">知识竞答</h2>' +
        '<div class="quiz-mode-buttons">' +
        '<button class="quiz-mode-btn" onclick="quizShowConfig(\'solo\')">' +
        '<span class="quiz-mode-icon">🎯</span>' +
        '<span class="quiz-mode-label">单人闯关</span>' +
        '<span class="quiz-mode-desc">独自挑战题库，检验航空知识水平</span>' +
        '</button>' +
        '<button class="quiz-mode-btn" onclick="quizShowConfig(\'pvp\')">' +
        '<span class="quiz-mode-icon">⚔️</span>' +
        '<span class="quiz-mode-label">双人比拼</span>' +
        '<span class="quiz-mode-desc">两人轮流答题，比拼航空知识储备</span>' +
        '</button>' +
        '<button class="quiz-mode-btn" onclick="quizShowWrongSet()">' +
        '<span class="quiz-mode-icon">📋</span>' +
        '<span class="quiz-mode-label">错题集</span>' +
        '<span class="quiz-mode-desc">回顾做错的题目，巩固薄弱知识点</span>' +
        '</button>' +
        '<button class="quiz-mode-btn" onclick="quizRenderKBLibrary()">' +
        '<span class="quiz-mode-icon">📚</span>' +
        '<span class="quiz-mode-label">航空知识库</span>' +
        '<span class="quiz-mode-desc">浏览航空专业知识分类条目</span>' +
        '</button>' +
        '</div>' +
        '</div>';
}

function quizShowConfig(mode) {
    QuizState.showing = 'config';
    QuizState.pendingMode = mode;
    hideAllBattlePanels();
    var panel = document.getElementById('quiz-config-panel');
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML =
        '<div class="quiz-config-card">' +
        '<h2 class="quiz-config-title">答题参数设置</h2>' +
        '<div class="quiz-config-item"><label>题目数量</label>' +
        '<input type="number" id="cfg-count" value="' + QuizState.configQuestionCount + '" min="1" max="50"></div>' +
        '<div class="quiz-config-item"><label>计时模式</label>' +
        '<select id="cfg-time">' +
        '<option value="unlimited"' + (QuizState.configTimeMode === 'unlimited' ? ' selected' : '') + '>不限时</option>' +
        '<option value="per_question"' + (QuizState.configTimeMode === 'per_question' ? ' selected' : '') + '>每题限时</option>' +
        '</select></div>' +
        '<div class="quiz-config-item" id="cfg-timeperq-wrap"' + (QuizState.configTimeMode !== 'per_question' ? ' style="display:none"' : '') + '>' +
        '<label>每题时间 (秒)</label>' +
        '<input type="number" id="cfg-timeperq" value="' + QuizState.configTimePerQ + '" min="5" max="120"></div>' +
        '<div class="quiz-config-item"><label>难度筛选</label>' +
        '<select id="cfg-diff">' +
        '<option value="all"' + (QuizState.configDifficulty === 'all' ? ' selected' : '') + '>全部难度</option>' +
        '<option value="1"' + (QuizState.configDifficulty === '1' ? ' selected' : '') + '>★ 简单</option>' +
        '<option value="2"' + (QuizState.configDifficulty === '2' ? ' selected' : '') + '>★★ 中等</option>' +
        '<option value="3"' + (QuizState.configDifficulty === '3' ? ' selected' : '') + '>★★★ 困难</option>' +
        '</select></div>' +
        '<div class="quiz-config-actions">' +
        '<button class="quiz-config-btn start" onclick="quizSaveConfigAndStart(\'' + mode + '\')">开始答题</button>' +
        '<button class="quiz-config-btn back" onclick="quizShowModeSelect()">返回</button>' +
        '</div>' +
        '</div>';

    // 绑定计时模式切换事件
    var timeSel = document.getElementById('cfg-time');
    if (timeSel) {
        timeSel.addEventListener('change', function () {
            var wrap = document.getElementById('cfg-timeperq-wrap');
            if (wrap) wrap.style.display = this.value === 'per_question' ? '' : 'none';
        });
    }
}

function quizValidateConfig() {
    var count = parseInt(document.getElementById('cfg-count') ? document.getElementById('cfg-count').value : QuizState.configQuestionCount);
    if (isNaN(count) || count < 1 || count > 50) return { valid: false, error: '题目数量应在1-50之间' };
    return { valid: true };
}

function quizSaveConfigToStorage() {
    var countEl = document.getElementById('cfg-count');
    var timeEl = document.getElementById('cfg-time');
    var perqEl = document.getElementById('cfg-timeperq');
    var diffEl = document.getElementById('cfg-diff');
    var cnt = countEl ? parseInt(countEl.value) : NaN;
    QuizState.configQuestionCount = (isNaN(cnt) ? (QuizState.configQuestionCount || 10) : cnt);
    QuizState.configTimeMode = timeEl ? timeEl.value : (QuizState.configTimeMode || 'no_limit');
    var perq = perqEl ? parseInt(perqEl.value) : NaN;
    QuizState.configTimePerQ = (isNaN(perq) ? (QuizState.configTimePerQ || 30) : perq);
    QuizState.configDifficulty = diffEl ? diffEl.value : (QuizState.configDifficulty || 'all');
}

function quizSaveConfigAndStart(mode) {
    var validation = quizValidateConfig();
    if (!validation.valid) { alert(validation.error); return; }
    quizSaveConfigToStorage();
    if (mode === 'solo') {
        if (!QuizState.quizBank) quizLoadQuizBank(function () { quizStartSolo(); });
        else quizStartSolo();
    } else {
        if (!QuizState.quizBank) quizLoadQuizBank(function () { quizStartPvP(); });
        else quizStartPvP();
    }
}

// ===== 5. 单人答题 =====
function quizStartSolo() {
    var validation = quizValidateConfig();
    if (!validation.valid) { alert(validation.error); return; }
    quizSaveConfigToStorage();
    var filteredBank = quizFilterBankByDifficulty();
    if (!filteredBank || !filteredBank.length) { alert(qt('quiz_no_question', '题库为空，无法开始答题')); return; }
    QuizState.soloQuestions = shuffleArray(filteredBank).slice(0, QuizState.configQuestionCount);
    QuizState.soloIndex = 0;
    QuizState.soloScore = 0;
    QuizState.soloAnsweredList = [];
    QuizState.soloQuestionTimes = [];
    QuizState.showing = 'solo';
    quizStopSoloTimer();
    quizShowSoloPanel();
    quizRenderSoloQuestion();
}

function quizShowSoloPanel() {
    hideAllBattlePanels();
    document.getElementById('quiz-solo-panel').style.display = 'block';
}

function quizRenderSoloQuestion() {
    var idx = QuizState.soloIndex;
    var q = QuizState.soloQuestions[idx];
    var panel = document.getElementById('quiz-solo-panel');
    if (!panel) return;
    if (!q) { quizStopSoloTimer(); quizShowSoloResult(); return; }
    QuizState.soloCurrentAnswered = false;
    QuizState.soloQuestionStartTime = Date.now();

    var timerHTML = '';
    if (QuizState.configTimeMode === 'per_question') {
        timerHTML = '<div class="quiz-timer-bar" id="quiz-solo-timer">' +
            qt('quiz_timer_label', '⏱ 剩余') + ': ' + QuizState.configTimePerQ + 's</div>';
    }
    panel.innerHTML =
        '<div class="quiz-question-card">' +
        '<div class="quiz-q-header">' +
        '<span class="quiz-q-num">' + qt('quiz_q', '第') + ' ' + (idx + 1) + ' / ' + QuizState.soloQuestions.length + ' ' + qt('quiz_q_unit', '题') + '</span>' +
        '<span class="quiz-q-score">' + qt('quiz_score', '得分') + ': ' + QuizState.soloScore + '</span></div>' +
        timerHTML +
        '<div class="quiz-q-category">' + getCategoryName(q.category) + '</div>' +
        '<h3 class="quiz-q-text">' + q.question + '</h3>' +
        '<div class="quiz-q-options" id="quiz-solo-options-container">' + quizBuildSoloOptionsHTML(q, 0) + '</div>' +
        '<div id="quiz-solo-feedback"></div></div>';
    quizStartSoloTimer();
}

function quizBuildSoloOptionsHTML(q, selectedIdx) {
    var labels = ['A', 'B', 'C', 'D'];
    var html = '';
    q.options.forEach(function (opt, i) {
        var cls = 'quiz-option';
        if (selectedIdx > 0) {
            if (i === q.answer) cls += ' correct';
            else if (i === (selectedIdx - 1) && i !== q.answer) cls += ' wrong';
            html += '<div class="' + cls + ' disabled"><span class="quiz-opt-letter">' + labels[i] + '</span>' +
                '<span class="quiz-opt-text">' + opt + '</span></div>';
        } else {
            html += '<div class="' + cls + '" onclick="quizSoloAnswer(' + i + ')"><span class="quiz-opt-letter">' + labels[i] + '</span>' +
                '<span class="quiz-opt-text">' + opt + '</span></div>';
        }
    });
    return html;
}

function quizSoloAnswer(choiceIdx) {
    quizStopSoloTimer();
    var elapsed = Date.now() - QuizState.soloQuestionStartTime;
    QuizState.soloQuestionTimes.push(elapsed);

    var q = QuizState.soloQuestions[QuizState.soloIndex];
    var isCorrect = (choiceIdx === q.answer);
    if (isCorrect) QuizState.soloScore += 10;
    QuizState.soloCurrentAnswered = true;

    if (!isCorrect) {
        var exists = QuizState.wrongSet.some(function (w) { return w.id === q.id; });
        if (!exists) {
            QuizState.wrongSet.push({
                id: q.id,
                question: q.question,
                options: q.options,
                answer: q.answer,
                userChoice: choiceIdx,
                explanation: q.explanation,
                category: q.category,
                kb_id: q.kb_id,
                difficulty: q.difficulty
            });
        }
    }

    QuizState.soloAnsweredList.push({
        question: q.question,
        userChoice: choiceIdx,
        correctAnswer: q.answer,
        isCorrect: isCorrect,
        explanation: q.explanation,
        kb_id: q.kb_id,
        category: q.category,
        model_name: q.model_name
    });
    var container = document.getElementById('quiz-solo-options-container');
    if (container) container.innerHTML = quizBuildSoloOptionsHTML(q, choiceIdx + 1);
    var fb = document.getElementById('quiz-solo-feedback');
    if (!fb) return;
    var fbCls = 'quiz-feedback' + (isCorrect ? ' correct' : ' wrong');
    var fbHTML = '<div class="' + fbCls + '">';
    fbHTML += '<p class="quiz-fb-result">' + (isCorrect ? '✅ 回答正确！+10分' : '❌ 回答错误') + '</p>';
    fbHTML += '<p class="quiz-fb-explain">' + q.explanation + '</p>';
    // 快捷链接数组：查看知识点 | 查看3D模型
    var quickLinks = [];
    if (q.kb_id) {
        quickLinks.push('<a href="#" class="quiz-fb-quick-link ql-kb" onclick="quizJumpToKBFromAnswer(\'' + q.kb_id + '\');return false;">📖 查看相关知识点</a>');
    }
    if (q.model_name || q.kb_id) {
        quickLinks.push('<a href="#" class="quiz-fb-quick-link ql-model" onclick="quizJumpTo3DFromAnswer(\'' + (q.model_name || q.kb_id) + '\');return false;">🛩 查看3D飞机模型</a>');
    }
    if (quickLinks.length > 0) {
        fbHTML += '<div class="quiz-fb-links">' + quickLinks.join(' ') + '</div>';
    }
    fbHTML += '</div>';
    fbHTML += '<div class="quiz-action-row"><button class="quiz-btn-next" onclick="quizSoloNext()">' +
        qt('quiz_next_q', '下一题 →') + '</button></div>';
    fb.innerHTML = fbHTML;
}

function quizJumpToKBFromAnswer(kbId) {
    // 从答题反馈中跳转到知识库
    if (!kbId) return;
    QuizState.showing = 'library';
    quizLoadKnowledgeData(function () {
        // 直接显示弹窗
        quizShowKBDetailModal(kbId);
    });
}

function quizJumpTo3DFromAnswer(modelIdOrName) {
    // 从答题反馈中跳转到3D模型
    if (!modelIdOrName) return;
    // 尝试使用 quizNavTo3DModel (需要通过kb_id)
    quizNavTo3DModel(modelIdOrName);
}

function quizSoloNext() {
    QuizState.soloIndex++;
    if (QuizState.soloIndex >= QuizState.soloQuestions.length) {
        quizShowSoloResult();
    } else {
        quizRenderSoloQuestion();
    }
}

// ===== 5b. 单人计时器 =====
function quizStartSoloTimer() {
    quizStopSoloTimer();
    if (QuizState.configTimeMode !== 'per_question') return;
    var timeLeft = QuizState.configTimePerQ;
    var timerEl = document.getElementById('quiz-solo-timer');
    QuizState.soloTimer = setInterval(function () {
        timeLeft--;
        if (timerEl) timerEl.textContent = qt('quiz_timer_label', '⏱ 剩余') + ': ' + timeLeft + 's';
        if (timeLeft <= 0) {
            quizStopSoloTimer();
            quizSoloAnswer(-1); // 超时自动判错
        }
    }, 1000);
}

function quizStopSoloTimer() {
    if (QuizState.soloTimer) { clearInterval(QuizState.soloTimer); QuizState.soloTimer = null; }
}

function quizShowSoloResult() {
    QuizState.showing = 'result';
    QuizState.lastResultType = 'solo';
    hideAllBattlePanels();
    var panel = document.getElementById('quiz-result-panel');
    if (!panel) return;
    panel.style.display = 'block';
    var correctCount = QuizState.soloAnsweredList.filter(function (a) { return a.isCorrect; }).length;
    var totalCount = QuizState.soloQuestions.length;
    var html = '<div class="quiz-result-panel">' +
        '<h2 class="quiz-result-header">' + qt('quiz_solo_result', '🎉 答题结束！') + '</h2>' +
        '<div class="quiz-result-score">得分: ' + QuizState.soloScore + ' / ' + (totalCount * 10) + '</div>' +
        '<div class="quiz-result-stat">正确: ' + correctCount + ' / ' + totalCount + ' (' + Math.round(correctCount / totalCount * 100) + '%)</div>' +
        '<div class="quiz-result-detail"><h3 class="quiz-review-title">' + qt('quiz_detail', '答题详情') + '</h3>';
    QuizState.soloAnsweredList.forEach(function (a, i) {
        var icon = a.isCorrect ? '✅' : '❌';
        var cls = a.isCorrect ? 'quiz-review-item correct' : 'quiz-review-item wrong';
        html += '<div class="' + cls + '">' +
            '<div class="quiz-review-q">' + icon + ' Q' + (i + 1) + ': ' + a.question.substring(0, 50) + '...</div>' +
            '<div class="quiz-review-a">正确答案: ' + ['A', 'B', 'C', 'D'][a.correctAnswer] + '</div></div>';
    });
    html += '</div><div style="text-align:center;margin-top:16px;">' +
        '<button class="quiz-btn-retry" onclick="quizStartSolo()">' + qt('quiz_retry', '🔄 再来一次') + '</button>' +
        '<button class="quiz-btn-back" onclick="quizShowModeSelect()">' + qt('quiz_back', '🏠 返回模式选择') + '</button>' +
        '</div></div>';
    panel.innerHTML = html;
}

// ===== 6. 双人答题 =====
function quizStartPvP() {
    var validation = quizValidateConfig();
    if (!validation.valid) { alert(validation.error); return; }
    quizSaveConfigToStorage();
    var filteredBank = quizFilterBankByDifficulty();
    if (!filteredBank || !filteredBank.length) { alert(qt('quiz_no_question', '题库为空，无法开始答题')); return; }
    QuizState.pvpTotal = QuizState.configQuestionCount;
    if (QuizState.pvpTotal > filteredBank.length) QuizState.pvpTotal = filteredBank.length;
    QuizState.pvpQuestions = shuffleArray(filteredBank).slice(0, QuizState.pvpTotal);
    QuizState.pvpIndex = 0;
    QuizState.pvpCurrentPlayer = 1;
    QuizState.pvpScore = { 1: 0, 2: 0 };
    QuizState.pvpAnsweredCount = { 1: 0, 2: 0 };
    QuizState.pvpAnsweredList = [];
    QuizState.pvpQuestionTimes = [];
    QuizState.showing = 'pvp';
    quizStopPvPTimer();
    quizShowPvPPanel();
    quizRenderPvPQuestion();
}

function quizShowPvPPanel() {
    hideAllBattlePanels();
    document.getElementById('quiz-pvp-panel').style.display = 'block';
}

function quizRenderPvPQuestion() {
    var idx = QuizState.pvpIndex;
    var q = QuizState.pvpQuestions[idx];
    var panel = document.getElementById('quiz-pvp-panel');
    if (!panel) return;
    if (!q) { quizStopPvPTimer(); quizShowPvPResult(); return; }
    var player = QuizState.pvpCurrentPlayer;
    QuizState.pvpCurrentAnswered = false;
    QuizState.pvpQuestionStartTime = Date.now();

    var timerHTML = '';
    if (QuizState.configTimeMode === 'per_question') {
        timerHTML = '<div class="quiz-timer-bar" id="quiz-pvp-timer">' +
            qt('quiz_timer_label', '⏱ 剩余') + ': ' + QuizState.configTimePerQ + 's</div>';
    }
    panel.innerHTML =
        '<div class="quiz-question-card">' +
        '<div class="quiz-pvp-q-header">' +
        '<span class="quiz-pvp-who">' + qt('quiz_player', '玩家') + ' ' + player + ' ' + qt('quiz_turn', '答题中') + '</span>' +
        '<span class="quiz-pvp-round">' + qt('quiz_q', '第') + ' ' + (idx + 1) + ' / ' + QuizState.pvpTotal + ' ' + qt('quiz_q_unit', '题') + '</span></div>' +
        '<div class="quiz-battle-stats">' +
        '<span>' + qt('quiz_p1', '玩家1') + ': <b>' + QuizState.pvpScore[1] + '</b></span>' +
        '<span>' + qt('quiz_p2', '玩家2') + ': <b>' + QuizState.pvpScore[2] + '</b></span></div>' +
        timerHTML +
        '<div class="quiz-q-category">' + getCategoryName(q.category) + '</div>' +
        '<h3 class="quiz-q-text">' + q.question + '</h3>' +
        '<div class="quiz-q-options" id="quiz-pvp-options-container">' + quizBuildPvPOptionsHTML(q, 0) + '</div>' +
        '<div id="quiz-pvp-feedback"></div></div>';
    quizStartPvPTimer();
}

function quizBuildPvPOptionsHTML(q, selectedIdx) {
    var labels = ['A', 'B', 'C', 'D'];
    var html = '';
    q.options.forEach(function (opt, i) {
        var cls = 'quiz-option';
        if (selectedIdx > 0) {
            if (i === q.answer) cls += ' correct';
            else if (i === (selectedIdx - 1) && i !== q.answer) cls += ' wrong';
            html += '<div class="' + cls + ' disabled"><span class="quiz-opt-letter">' + labels[i] + '</span>' +
                '<span class="quiz-opt-text">' + opt + '</span></div>';
        } else {
            html += '<div class="' + cls + '" onclick="quizPvPAnswer(' + i + ')"><span class="quiz-opt-letter">' + labels[i] + '</span>' +
                '<span class="quiz-opt-text">' + opt + '</span></div>';
        }
    });
    return html;
}

function quizPvPAnswer(choiceIdx) {
    quizStopPvPTimer();
    var elapsed = Date.now() - QuizState.pvpQuestionStartTime;
    QuizState.pvpQuestionTimes.push(elapsed);

    var q = QuizState.pvpQuestions[QuizState.pvpIndex];
    var player = QuizState.pvpCurrentPlayer;
    var isCorrect = (choiceIdx === q.answer);
    if (isCorrect) QuizState.pvpScore[player] += 10;
    QuizState.pvpCurrentAnswered = true;
    QuizState.pvpAnsweredCount[player]++;

    if (!isCorrect) {
        var exists = QuizState.wrongSet.some(function (w) { return w.id === q.id; });
        if (!exists) {
            QuizState.wrongSet.push({
                id: q.id,
                question: q.question,
                options: q.options,
                answer: q.answer,
                userChoice: choiceIdx,
                explanation: q.explanation,
                category: q.category,
                kb_id: q.kb_id,
                difficulty: q.difficulty
            });
        }
    }

    QuizState.pvpAnsweredList.push({
        player: player,
        question: q.question,
        userChoice: choiceIdx,
        correctAnswer: q.answer,
        isCorrect: isCorrect,
        explanation: q.explanation,
        kb_id: q.kb_id,
        category: q.category,
        model_name: q.model_name
    });
    var container = document.getElementById('quiz-pvp-options-container');
    if (container) container.innerHTML = quizBuildPvPOptionsHTML(q, choiceIdx + 1);
    var fb = document.getElementById('quiz-pvp-feedback');
    if (!fb) return;
    var fbCls = 'quiz-feedback' + (isCorrect ? ' correct' : ' wrong');
    var fbHTML = '<div class="' + fbCls + '">';
    fbHTML += '<div class="quiz-pvp-fb-player">' + qt('quiz_player', '玩家') + ' ' + player + ' ' +
        (isCorrect ? qt('quiz_correct', '✓ 回答正确！+10分') : qt('quiz_wrong', '✗ 回答错误')) + '</div>';
    fbHTML += '<p class="quiz-fb-explain">' + q.explanation + '</p>';
    // 快捷链接
    var quickLinks = [];
    if (q.kb_id) {
        quickLinks.push('<a href="#" class="quiz-fb-quick-link ql-kb" onclick="quizJumpToKBFromAnswer(\'' + q.kb_id + '\');return false;">📖 查看知识点</a>');
    }
    if (q.model_name || q.kb_id) {
        quickLinks.push('<a href="#" class="quiz-fb-quick-link ql-model" onclick="quizJumpTo3DFromAnswer(\'' + (q.model_name || q.kb_id) + '\');return false;">🛩 查看3D模型</a>');
    }
    if (quickLinks.length > 0) {
        fbHTML += '<div class="quiz-fb-links">' + quickLinks.join(' ') + '</div>';
    }
    fbHTML += '</div>';
    fbHTML += '<div class="quiz-action-row"><button class="quiz-btn-next" onclick="quizPvPNext()">' +
        qt('quiz_next_player', '轮到下一位 →') + '</button></div>';
    fb.innerHTML = fbHTML;
}

function quizPvPNext() {
    QuizState.pvpCurrentPlayer = (QuizState.pvpCurrentPlayer === 1) ? 2 : 1;
    if (QuizState.pvpCurrentPlayer === 1) QuizState.pvpIndex++;
    if (QuizState.pvpIndex >= QuizState.pvpTotal) {
        quizShowPvPResult();
    } else {
        quizRenderPvPQuestion();
    }
}

function quizShowPvPResult() {
    QuizState.showing = 'result';
    QuizState.lastResultType = 'pvp';
    hideAllBattlePanels();
    var panel = document.getElementById('quiz-result-panel');
    if (!panel) return;
    panel.style.display = 'block';
    var s1 = QuizState.pvpScore[1], s2 = QuizState.pvpScore[2];
    var winnerHTML = s1 > s2 ? qt('quiz_winner', '🏆 玩家1 获胜！') : s2 > s1 ? qt('quiz_winner2', '🏆 玩家2 获胜！') : qt('quiz_draw', '🤝 平局！');
    var html = '<div class="quiz-result-panel">' +
        '<h2 class="quiz-result-header">' + qt('quiz_pvp_result', '🎉 比拼结束！') + '</h2>' +
        '<div class="quiz-pvp-final-winner">' + winnerHTML + '</div>' +
        '<div class="quiz-pvp-final-scores">' +
        '<div class="quiz-pvp-final-player"><div class="quiz-pvp-final-name">' + qt('quiz_p1', '玩家1') + '</div><div class="quiz-pvp-final-score">' + s1 + '</div></div>' +
        '<div class="quiz-pvp-final-vs">VS</div>' +
        '<div class="quiz-pvp-final-player"><div class="quiz-pvp-final-name">' + qt('quiz_p2', '玩家2') + '</div><div class="quiz-pvp-final-score">' + s2 + '</div></div></div>' +
        '<div class="quiz-result-detail"><h3 class="quiz-review-title">' + qt('quiz_detail', '答题详情') + '</h3>';
    QuizState.pvpAnsweredList.forEach(function (a, i) {
        var icon = a.isCorrect ? '✅' : '❌';
        var cls = a.isCorrect ? 'quiz-review-item correct' : 'quiz-review-item wrong';
        html += '<div class="' + cls + '"><div class="quiz-review-q">' + icon + ' P' + a.player + ' Q' + (Math.floor(i / 2) + 1) + ': ' + a.question.substring(0, 30) + '...</div></div>';
    });
    html += '</div><div style="text-align:center;margin-top:16px;">' +
        '<button class="quiz-btn-retry" onclick="quizStartPvP()">' + qt('quiz_retry_pvp', '🔄 再来一局') + '</button>' +
        '<button class="quiz-btn-back" onclick="quizShowModeSelect()">' + qt('quiz_back', '🏠 返回模式选择') + '</button>' +
        '</div></div>';
    panel.innerHTML = html;
}

// ===== 6b. 双人计时器 =====
function quizStartPvPTimer() {
    quizStopPvPTimer();
    if (QuizState.configTimeMode !== 'per_question') return;
    var timeLeft = QuizState.configTimePerQ;
    var timerEl = document.getElementById('quiz-pvp-timer');
    QuizState.pvpTimer = setInterval(function () {
        timeLeft--;
        if (timerEl) timerEl.textContent = qt('quiz_timer_label', '⏱ 剩余') + ': ' + timeLeft + 's';
        if (timeLeft <= 0) {
            quizStopPvPTimer();
            quizPvPAnswer(-1);
        }
    }, 1000);
}

function quizStopPvPTimer() {
    if (QuizState.pvpTimer) { clearInterval(QuizState.pvpTimer); QuizState.pvpTimer = null; }
}

// ===== 7. 错题集 =====
function quizShowWrongSet() {
    QuizState.showing = 'wrong';
    hideAllBattlePanels();
    var panel = document.getElementById('quiz-wrong-panel');
    if (!panel) return;
    panel.style.display = 'block';
    if (QuizState.wrongSet.length === 0) {
        panel.innerHTML = '<div class="quiz-wrong-empty"><span>📋</span><p>暂无错题记录</p><button class="quiz-btn-back" onclick="quizShowModeSelect()">返回</button></div>';
        return;
    }
    var html = '<div class="quiz-wrong-header"><h2>错题集 (' + QuizState.wrongSet.length + '题)</h2>' +
        '<button class="quiz-wrong-clear" onclick="quizClearWrongSet()">清空错题集</button></div>' +
        '<div class="quiz-wrong-list">';
    QuizState.wrongSet.forEach(function (w, i) {
        var labels = ['A', 'B', 'C', 'D'];
        html += '<div class="quiz-wrong-item">' +
            '<div class="quiz-wrong-q"><span>Q' + (i + 1) + ':</span> ' + escapeHtml(w.question) + '</div>' +
            '<div class="quiz-wrong-choices">你的选择: ' + (w.userChoice >= 0 ? labels[w.userChoice] : '超时') + ' | 正确答案: ' + labels[w.answer] + '</div>' +
            '<div class="quiz-wrong-explain">' + escapeHtml(w.explanation || '') + '</div>' +
            '<div class="quiz-wrong-actions">';
        if (w.kb_id) {
            html += '<button class="ws-kb-btn" onclick="quizJumpToKBFromWrong(\'' + w.kb_id + '\')">' +
                qt('ws_view_kb', '📖 查看知识点') + '</button>';
        }
        html += '<button class="ws-model-btn" onclick="quizJumpTo3DFromWrong(\'' + (w.kb_id || '') + '\')">' +
            '🛩 查看3D模型</button>';
        html += '</div></div>';
    });
    html += '</div>' +
        '<div style="text-align:center;margin-top:16px;">' +
        '<button class="quiz-btn-retry" onclick="quizRetryWrongSet()">🔄 错题重做</button>' +
        '<button class="quiz-btn-back" onclick="quizShowModeSelect()">🏠 返回</button></div>';
    panel.innerHTML = html;
}

function quizClearWrongSet() {
    if (confirm('确定要清空所有错题记录吗？')) {
        QuizState.wrongSet = [];
        quizShowWrongSet();
    }
}

function quizRetryWrongSet() {
    if (QuizState.wrongSet.length === 0) { alert('没有错题可重做'); return; }
    QuizState.soloQuestions = QuizState.wrongSet.map(function (w) {
        return {
            question: w.question,
            options: w.options,
            answer: w.answer,
            explanation: w.explanation,
            category: w.category,
            kb_id: w.kb_id,
            difficulty: w.difficulty,
            model_name: w.model_name
        };
    });
    QuizState.soloIndex = 0;
    QuizState.soloScore = 0;
    QuizState.soloAnsweredList = [];
    QuizState.soloQuestionTimes = [];
    QuizState.showing = 'solo';
    quizStopSoloTimer();
    quizShowSoloPanel();
    quizRenderSoloQuestion();
}

// ===== 8. 知识库跳转函数（跨模块） =====
function quizJumpToKB(kbId) {
    QuizState.showing = 'library';
    quizLoadKnowledgeData(function () {
        quizRenderKBLibrary();
        // 尝试滚动到对应卡片高亮
        setTimeout(function () {
            var card = document.querySelector('.kb-card[data-kb-id="' + kbId + '"]');
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('kb-card-highlight');
                setTimeout(function () { card.classList.remove('kb-card-highlight'); }, 2000);
            }
        }, 100);
    });
}

function quizJumpToKBFromWrong(kbId) {
    quizJumpToKB(kbId);
}

function quizNavTo3DModel(knowledgeId) {
    if (!knowledgeId) return;
    // 先获取知识点数据来获取关联的模型名称
    var modelName = null;
    if (QuizState.knowledgeData && QuizState.knowledgeData.knowledge_items) {
        var item = QuizState.knowledgeData.knowledge_items.find(function (k) { return k.id === knowledgeId; });
        if (item) {
            modelName = item.model_name || item.related_model || extractModelNameFromKBItem(item);
        }
    }
    // 如果直接从MODEL_NAME_MAP能找到映射
    if (!modelName && MODEL_NAME_MAP[knowledgeId]) {
        modelName = MODEL_NAME_MAP[knowledgeId];
    }

    if (window.navigateTo3DModel) {
        window.navigateTo3DModel(modelName || knowledgeId);
    }
}

function quizNavTo3DFromWrong(knowledgeId) {
    quizNavTo3DModel(knowledgeId);
}

/** 从知识点条目中提取关联的模型名称 */
function extractModelNameFromKBItem(item) {
    if (!item) return null;
    if (item.model_name) return item.model_name;
    if (item.related_model) return item.related_model;
    // 尝试从title中提取机型名
    var title = item.title || '';
    var knownModels = [
        'MiG-29', 'Mi-28', 'A6M', 'F-2', 'F-15J', 'F-82', 'F-86', 'P-51', 'F-100',
        'EA-6B', 'T-38', 'F-5', 'YB-35', 'T-2', 'P-80', 'JF-17', 'PBY-5A', 'Y-20',
        'B5N', 'Ki-27', 'Ki-44', 'B-25', 'F-14', 'F-15', 'F-16', 'F-18', 'F-22',
        'F-35', 'Su-27', 'Su-30', 'Su-35', 'J-10', 'J-20', 'C-130', 'B-52', 'B-2'
    ];
    var titleUpper = title.toUpperCase();
    for (var i = 0; i < knownModels.length; i++) {
        if (titleUpper.indexOf(knownModels[i].toUpperCase()) >= 0) {
            return knownModels[i];
        }
    }
    return null;
}

function quizNavToQuizByCat(category) {
    if (!category) return;
    // 从知识库详情弹窗进入：先关闭弹窗，避免遮挡答题面板
    if (typeof quizHideKBModal === 'function') quizHideKBModal();
    quizLoadQuizBank(function () {
        QuizState.showing = 'solo';
        quizSaveConfigToStorage();
        // 筛选对应分类的试题
        quizFilterByCategoryLocal(category);
    });
}

/** 本地按分类筛选试题并开始答题 */
function quizFilterByCategoryLocal(category) {
    if (!QuizState.quizBank || !QuizState.quizBank.questions) {
        quizLoadQuizBank(function () { quizFilterByCategoryLocal(category); });
        return;
    }
    var filtered = QuizState.quizBank.questions.filter(function (q) {
        return q.category === category;
    });
    if (filtered.length === 0) {
        alert(qt('quiz_no_question', '该类目暂无试题'));
        return;
    }
    QuizState.soloQuestions = shuffleArray(filtered).slice(0, Math.min(QuizState.configQuestionCount, filtered.length));
    QuizState.soloIndex = 0;
    QuizState.soloScore = 0;
    QuizState.soloAnsweredList = [];
    QuizState.soloQuestionTimes = [];
    QuizState.showing = 'solo';
    quizStopSoloTimer();
    hideAllBattlePanels();
    quizShowSoloPanel();
    quizRenderSoloQuestion();
}

// ===== 9. 知识库详情弹窗 =====
function quizShowKBDetailModal(kbId) {
    if (!QuizState.knowledgeData) {
        quizLoadKnowledgeData(function () { quizShowKBDetailModal(kbId); });
        return;
    }
    var items = QuizState.knowledgeData.knowledge_items;
    if (!items) return;
    var item = items.find(function (k) { return k.id === kbId; });
    if (!item) { alert('未找到该知识点'); return; }

    var overlay = document.getElementById('quiz-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'quiz-modal-overlay';
        overlay.className = 'quiz-modal-overlay';
        document.body.appendChild(overlay);
    }
    var card = document.getElementById('quiz-modal-card');
    if (!card) {
        card = document.createElement('div');
        card.id = 'quiz-modal-card';
        card.className = 'quiz-modal-card';
        overlay.innerHTML = '';
        overlay.appendChild(card);
    }

    var catMap = { 'aircraft_types': '民航机型', 'aircraft_structure': '飞行器结构', 'airworthiness': '航空适航标准', 'engine': '航发知识', 'regulations': '航空行业法规', 'aviation_history': '航空历史与里程碑', 'aerodynamics': '飞行原理与空气动力学', 'avionics': '航空电子与航电系统', 'materials': '航空材料与制造工艺', 'atm': '空中交通管理与空域', 'safety': '航空安全与事故调查', 'military_aviation': '军用航空与著名战机', 'meteorology': '航空气象', 'helicopter': '直升机与旋翼机', 'spaceflight': '航天工程与太空飞行', 'airport': '机场与基础设施', 'aviation_medicine': '航空医学与人体工程', 'flight_sim': '飞行模拟与训练', 'aerial_survey': '航空摄影与遥感', 'aviation_economy': '航空经济与运营', 'uav_drones': '无人机与新兴应用' };
    var catDisplay = catMap[item.category] || item.category;
    card.innerHTML =
        '<div class="quiz-modal-header">' +
        '<span class="quiz-modal-cat">' + catDisplay + '</span>' +
        '<span class="quiz-modal-title">' + escapeHtml(item.title) + '</span>' +
        '<button class="quiz-modal-close" onclick="quizHideKBModal()">✕</button>' +
        '</div>' +
        '<div class="quiz-modal-body">' + escapeHtml(item.content) + '</div>' +
        '<div class="quiz-modal-source">来源: ' + escapeHtml(item.source || '') + '</div>' +
        '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="ws-model-btn" onclick="quizNavTo3DFromKBModal(\'' + kbId + '\')">🛩 浏览3D实物模型</button>' +
        '<button class="kb-card-btn quiz-btn" onclick="quizNavToQuizByCat(\'' + (item.category || '') + '\')">🏆 同类题目练习</button>' +
        '</div>';
    overlay.style.display = 'flex';
}

function quizHideKBModal() {
    var overlay = document.getElementById('quiz-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

function quizNavTo3DFromKBModal(knowledgeId) {
    quizHideKBModal();
    quizNavTo3DModel(knowledgeId);
}

// ===== 10. 辅助函数 =====
function hideAllBattlePanels() {
    var panels = ['quiz-mode-panel', 'quiz-config-panel', 'quiz-library-panel', 'quiz-solo-panel', 'quiz-pvp-panel', 'quiz-result-panel', 'quiz-wrong-panel'];
    panels.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

// ===== 10b. 布局状态：资料库主体 / 答题接管（quiz-battling） =====
/** 切到答题态：右侧展开为主体，左侧资料库收窄 */
function quizEnterBattleLayout() {
    var wrap = document.getElementById('quiz-container');
    if (wrap) wrap.classList.add('quiz-battling');
    var bar = document.getElementById('quiz-battle-collapsed-bar');
    if (bar) bar.style.display = 'none';
    // 同步tab高亮
    var libTab = document.getElementById('quiz-tab-library');
    var quizTab = document.getElementById('quiz-tab-quiz');
    if (libTab) libTab.classList.remove('active');
    if (quizTab) quizTab.classList.add('active');
}

/** 回到资料库主态：答题区收起为竖条入口 */
function quizExitBattleLayout() {
    var wrap = document.getElementById('quiz-container');
    if (wrap) wrap.classList.remove('quiz-battling');
    var bar = document.getElementById('quiz-battle-collapsed-bar');
    if (bar) bar.style.display = 'flex';
    hideAllBattlePanels();
}

/** 资料库首页（顶栏 tab 切换）*/
function quizShowKBHome() {
    QuizState.showing = 'library';
    quizStopSoloTimer();
    quizStopPvPTimer();
    quizExitBattleLayout();
    quizRenderKBSidebar();
}

// 所有进入答题/模式选择/配置/错题的面板渲染函数，需同步进入答题态布局
var _origShowModeSelect = quizShowModeSelect;
quizShowModeSelect = function () {
    quizEnterBattleLayout();
    _origShowModeSelect();
};

var _origShowConfig = quizShowConfig;
quizShowConfig = function (mode) {
    quizEnterBattleLayout();
    _origShowConfig(mode);
};

var _origShowWrongSet = quizShowWrongSet;
quizShowWrongSet = function () {
    quizEnterBattleLayout();
    _origShowWrongSet();
};

var _origShowSoloPanel = quizShowSoloPanel;
quizShowSoloPanel = function () {
    quizEnterBattleLayout();
    _origShowSoloPanel();
};

var _origShowPvPPanel = quizShowPvPPanel;
quizShowPvPPanel = function () {
    quizEnterBattleLayout();
    _origShowPvPPanel();
};

function getCategoryName(cat) {
    var map = { 'aircraft_types': '民航机型', 'aircraft_structure': '飞行器结构', 'airworthiness': '航空适航标准', 'engine': '航发知识', 'regulations': '航空行业法规' };
    return map[cat] || cat || '综合';
}

function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

// ===== 11. 初始化入口 =====
window.QuizApp = {
    init: function () {
        quizLoadKnowledgeData();
        quizLoadQuizBank();
        // 绑定返回按钮
        var backBtn = document.getElementById('kb-back-to-wall');
        if (backBtn) {
            backBtn.addEventListener('click', quizBackToCardWall);
        }
        // 默认停在资料库主体态（不自动进入模式选择）
        if (QuizState.showing !== 'library') {
            quizShowKBHome();
        } else {
            quizExitBattleLayout();
        }
        quizRenderKBSidebar();   // 航空资料库主体面板
    }
};

// 暴露跨模块函数到全局（quizShowModeSelect 等已在 10b 区被布局包装，此处引用的是包装后版本）
window.quizShowKBDetail = quizShowKBDetailModal;
window.quizJumpToKB = quizJumpToKB;
window.quizNavTo3DModel = quizNavTo3DModel;
window.quizNavToQuizByCat = quizNavToQuizByCat;
window.quizFilterByCategory = quizFilterByCategoryLocal;
window.quizHideKBModal = quizHideKBModal;
window.quizRenderKBLibrary = quizRenderKBLibrary;
window.quizRenderKBSidebar = quizRenderKBSidebar;
window.quizKBSidebarFilter = quizKBSidebarFilter;
window.quizKBSidebarGoPage = quizKBSidebarGoPage;
window.quizSearchKeyup = quizSearchKeyup;
window.quizShowModeSelect = quizShowModeSelect;
window.quizShowConfig = quizShowConfig;
window.quizShowWrongSet = quizShowWrongSet;
window.quizStartSolo = quizStartSolo;
window.quizStartPvP = quizStartPvP;
window.quizShowKBHome = quizShowKBHome;