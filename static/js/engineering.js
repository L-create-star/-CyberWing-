/* ═══════════════════════════════════════════════════════════
 * engineering.js — 工程分析模块（前端计算 + 面板渲染）
 * 与后端 engineering/aero_calculator.py 公式一一对应（双实现可交叉验证）
 * 公式：
 *   AR = b²/S                展弦比
 *   W/S                      翼载荷 (kg/m²)
 *   CL = 2·W/(ρ·V²·S)        巡航升力系数
 *   Vs = √(2·W/(ρ·CLmax·S))  失速速度
 *   L/D = 1/(CD0+CL²/(π·e·AR))
 *   R = (V/(TSFC·g))·(L/D)·ln(W0/W1)  Breguet 航程 (W1=0.8·W0)
 * 数据：static/data/aircraft_engineering.json（含来源可追溯）
 * ═══════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var G = 9.80665;
    var RHO0 = 1.225;
    var LAPSE = 0.0065;
    var T0 = 288.15;
    var GAS_R = 287.05;

    /* ---------- 计算核心（与 Python 引擎一致） ---------- */
    function rhoAtAltitude(h) {
        h = Math.max(0, +h || 0);
        if (h > 11000) h = 11000;
        return RHO0 * Math.pow(1 - (LAPSE * h) / T0, G / (LAPSE * GAS_R));
    }
    function aspectRatio(b, s) { return b * b / s; }
    function wingLoading(w, s) { return w / s; }
    function clCruise(w, v, s, rho) { return 2 * w * G / (rho * v * v * s); }
    function stallSpeed(w, s, clmax, rho) { return Math.sqrt(2 * w * G / (rho * clmax * s)); }
    function ldRatio(cl, ar, cd0, e) { return 1 / (cd0 + cl * cl / (Math.PI * e * ar)); }
    function breguetRange(v, ld, tsfc, w0) {
        return (v / (tsfc * G)) * ld * Math.log(w0 / (w0 * 0.8)) / 1000;
    }

    /* ---------- 单机完整分析 ---------- */
    function analyze(a) {
        var v = (a.cruise_speed_kmh || 0) * 1000 / 3600;
        var rho = rhoAtAltitude(a.cruise_alt_m || 11000);
        var ar = aspectRatio(a.wingspan_m, a.wing_area_m2);
        var wl = wingLoading(a.mtow_kg, a.wing_area_m2);
        var cl = clCruise(a.mtow_kg, v, a.wing_area_m2, rho);
        var ld = ldRatio(cl, ar, a.cd0 || 0.05, a.e || 0.75);
        var vsClean = stallSpeed(a.mtow_kg, a.wing_area_m2, 1.5, RHO0);
        var vsFlap = stallSpeed(a.mtow_kg, a.wing_area_m2, 2.5, RHO0);
        var rangeEst = v > 0 ? breguetRange(v, ld, a.tsfc || 1.6e-5, a.mtow_kg) : null;
        return {
            ar: ar,
            wingLoad: wl,
            cl: cl,
            ld: ld,
            vsCleanKmh: vsClean * 3.6,
            vsFlapKmh: vsFlap * 3.6,
            rangeEstKm: rangeEst
        };
    }

    /* ---------- 起飞/着陆/爬升计算（与 Python 引擎一致） ---------- */
    function calcTakeoff(a) {
        var W = a.mtow_kg * G;
        var T = (a.thrust_kn || a.max_thrust_kn || 0) * 1000;
        var S = a.wing_area_m2, rho = RHO0;
        var ar = aspectRatio(a.wingspan_m, S);
        var clTo = a.cl_takeoff || 1.2;
        var mu = a.mu || 0.02;
        var vs = Math.sqrt(2 * W / (rho * clTo * S));
        var vRotate = vs * 1.2, v50 = vs * 1.15;
        // 地面滑跑
        var vAvg = vRotate * 0.5;
        var clG = clTo * 0.5;
        var qAvg = 0.5 * rho * vAvg * vAvg;
        var dAvg = qAvg * S * ((a.cd0 || 0.05) + clG * clG / (Math.PI * (a.e || 0.75) * ar));
        var accel = (T - dAvg - mu * W) / (W / G);
        if (accel <= 0) return { total: 0, groundRoll: 0, climb: 0, vRotate: 0, v50: 0 };
        var groundRoll = vRotate * vRotate / (2 * accel);
        // 爬升到 15m
        var qC = 0.5 * rho * v50 * v50;
        var dC = qC * S * ((a.cd0 || 0.05) + clTo * clTo / (Math.PI * (a.e || 0.75) * ar));
        var sinG = Math.max(0, Math.min(1, (T - dC) / W));   // 升角正弦物理上限 1，防止推重比极端时 asin(NaN)
        var climbDist = sinG > 0 ? (sinG >= 1 ? 0 : 15 / Math.tan(Math.asin(sinG))) : 9999;
        return {
            total: Math.round(groundRoll + climbDist),
            groundRoll: Math.round(groundRoll),
            climb: Math.round(climbDist),
            vRotate: Math.round(vRotate * 3.6),
            v50: Math.round(v50 * 3.6)
        };
    }

    function calcLanding(a) {
        var W = a.mtow_kg * G;
        var S = a.wing_area_m2, rho = RHO0;
        var ar = aspectRatio(a.wingspan_m, S);
        var clLd = a.cl_landing || 2.0;
        var muB = a.mu_brake || 0.3;
        var vs = Math.sqrt(2 * W / (rho * clLd * S));
        var vTouch = vs * 1.3;
        var vAvg = vTouch * 0.5;
        var qAvg = 0.5 * rho * vAvg * vAvg;
        var dAvg = qAvg * S * ((a.cd0 || 0.05) + clLd * clLd / (Math.PI * (a.e || 0.75) * ar));
        var decel = (muB * W + dAvg) / (W / G);
        var groundDist = vTouch * vTouch / (2 * decel);
        var approach = 15 / Math.tan(3 * Math.PI / 180);
        return {
            total: Math.round(approach + groundDist),
            approach: Math.round(approach),
            ground: Math.round(groundDist),
            vTouch: Math.round(vTouch * 3.6)
        };
    }

    /* ---------- 面板状态 ---------- */
    var state = { data: [], sel: null, linked3D: false, baseWingspan: 0 };
    var PANEL_ID = 'engineering-panel';

    function loadData(cb) {
        fetch('/static/data/aircraft_engineering.json?v=' + Date.now())
            .then(function (r) { return r.json(); })
            .then(function (d) { state.data = d.aircraft || []; cb && cb(); })
            .catch(function () { console.error('工程数据加载失败'); });
    }

    function buildPanel() {
        var el = document.getElementById(PANEL_ID);
        if (el) return el;
        el = document.createElement('div');
        el.id = PANEL_ID;
        el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;display:none;' +
            'background:rgba(5,7,14,.88);align-items:center;justify-content:center;font-family:monospace;';
        el.innerHTML =
            '<div style="width:min(880px,94vw);max-height:90vh;overflow:auto;background:#0a1020;border:1.5px solid rgba(0,229,255,.45);' +
            'border-radius:12px;padding:20px 24px;color:#cfe8f5;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(0,229,255,.25);padding-bottom:10px;">' +
            '<span style="color:#00e5ff;font-weight:bold;font-size:15px;">◆ 工程分析 / ENGINEERING_DESK</span>' +
            '<button onclick="Engineering.close()" style="background:none;border:1px solid rgba(0,229,255,.4);color:#00e5ff;border-radius:6px;cursor:pointer;padding:2px 10px;">✕</button>' +
            '</div>' +
            '<div style="display:flex;gap:14px;margin:14px 0;flex-wrap:wrap;align-items:center;">' +
            '<label style="font-size:12px;color:#8fb8cc;">机型</label>' +
            '<select id="eng-select" onchange="Engineering.pickAircraft(this.value)" style="background:#0d1626;color:#dff4ff;border:1px solid rgba(0,229,255,.35);border-radius:6px;padding:6px 10px;font-family:monospace;"></select>' +
            '<button onclick="Engineering.resetToSource()" style="background:rgba(0,229,255,.1);color:#00e5ff;border:1px solid rgba(0,229,255,.4);border-radius:6px;padding:6px 12px;cursor:pointer;">重置为官方参数</button>' +
            '<button onclick="Engineering.viewIn3D()" style="background:rgba(126,231,135,.1);color:#7ee787;border:1px solid rgba(126,231,135,.4);border-radius:6px;padding:6px 12px;cursor:pointer;">🛩 在3D中查看</button>' +
            '<button onclick="Engineering.exportReport()" style="background:rgba(255,217,61,.1);color:#ffd93d;border:1px solid rgba(255,217,61,.4);border-radius:6px;padding:6px 12px;cursor:pointer;">📄 导出报告</button>' +
            '<button onclick="Engineering.exportCompareReport()" style="background:rgba(186,104,200,.1);color:#ba68c8;border:1px solid rgba(186,104,200,.4);border-radius:6px;padding:6px 12px;cursor:pointer;">📊 对比报告</button>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">' +
            '<div style="border:1px solid rgba(0,229,255,.2);border-radius:10px;padding:14px;">' +
            '<div style="color:#00e5ff;font-size:13px;margin-bottom:10px;">■ 输入参数（可修改，实时计算）</div>' +
            '<div id="eng-inputs"></div>' +
            '</div>' +
            '<div style="border:1px solid rgba(0,229,255,.2);border-radius:10px;padding:14px;">' +
            '<div style="color:#00e5ff;font-size:13px;margin-bottom:10px;">■ 计算输出</div>' +
            '<div id="eng-outputs"></div>' +
            '</div>' +
            '</div>' +
            /* ── 图表区（ECharts，三标签页） ── */
            '<div style="margin-top:14px;border:1px solid rgba(0,229,255,.2);border-radius:10px;padding:14px;">' +
            '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
            '<button id="eng-tab-cla" onclick="Engineering.switchChart(\'cla\')" style="background:rgba(0,229,255,.15);color:#00e5ff;border:1px solid rgba(0,229,255,.4);border-radius:6px;padding:5px 14px;cursor:pointer;font-size:12px;">CL-α 升力曲线</button>' +
            '<button id="eng-tab-sens" onclick="Engineering.switchChart(\'sens\')" style="background:none;color:#8fb8cc;border:1px solid rgba(0,229,255,.25);border-radius:6px;padding:5px 14px;cursor:pointer;font-size:12px;">翼展参数敏感性</button>' +
            '<button id="eng-tab-cmp" onclick="Engineering.switchChart(\'cmp\')" style="background:none;color:#8fb8cc;border:1px solid rgba(0,229,255,.25);border-radius:6px;padding:5px 14px;cursor:pointer;font-size:12px;">机型对比</button>' +
            '<button id="eng-tab-polar" onclick="Engineering.switchChart(\'polar\')" style="background:none;color:#8fb8cc;border:1px solid rgba(0,229,255,.25);border-radius:6px;padding:5px 14px;cursor:pointer;font-size:12px;">极曲线</button>' +
            '<button id="eng-tab-env" onclick="Engineering.switchChart(\'env\')" style="background:none;color:#8fb8cc;border:1px solid rgba(0,229,255,.25);border-radius:6px;padding:5px 14px;cursor:pointer;font-size:12px;">飞行包线</button>' +
            '<button id="eng-tab-climb" onclick="Engineering.switchChart(\'climb\')" style="background:none;color:#8fb8cc;border:1px solid rgba(0,229,255,.25);border-radius:6px;padding:5px 14px;cursor:pointer;font-size:12px;">爬升性能</button>' +
            '<button id="eng-tab-radar" onclick="Engineering.switchChart(\'radar\')" style="background:none;color:#8fb8cc;border:1px solid rgba(0,229,255,.25);border-radius:6px;padding:5px 14px;cursor:pointer;font-size:12px;">雷达对比</button>' +
            '</div>' +
            '<div id="eng-chart-cla" style="width:100%;height:320px;"></div>' +
            '<div id="eng-chart-sens" style="width:100%;height:320px;display:none;"></div>' +
            '<div id="eng-chart-cmp" style="width:100%;height:320px;display:none;"></div>' +
            '<div id="eng-chart-polar" style="width:100%;height:320px;display:none;"></div>' +
            '<div id="eng-chart-env" style="width:100%;height:320px;display:none;"></div>' +
            '<div id="eng-chart-climb" style="width:100%;height:320px;display:none;"></div>' +
            '<div id="eng-radar-sel" style="display:none;margin-bottom:6px;max-height:70px;overflow:auto;border:1px solid rgba(0,229,255,.15);border-radius:6px;padding:6px;font-size:11px;line-height:1.6;"></div>' +
            '<div id="eng-chart-radar" style="width:100%;height:320px;display:none;"></div>' +
            '</div>' +
            '<div id="eng-note" style="margin-top:12px;font-size:11px;color:#5f7d8f;line-height:1.6;"></div>' +
            '</div>';
        document.body.appendChild(el);
        return el;
    }

    function inputRow(label, id, value, unit, step, min, max) {
        var minAttr = (min !== undefined && min !== null) ? ' min="' + min + '"' : '';
        var maxAttr = (max !== undefined && max !== null) ? ' max="' + max + '"' : '';
        return '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0;font-size:12px;">' +
            '<span style="color:#8fb8cc;">' + label + '</span>' +
            '<span><input id="' + id + '" type="number" step="' + (step || 'any') + '" value="' + value + '"' + minAttr + maxAttr + ' ' +
            'oninput="Engineering.recalc()" style="width:110px;background:#0d1626;color:#fff;border:1px solid rgba(0,229,255,.3);border-radius:5px;padding:4px 6px;text-align:right;font-family:monospace;"> ' +
            '<span style="color:#5f6c8f;">' + unit + '</span></span></div>';
    }

    function outRow(label, value, extra) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed rgba(255,255,255,.08);padding:7px 0;font-size:13px;">' +
            '<span style="color:#8fb8cc;">' + label + '</span><span style="color:#00e5ff;font-weight:bold;">' + value + '</span>' +
            (extra ? '<span style="color:#5f6c7f;font-size:11px;">' + extra + '</span>' : '') + '</div>';
    }

    /* ---------- 输入参数物理范围（超出范围钳制，防止计算异常） ---------- */
    var PARAM_RANGES = {
        'eng-w':    { min: 0.5,  max: 200,    label: '翼展' },
        'eng-s':    { min: 0.5,  max: 2000,   label: '机翼面积' },
        'eng-w0':   { min: 50,   max: 700000, label: '最大起飞重量' },
        'eng-v':    { min: 20,   max: 3000,   label: '巡航速度' },
        'eng-alt':  { min: 0,    max: 20000,  label: '巡航高度' },
        'eng-thr':  { min: 0,    max: 3000,   label: '总推力' },
        'eng-mu':   { min: 0,    max: 1,      label: '摩擦系数' },
        'eng-mub':  { min: 0.01, max: 1.5,    label: '制动系数' },
        'eng-clto': { min: 0.1,  max: 3,      label: '起飞CL' },
        'eng-clld': { min: 0.1,  max: 4,      label: '着陆CL' }
    };

    function clampInputs() {
        var clamped = [];
        Object.keys(PARAM_RANGES).forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            var r = PARAM_RANGES[id];
            var raw = parseFloat(el.value);
            if (isNaN(raw)) { el.style.borderColor = ''; return; }  // 空值交给默认逻辑
            var fixed = Math.min(Math.max(raw, r.min), r.max);
            if (fixed !== raw) {
                el.value = fixed;
                el.style.borderColor = '#ff9a6b';
                clamped.push(r.label + ' ' + raw + ' 超出合理范围 [' + r.min + ' ~ ' + r.max + ']，已按 ' + fixed + ' 计算');
            } else {
                el.style.borderColor = '';
            }
        });
        return clamped;
    }

    function fillSelect() {
        var sel = document.getElementById('eng-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">— 选择机型 —</option>' + state.data.map(function (a) {
            return '<option value="' + a.id + '">' + a.name + '（' + (a.category === 'civil' ? '民航' : '军用') + '）</option>';
        }).join('');
        if (state.sel) sel.value = state.sel.id;
    }

    function selectAircraft(id) {
        var a = state.data.filter(function (x) { return x.id === id; })[0];
        if (!a) return;
        state.sel = a;
        var selEl = document.getElementById('eng-select');
        if (selEl) selEl.value = a.id;
        document.getElementById('eng-inputs').innerHTML =
            inputRow('翼展 (m)', 'eng-w', a.wingspan_m, 'm', '0.1', 0.5, 200) +
            inputRow('机翼面积 (m²)', 'eng-s', a.wing_area_m2, 'm²', '0.1', 0.5, 2000) +
            inputRow('最大起飞重量 (kg)', 'eng-w0', a.mtow_kg, 'kg', '10', 50, 700000) +
            inputRow('巡航速度 (km/h)', 'eng-v', a.cruise_speed_kmh || '', 'km/h', '1', 20, 3000) +
            inputRow('巡航高度 (m)', 'eng-alt', a.cruise_alt_m || 11000, 'm', '100', 0, 20000) +
            '<div style="border-top:1px dashed rgba(0,229,255,.15);margin:8px 0 4px;padding-top:6px;color:#5f7d8f;font-size:11px;">地面性能参数</div>' +
            inputRow('总推力 (kN)', 'eng-thr', a.max_thrust_kn || '', 'kN', '1', 0, 3000) +
            inputRow('摩擦系数 μ', 'eng-mu', 0.02, '', '0.01', 0, 1) +
            inputRow('制动系数 μb', 'eng-mub', 0.3, '', '0.05', 0.01, 1.5) +
            inputRow('起飞CL', 'eng-clto', 1.2, '', '0.1', 0.1, 3) +
            inputRow('着陆CL', 'eng-clld', 2.0, '', '0.1', 0.1, 4);
        recalc();
        drawCurrentDebounced();
    }

    function getParams() {
        function v(id) {
            var el = document.getElementById(id);
            var n = el ? parseFloat(el.value) : NaN;
            return isNaN(n) ? 0 : n;
        }
        var p = {
            wingspan_m: v('eng-w'),
            wing_area_m2: v('eng-s'),
            mtow_kg: v('eng-w0'),
            cruise_speed_kmh: v('eng-v'),
            cruise_alt_m: (function () { var el = document.getElementById('eng-alt'); var x = el ? parseFloat(el.value) : NaN; return isNaN(x) ? 11000 : x; })(),
            thrust_kn: v('eng-thr'),
            mu: v('eng-mu') || 0.02,
            mu_brake: v('eng-mub') || 0.3,
            cl_takeoff: v('eng-clto') || 1.2,
            cl_landing: v('eng-clld') || 2.0,
            cd0: state.sel && state.sel.cd0,
            e: state.sel && state.sel.e,
            tsfc: state.sel && state.sel.tsfc
        };
        return p;
    }

    function recalc() {
        var out = document.getElementById('eng-outputs');
        if (!out) return;
        var clamped = clampInputs();
        var a = getParams();
        if (!(a.wingspan_m > 0 && a.wing_area_m2 > 0 && a.mtow_kg > 0 && a.cruise_speed_kmh > 0)) {
            out.innerHTML = '<div style="color:#ff9a6b;font-size:12px;">参数不完整，请补充有效数值</div>';
            return;
        }
        var warnHtml = clamped.length
            ? '<div style="color:#ff9a6b;font-size:11px;margin-bottom:8px;line-height:1.5;">⚠ ' + clamped.join('<br>⚠ ') + '</div>'
            : '';
        var r = analyze(a);
        var act = state.sel && state.sel.range_km;
        // 起飞着陆估算
        var toInfo = '', ldInfo = '';
        if (a.thrust_kn > 0) {
            var toR = calcTakeoff(a);
            toInfo = outRow('起飞距离（估算）', toR.total + ' m', '滑跑' + toR.groundRoll + 'm+爬升' + toR.climb + 'm; V_R=' + toR.vRotate + 'km/h');
        }
        var ldR = calcLanding(a);
        ldInfo = outRow('着陆距离（估算）', ldR.total + ' m', '进近' + ldR.approach + 'm+制动' + ldR.ground + 'm; V_TD=' + ldR.vTouch + 'km/h');
        out.innerHTML =
            warnHtml + outRow('展弦比 AR', r.ar.toFixed(2), 'b²/S') +
            outRow('翼载荷 W/S', r.wingLoad.toFixed(1) + ' kg/m²', '巡航') +
            outRow('巡航升力系数 CL', r.cl.toFixed(3), 'ρ@巡航高度') +
            outRow('巡航升阻比 L/D', r.ld.toFixed(1), 'CD₀=0.05, e=0.75') +
            outRow('失速速度（光洁）', r.vsCleanKmh.toFixed(0) + ' km/h', 'CLmax=1.5') +
            outRow('失速速度（襟翼）', r.vsFlapKmh.toFixed(0) + ' km/h', 'CLmax=2.5') +
            outRow('Breguet 航程估算', (r.rangeEstKm || 0).toFixed(0) + ' km', 'W₁=0.8·W₀') +
            (act ? outRow('官方公布航程', act + ' km', '对照') : '') +
            '<div style="border-top:1px dashed rgba(0,229,255,.15);margin:6px 0 2px;"></div>' +
            toInfo + ldInfo;
        var note = document.getElementById('eng-note');
        var src = state.sel && state.sel.source;
        note.innerHTML = (src ? '数据来源：' + src + '<br>' : '') +
            '输入范围：翼展0.5–200m · 翼面积0.5–2000m² · MTOW 50–700000kg · 巡航速度20–3000km/h · 高度0–20000m · 推力0–3000kN · μ 0–1 · μb 0.01–1.5 · 起飞CL 0.1–3 · 着陆CL 0.1–4（超出范围自动钳制并提示）<br>' +
            '注：L/D 为估算值（CD₀=0.05、e=0.75）；航程估算基于 Breguet 公式（TSFC=1.6e-5，W₁/W₀=0.8），仅供教学演示，与官方公布值存在偏差属正常。';
        // 3D 联动：如已链接则实时同步翼展变化
        if (state.linked3D) sync3D();
    }

    function resetToSource() {
        if (state.sel) selectAircraft(state.sel.id);
    }

    function open() {
        var el = buildPanel();
        el.style.display = 'flex';
        if (state.data.length === 0) loadData(function () { fillSelect(); });
        else fillSelect();
    }
    function close() {
        var el = document.getElementById(PANEL_ID);
        if (el) el.style.display = 'none';
    }

    /* ---------- ECharts 图表 ---------- */
    var chartState = { current: 'cla', cla: null, sens: null, cmp: null, polar: null, env: null, climb: null, radar: null, debounce: null };
    state.radarSel = {};

    function getChart(id) {
        var dom = document.getElementById('eng-chart-' + id);
        if (!dom) return null;
        if (!chartState[id]) {
            if (typeof echarts === 'undefined') return null;
            chartState[id] = echarts.init(dom);
        }
        return chartState[id];
    }

    function switchChart(id) {
        chartState.current = id;
        ['cla', 'sens', 'cmp', 'polar', 'env', 'climb', 'radar'].forEach(function (k) {
            var d = document.getElementById('eng-chart-' + k);
            if (d) d.style.display = (k === id ? 'block' : 'none');
            var b = document.getElementById('eng-tab-' + k);
            if (b) {
                if (k === id) { b.style.background = 'rgba(0,229,255,.15)'; b.style.color = '#00e5ff'; b.style.borderColor = 'rgba(0,229,255,.4)'; }
                else { b.style.background = 'none'; b.style.color = '#8fb8cc'; b.style.borderColor = 'rgba(0,229,255,.25)'; }
            }
        });
        // 雷达选择区只在 radar tab 显示
        var selArea = document.getElementById('eng-radar-sel');
        if (selArea) selArea.style.display = (id === 'radar' ? 'block' : 'none');
        drawCurrent();
        // 雷达图自动滚动到可见区域
        if (id === 'radar') {
            setTimeout(function () {
                var chartDiv = document.getElementById('eng-chart-radar');
                if (chartDiv) chartDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }

    function drawCurrent() {
        var a = getParams();
        if (chartState.current === 'cla') drawCLA(a);
        else if (chartState.current === 'sens') drawSensitivity(a);
        else if (chartState.current === 'polar') drawPolar(a);
        else if (chartState.current === 'env') drawEnvelope(a);
        else if (chartState.current === 'climb') drawClimbRate(a);
        else if (chartState.current === 'radar') drawRadar();
        else drawComparison();
    }

    /* CL-α 升力曲线 */
    function drawCLA(a) {
        var ch = getChart('cla');
        if (!ch) return;
        if (!(a.wing_area_m2 > 0 && a.mtow_kg > 0)) { ch.clear(); return; }
        var ar = aspectRatio(a.wingspan_m, a.wing_area_m2);
        var aPerRad = 2 * Math.PI * ar / (ar + 2);           // 有限翼展升力线斜率
        var aPerDeg = aPerRad * Math.PI / 180;
        var alpha0 = -2;                                       // 零升迎角 deg
        var alphaStall = 15;                                   // 临界迎角 deg
        var clMax = aPerDeg * (alphaStall - alpha0);            // 线性外推到失速
        var data = [];
        for (var al = -4; al <= 20; al += 0.5) {
            var cl;
            if (al <= alphaStall) cl = aPerDeg * (al - alpha0);
            else cl = clMax * Math.max(0, 1 - (al - alphaStall) * 0.12); // 失速后缓降
            data.push([al, +cl.toFixed(3)]);
        }
        // 巡航 CL 对应迎角
        var v = (a.cruise_speed_kmh || 0) * 1000 / 3600;
        var rho = rhoAtAltitude(a.cruise_alt_m || 11000);
        var clCr = v > 0 ? clCruise(a.mtow_kg, v, a.wing_area_m2, rho) : 0;
        var alphaCruise = alpha0 + clCr / aPerDeg;
        ch.setOption({
            backgroundColor: 'transparent',
            title: { text: 'CL-α 升力曲线（展弦比 AR=' + ar.toFixed(1) + '）', textStyle: { color: '#00e5ff', fontSize: 13 }, left: 'center' },
            tooltip: { trigger: 'axis', formatter: function (p) { return 'α=' + p[0].value[0] + '°<br>CL=' + p[0].value[1]; } },
            grid: { left: 55, right: 30, top: 45, bottom: 40 },
            xAxis: { type: 'value', name: '迎角 α (°)', nameTextStyle: { color: '#5f7d8f' }, min: -4, max: 20, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
            yAxis: { type: 'value', name: '升力系数 CL', nameTextStyle: { color: '#5f7d8f' }, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
            series: [
                { name: 'CL', type: 'line', data: data, smooth: true, symbol: 'none', lineStyle: { color: '#00e5ff', width: 2.5 }, areaStyle: { color: 'rgba(0,229,255,.08)' } },
                { name: '巡航点', type: 'scatter', data: [[+alphaCruise.toFixed(2), +clCr.toFixed(3)]], symbolSize: 12, itemStyle: { color: '#ff6b6b' }, markPoint: { data: [{ coord: [+alphaCruise.toFixed(2), +clCr.toFixed(3)], value: '巡航', itemStyle: { color: '#ff6b6b' }, label: { color: '#ff6b6b', formatter: '巡航 α={c}°' } }] } },
                { name: '失速点', type: 'scatter', data: [[alphaStall, +clMax.toFixed(3)]], symbolSize: 12, itemStyle: { color: '#ffd93d' }, markPoint: { data: [{ coord: [alphaStall, +clMax.toFixed(3)], value: '失速', itemStyle: { color: '#ffd93d' }, label: { color: '#ffd93d', formatter: '失速' } }] } }
            ]
        }, true);
    }

    /* 翼展参数敏感性（±30% 扫描） */
    function drawSensitivity(a) {
        var ch = getChart('sens');
        if (!ch) return;
        if (!(a.wing_area_m2 > 0 && a.mtow_kg > 0 && a.wingspan_m > 0)) { ch.clear(); return; }
        var S = a.wing_area_m2, W = a.mtow_kg, b0 = a.wingspan_m;
        var v = (a.cruise_speed_kmh || 0) * 1000 / 3600;
        var rho = rhoAtAltitude(a.cruise_alt_m || 11000);
        var arData = [], ldData = [], vsData = [];
        for (var k = 0.6; k <= 1.41; k += 0.02) {
            var b = b0 * k;
            var ar = aspectRatio(b, S);
            var cl = v > 0 ? clCruise(W, v, S, rho) : 0;
            var ld = cl > 0 ? ldRatio(cl, ar, 0.05, 0.75) : 0;
            var vs = stallSpeed(W, S, 1.5, RHO0) * 3.6;
            arData.push([+(k * 100).toFixed(0), +ar.toFixed(2)]);
            ldData.push([+(k * 100).toFixed(0), +ld.toFixed(2)]);
            vsData.push([+(k * 100).toFixed(0), +vs.toFixed(0)]);
        }
        ch.setOption({
            backgroundColor: 'transparent',
            title: { text: '翼展参数敏感性（翼面积/重量不变）', textStyle: { color: '#00e5ff', fontSize: 13 }, left: 'center' },
            tooltip: { trigger: 'axis' },
            legend: { data: ['展弦比 AR', '升阻比 L/D', '失速速度'], textStyle: { color: '#8fb8cc' }, top: 22 },
            grid: { left: 60, right: 70, top: 60, bottom: 40 },
            xAxis: { type: 'value', name: '翼展倍率 (%)', nameTextStyle: { color: '#5f7d8f' }, min: 60, max: 140, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc', formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
            yAxis: [
                { type: 'value', name: 'AR / L/D', nameTextStyle: { color: '#5f7d8f' }, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
                { type: 'value', name: '失速速度 km/h', nameTextStyle: { color: '#5f7d8f' }, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { show: false } }
            ],
            series: [
                { name: '展弦比 AR', type: 'line', data: arData, smooth: true, symbol: 'none', lineStyle: { color: '#00e5ff', width: 2 } },
                { name: '升阻比 L/D', type: 'line', data: ldData, smooth: true, symbol: 'none', lineStyle: { color: '#7ee787', width: 2 } },
                { name: '失速速度', type: 'line', data: vsData, yAxisIndex: 1, smooth: true, symbol: 'none', lineStyle: { color: '#ff6b6b', width: 2, type: 'dashed' } }
            ]
        }, true);
    }

    /* 机型对比柱状图 */
    function drawComparison() {
        var ch = getChart('cmp');
        if (!ch) return;
        var cats = [], ars = [], wls = [];
        var selId = state.sel ? state.sel.id : '';
        state.data.forEach(function (a) {
            if (!(a.wing_area_m2 > 0)) return;
            var ar = aspectRatio(a.wingspan_m, a.wing_area_m2);
            var wl = wingLoading(a.mtow_kg, a.wing_area_m2);
            cats.push(a.name);
            ars.push({ value: +ar.toFixed(2), itemStyle: { color: (a.id === selId ? '#00e5ff' : 'rgba(0,229,255,.35)') } });
            wls.push({ value: +wl.toFixed(0), itemStyle: { color: (a.id === selId ? '#ff6b6b' : 'rgba(255,107,107,.35)') } });
        });
        ch.setOption({
            backgroundColor: 'transparent',
            title: { text: '机型工程参数对比（当前机型高亮）', textStyle: { color: '#00e5ff', fontSize: 13 }, left: 'center' },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            legend: { data: ['展弦比 AR', '翼载荷 W/S'], textStyle: { color: '#8fb8cc' }, top: 22 },
            grid: { left: 50, right: 50, top: 60, bottom: 80 },
            xAxis: { type: 'category', data: cats, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc', rotate: 45, fontSize: 9, interval: 0 } },
            yAxis: [
                { type: 'value', name: 'AR', nameTextStyle: { color: '#00e5ff' }, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
                { type: 'value', name: 'W/S (kg/m²)', nameTextStyle: { color: '#ff6b6b' }, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { show: false } }
            ],
            dataZoom: [{ type: 'slider', height: 18, bottom: 10, backgroundColor: 'rgba(0,229,255,.05)', fillerColor: 'rgba(0,229,255,.15)', borderColor: 'rgba(0,229,255,.3)', textStyle: { color: '#8fb8cc' } }],
            series: [
                { name: '展弦比 AR', type: 'bar', data: ars, barWidth: '40%' },
                { name: '翼载荷 W/S', type: 'bar', data: wls, yAxisIndex: 1, barWidth: '40%' }
            ]
        }, true);
    }

    /* 爬升性能：爬升率随高度变化曲线 */
    function drawClimbRate(a) {
        var ch = getChart('climb');
        if (!ch) return;
        if (!(a.wing_area_m2 > 0 && a.mtow_kg > 0 && a.thrust_kn > 0)) {
            ch.setOption({ title: { text: '请填写总推力参数', textStyle: { color: '#ff9a6b', fontSize: 14 }, left: 'center' }, xAxis: { show: false }, yAxis: { show: false } });
            return;
        }
        var S = a.wing_area_m2, W = a.mtow_kg, T = a.thrust_kn * 1000;
        var cd0 = a.cd0 || 0.05, e = a.e || 0.75;
        var ar = aspectRatio(a.wingspan_m, S);
        var climbV = (a.cruise_speed_kmh || 300) * 1000 / 3600 * 0.7; // 爬升速度约为巡航的70%
        var rocData = [];
        for (var h = 0; h <= 14000; h += 500) {
            var rho = rhoAtAltitude(h);
            var T_alt = T * (rho / RHO0);
            var cl = 2 * W * G / (rho * climbV * climbV * S);
            var cd = cd0 + cl * cl / (Math.PI * e * ar);
            var D = 0.5 * rho * climbV * climbV * S * cd;
            var roc = Math.max(0, (T_alt - D) * climbV / (W * G)); // m/s
            rocData.push([h, +(roc * 60).toFixed(1)]); // 转 m/min
        }
        ch.setOption({
            backgroundColor: 'transparent',
            title: { text: '爬升率随高度变化（剩余功率法）', textStyle: { color: '#00e5ff', fontSize: 13 }, left: 'center' },
            tooltip: { trigger: 'axis', formatter: function (p) { return '高度 ' + p[0].value[0] + 'm<br>爬升率 ' + p[0].value[1] + ' m/min'; } },
            grid: { left: 65, right: 30, top: 45, bottom: 45 },
            xAxis: { type: 'value', name: '高度 (m)', nameTextStyle: { color: '#5f7d8f' }, min: 0, max: 14000, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
            yAxis: { type: 'value', name: '爬升率 (m/min)', nameTextStyle: { color: '#5f7d8f' }, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
            series: [
                { name: '爬升率', type: 'line', data: rocData, smooth: true, symbol: 'none', lineStyle: { color: '#7ee787', width: 2.5 }, areaStyle: { color: 'rgba(126,231,135,.08)' } }
            ]
        }, true);
    }

    /* 雷达对比：多机型六维雷达图 */
    var RADAR_COLORS = ['#00e5ff', '#ff6b6b', '#7ee787', '#ffd93d', '#ba68c8', '#ff9a3c'];
    var RADAR_DIMS = [
        { name: '展弦比 AR', max: 15 },
        { name: '翼载荷 W/S\n(kg/m²)', max: 1200 },
        { name: '升阻比 L/D', max: 20 },
        { name: '巡航速度\n(km/h)', max: 2500 },
        { name: '航程\n(km)', max: 16000 },
        { name: '推重比\nT/W', max: 1.2 }
    ];

    function buildRadarSel() {
        var selArea = document.getElementById('eng-radar-sel');
        if (!selArea) return;
        var html = '<div style="color:#5f7d8f;margin-bottom:4px;">勾选机型（建议≤6架）：</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px;">';
        state.data.forEach(function (a) {
            var checked = state.radarSel[a.id] ? 'checked' : '';
            var cat = a.category === 'civil' ? '民航' : '军用';
            html += '<label style="color:#8fb8cc;cursor:pointer;"><input type="checkbox" value="' + a.id + '" ' + checked +
                ' onchange="Engineering.toggleRadar(\'' + a.id + '\')" style="margin:0 3px 0 0;">' + a.name + ' (' + cat + ')</label>';
        });
        html += '</div>';
        selArea.innerHTML = html;
    }

    function toggleRadar(id) {
        state.radarSel[id] = !state.radarSel[id];
        var count = Object.keys(state.radarSel).filter(function (k) { return state.radarSel[k]; }).length;
        if (count > 8) {
            state.radarSel[id] = false;
            var cbs = document.querySelectorAll('#eng-radar-sel input[type=checkbox]');
            cbs.forEach(function (cb) { if (cb.value === id) cb.checked = false; });
            alert('最多对比 8 架机型，请取消部分选择');
            return;
        }
        drawRadar();
    }

    function drawRadar() {
        var ch = getChart('radar');
        if (!ch) return;
        // 首次进入：默认选中当前机型 + 2架参照
        var hasAny = Object.keys(state.radarSel).some(function (k) { return state.radarSel[k]; });
        if (!hasAny) {
            state.radarSel = {};
            if (state.sel) state.radarSel[state.sel.id] = true;
            var added = state.sel ? 1 : 0;
            // 默认加一架民航一架军用做参照
            var defaults = ['c919', 'f22'];
            defaults.forEach(function (did) {
                var found = state.data.filter(function (a) { return a.id === did; })[0];
                if (found && added < 3) { state.radarSel[found.id] = true; added++; }
            });
        }
        buildRadarSel();
        var selected = state.data.filter(function (a) {
            return state.radarSel[a.id] && a.wing_area_m2 > 0;
        });
        if (selected.length === 0) {
            ch.setOption({ title: { text: '请至少勾选 1 架机型', textStyle: { color: '#ff9a6b', fontSize: 14 }, left: 'center' }, xAxis: { show: false }, yAxis: { show: false } });
            return;
        }
        var seriesData = selected.map(function (a, i) {
            var r = analyze(a);
            var tw = a.max_thrust_kn ? (a.max_thrust_kn * 1000) / (a.mtow_kg * G) : 0;
            return {
                value: [+r.ar.toFixed(2), +r.wingLoad.toFixed(0), +r.ld.toFixed(1),
                +(a.cruise_speed_kmh || 0), +(r.rangeEstKm || 0).toFixed(0), +tw.toFixed(3)],
                name: a.name,
                itemStyle: { color: RADAR_COLORS[i % RADAR_COLORS.length] },
                lineStyle: { color: RADAR_COLORS[i % RADAR_COLORS.length], width: 2 },
                areaStyle: { color: RADAR_COLORS[i % RADAR_COLORS.length], opacity: 0.08 }
            };
        });
        ch.setOption({
            backgroundColor: 'transparent',
            title: { text: '多机型雷达对比（六维性能）', textStyle: { color: '#00e5ff', fontSize: 13 }, left: 'center' },
            tooltip: { trigger: 'item' },
            legend: { data: selected.map(function (a) { return a.name; }), textStyle: { color: '#8fb8cc', fontSize: 10 }, bottom: 0, type: 'scroll' },
            radar: {
                indicator: RADAR_DIMS,
                center: ['50%', '52%'],
                radius: '62%',
                splitNumber: 4,
                axisName: { color: '#8fb8cc', fontSize: 11 },
                splitLine: { lineStyle: { color: 'rgba(0,229,255,.15)' } },
                splitArea: { areaStyle: { color: ['rgba(0,229,255,.02)', 'rgba(0,229,255,.04)'] } },
                axisLine: { lineStyle: { color: 'rgba(0,229,255,.2)' } }
            },
            series: [{ type: 'radar', data: seriesData, symbol: 'circle', symbolSize: 5 }]
        }, true);
        ch.resize();
    }

    function drawCurrentDebounced() {
        if (chartState.debounce) clearTimeout(chartState.debounce);
        chartState.debounce = setTimeout(drawCurrent, 250);
    }

    /* 极曲线（Drag Polar）：CD = CD₀ + CL²/(π·e·AR)）
       同时叠加 L/D 等高线与最优点标注 */
    function drawPolar(a) {
        var ch = getChart('polar');
        if (!ch) return;
        if (!(a.wing_area_m2 > 0 && a.mtow_kg > 0 && a.wingspan_m > 0)) { ch.clear(); return; }
        var ar = aspectRatio(a.wingspan_m, a.wing_area_m2);
        var cd0 = a.cd0 || 0.05;
        var e = a.e || 0.75;
        var aPerRad = 2 * Math.PI * ar / (ar + 2);
        var aPerDeg = aPerRad * Math.PI / 180;
        var alpha0 = -2, alphaStall = 15;
        var polarData = [];      // CL vs CD
        var ldLine = [];         // L/D 等高参考线（通过原点，斜率=L/D）
        var bestLD = { cl: 0, cd: 0, ld: 0 };
        for (var al = -4; al <= alphaStall; al += 0.5) {
            var cl = aPerDeg * (al - alpha0);
            var cd = cd0 + cl * cl / (Math.PI * e * ar);
            var ld = cl / cd;
            polarData.push([+cl.toFixed(3), +cd.toFixed(4)]);
            if (ld > bestLD.ld) { bestLD = { cl: cl, cd: cd, ld: ld }; }
        }
        // 失速后缓降
        var clMax = aPerDeg * (alphaStall - alpha0);
        for (var al2 = 15.5; al2 <= 22; al2 += 0.5) {
            var cl2 = clMax * Math.max(0, 1 - (al2 - alphaStall) * 0.12);
            var cd2 = cd0 + cl2 * cl2 / (Math.PI * e * ar) + (al2 - alphaStall) * 0.02; // 额外阻力
            polarData.push([+cl2.toFixed(3), +cd2.toFixed(4)]);
        }
        // 巡航点
        var v = (a.cruise_speed_kmh || 0) * 1000 / 3600;
        var rho = rhoAtAltitude(a.cruise_alt_m || 11000);
        var clCr = v > 0 ? clCruise(a.mtow_kg, v, a.wing_area_m2, rho) : 0;
        var cdCr = cd0 + clCr * clCr / (Math.PI * e * ar);
        ch.setOption({
            backgroundColor: 'transparent',
            title: { text: '极曲线（Drag Polar）AR=' + ar.toFixed(1) + ' CD₀=' + cd0, textStyle: { color: '#00e5ff', fontSize: 13 }, left: 'center' },
            tooltip: { trigger: 'axis', formatter: function (p) { return 'CL=' + p[0].value[0] + '<br>CD=' + p[0].value[1]; } },
            grid: { left: 60, right: 30, top: 45, bottom: 40 },
            xAxis: { type: 'value', name: '升力系数 CL', nameTextStyle: { color: '#5f7d8f' }, min: -0.5, max: 1.6, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
            yAxis: { type: 'value', name: '阻力系数 CD', nameTextStyle: { color: '#5f7d8f' }, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
            series: [
                { name: '极曲线', type: 'line', data: polarData, smooth: true, symbol: 'none', lineStyle: { color: '#00e5ff', width: 2.5 }, areaStyle: { color: 'rgba(0,229,255,.06)' } },
                { name: '巡航点', type: 'scatter', data: [[+clCr.toFixed(3), +cdCr.toFixed(4)]], symbolSize: 12, itemStyle: { color: '#ff6b6b' }, markPoint: { data: [{ coord: [+clCr.toFixed(3), +cdCr.toFixed(4)], value: '巡航', itemStyle: { color: '#ff6b6b' }, label: { color: '#ff6b6b', formatter: '巡航' } }] } },
                { name: '最佳L/D', type: 'scatter', data: [[+bestLD.cl.toFixed(3), +bestLD.cd.toFixed(4)]], symbolSize: 12, itemStyle: { color: '#7ee787' }, markPoint: { data: [{ coord: [+bestLD.cl.toFixed(3), +bestLD.cd.toFixed(4)], value: '最佳L/D=' + bestLD.ld.toFixed(1), itemStyle: { color: '#7ee787' }, label: { color: '#7ee787', formatter: '最佳L/D' } }] } }
            ]
        }, true);
    }

    /* 飞行包线（Flight Envelope）：速度-高度可飞区域 */
    function drawEnvelope(a) {
        var ch = getChart('env');
        if (!ch) return;
        if (!(a.wing_area_m2 > 0 && a.mtow_kg > 0)) { ch.clear(); return; }
        var S = a.wing_area_m2, W = a.mtow_kg;
        var cd0 = a.cd0 || 0.05, e = a.e || 0.75;
        var ar = aspectRatio(a.wingspan_m, S);
        // 不同高度下的失速速度（光洁 CLmax=1.5）和最大速度（结构限制 + 马赫限制）
        var stallData = [], vmoData = [], ceiling = a.cruise_alt_m || 11000;
        for (var h = 0; h <= 14000; h += 500) {
            var rho = rhoAtAltitude(h);
            // 失速下限：Vs = sqrt(2W/(rho*CLmax*S))
            var vs = Math.sqrt(2 * W * G / (rho * 1.5 * S)) * 3.6; // km/h
            stallData.push([+vs.toFixed(0), h]);
            // 速度上限取结构极限速度 VMO（假设 600-900 km/h 级别）或马赫限制
            // 客机 VMO 约 870-950 km/h，军用机更高
            var vmo = (a.max_thrust_kn || 300) > 400 ? 1400 : 920; // 军用 vs 民用
            // 高空马赫限制：声速随高度降低，固定马赫数对应更低表速
            var cSound = 20.05 * Math.sqrt(288.15 - 0.0065 * h); // m/s
            var vMach = 0.82 * cSound * 3.6; // 0.82 马赫（典型客机）或更高
            var vMax = Math.min(vmo, vMach);
            vmoData.push([+vMax.toFixed(0), h]);
            // 升限：失速速度 = 最大速度时的高度
            if (vs >= vMax && ceiling === (a.cruise_alt_m || 11000)) { ceiling = h; }
        }
        // 包络区域填充（stall 线与 VMO 线围成的区域）
        var areaData = [];
        for (var i = 0; i < stallData.length; i++) areaData.push(stallData[i]);
        for (var j = vmoData.length - 1; j >= 0; j--) areaData.push(vmoData[j]);
        ch.setOption({
            backgroundColor: 'transparent',
            title: { text: '飞行包线（Flight Envelope）', textStyle: { color: '#00e5ff', fontSize: 13 }, left: 'center' },
            tooltip: { trigger: 'axis' },
            grid: { left: 60, right: 30, top: 45, bottom: 45 },
            xAxis: { type: 'value', name: '速度 (km/h)', nameTextStyle: { color: '#5f7d8f' }, min: 0, max: 1600, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
            yAxis: { type: 'value', name: '高度 (m)', nameTextStyle: { color: '#5f7d8f' }, min: 0, max: 15000, axisLine: { lineStyle: { color: '#3a5060' } }, axisLabel: { color: '#8fb8cc' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } } },
            series: [
                { name: '可飞区域', type: 'line', data: areaData, smooth: true, symbol: 'none', lineStyle: { color: 'rgba(0,229,255,.15)', width: 0 }, areaStyle: { color: 'rgba(0,229,255,.10)' }, stack: 'env' },
                { name: '失速边界', type: 'line', data: stallData, smooth: true, symbol: 'none', lineStyle: { color: '#ff6b6b', width: 2 }, markPoint: { data: [{ coord: stallData[0], value: '海平面失速' }] } },
                { name: '速度限制', type: 'line', data: vmoData, smooth: true, symbol: 'none', lineStyle: { color: '#ffd93d', width: 2 } },
                { name: '升限', type: 'line', data: [[0, ceiling], [1600, ceiling]], symbol: 'none', lineStyle: { color: '#7ee787', width: 1.5, type: 'dashed' }, markLine: { silent: true, symbol: 'none', lineStyle: { color: '#7ee787', type: 'dashed' }, label: { color: '#7ee787', formatter: '实用升限 ' + ceiling + 'm' }, data: [{ yAxis: ceiling }] } }
            ]
        }, true);
    }

    /* ---------- 3D 模型联动 ---------- */
    // 工程参数库 id → 3D 模型文件名映射（基于 /static/models/ 实际文件）
    var MODEL_MAP = {
        'c919': null, 'arj21': null, 'b737_800': null, 'a320neo': null,
        'a350_900': null, 'b787_9': null, 'b747_8': null, 'a380': null,
        'b777_300er': null, 'b747_400': null, 'b767_300er': null,
        'a330_900': null, 'a321neo': null, 'b737_max8': null,
        'f22': null, 'f16': null, 'f35a': null, 'f18e': null,
        'f15e': 'Mitsubishi F-15J v1.glb',
        'mig29': 'Mikoyan MIG-29.glb',
        'su27': null, 'su57': null, 'j10c': null, 'j20': null,
        'jf17': 'pac-jf-17-thunder-cac-fc-1-fighter-aircraft.glb',
        'f86': 'North American F-86 Sabre v2.glb',
        'p51': 'North American P-51D Mustang.glb',
        'b25': 'North American B-25J Mitchell.glb',
        'y20': 'Xian Y-20.glb',
        'j35a': null
    };

    function findModelFilename(aircraftId) {
        return MODEL_MAP[aircraftId] || null;
    }

    function viewIn3D() {
        if (!state.sel) { alert('请先选择机型'); return; }
        var filename = findModelFilename(state.sel.id);
        if (!filename) {
            alert('该机型暂无3D模型：' + state.sel.name + '\n（当前模型库中已有 3D 模型的机型可直接联动）');
            return;
        }
        // 记录基准翼展（用于联动缩放比例）
        state.baseWingspan = parseFloat(document.getElementById('eng-w').value) || state.sel.wingspan_m;
        state.linked3D = true;
        // 通过自定义事件通知主页面加载模型（loadGalleryModel 在主闭包内，外部无法直接调用）
        window.dispatchEvent(new CustomEvent('eng-load-model', { detail: { filename: filename } }));
        // 不切 tab、不关面板——面板浮层保持在前，3D 在背后同步变化
        // 延迟等模型加载后应用初始缩放
        setTimeout(sync3D, 2500);
    }

    function sync3D() {
        if (!state.linked3D) return;
        // 通过全局接口获取 galleryModelGroup（主闭包内变量）
        var group = (typeof window.__engGetModelGroup === 'function') ? window.__engGetModelGroup() : null;
        if (!group) return;
        // 取当前翼展输入
        var currentB = parseFloat(document.getElementById('eng-w') ? document.getElementById('eng-w').value : 0);
        if (!(currentB > 0) || !(state.baseWingspan > 0)) return;
        // 计算缩放比：翼展变化率（只改 X 轴 = 翼展方向）
        // 注意：模型原始缩放已由 loadGalleryModel 设为 8/maxDim（均匀缩放）
        // 我们在此基础上叠加 X 轴额外缩放
        var ratio = currentB / state.baseWingspan;
        // group 的 children[0] 是实际 model（已均匀缩放）
        var model = group.children[0];
        if (!model) return;
        // 获取基准缩放（loadGalleryModel 设的 uniform scale）
        var baseScale = model.userData.engBaseScale;
        if (!baseScale) {
            baseScale = model.scale.x; // 首次记录基准
            model.userData.engBaseScale = baseScale;
        }
        // X 轴叠加翼展比例，Y/Z 保持基准
        model.scale.x = baseScale * ratio;
        model.scale.y = baseScale;
        model.scale.z = baseScale;
        model.updateMatrixWorld(true);
    }

    /* ---------- 报告导出 ---------- */
    function exportReport() {
        if (!state.sel) { alert('请先选择机型'); return; }
        var a = getParams();
        if (!(a.wingspan_m > 0 && a.wing_area_m2 > 0 && a.mtow_kg > 0)) { alert('参数不完整'); return; }
        var r = analyze(a);
        var ac = state.sel;
        var now = new Date();
        var ts = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') +
            ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        var official = ac.range_km ? ac.range_km + ' km' : '待核实';
        var dev = r.rangeEstKm && ac.range_km ? Math.abs(r.rangeEstKm - ac.range_km) / ac.range_km * 100 : null;
        var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
            '<title>' + ac.name + ' 工程分析报告</title>' +
            '<style>' +
            'body{font-family:"Consolas","Courier New",monospace;max-width:860px;margin:0 auto;padding:42px 36px;color:#cfe8f5;' +
            'background:radial-gradient(900px 420px at 85% -10%,rgba(0,229,255,.08),transparent 60%),' +
            'radial-gradient(700px 360px at 5% 110%,rgba(186,104,200,.07),transparent 60%),' +
            'linear-gradient(160deg,#070b18 0%,#0a1020 55%,#070d1c 100%);}' +
            'h1{color:#00e5ff;font-size:20px;letter-spacing:1px;border-bottom:1.5px solid rgba(0,229,255,.45);padding-bottom:10px;text-shadow:0 0 14px rgba(0,229,255,.35);}' +
            'h2{color:#7dd3fc;font-size:14px;margin:26px 0 10px;border-left:3px solid #00e5ff;padding-left:10px;letter-spacing:.5px;}' +
            'table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px;}' +
            'td,th{border:1px solid rgba(0,229,255,.18);padding:7px 11px;text-align:left;}' +
            'th{background:rgba(0,229,255,.07);color:#00e5ff;font-weight:600;}' +
            'tr:nth-child(even){background:rgba(255,255,255,.02);}' +
            '.tag{display:inline-block;background:rgba(0,229,255,.1);color:#7dd3fc;border:1px solid rgba(0,229,255,.35);border-radius:4px;padding:2px 10px;font-size:12px;margin-right:6px;}' +
            '.formula{background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.15);border-radius:6px;padding:10px 14px;font-size:13px;margin:8px 0;color:#8fd3ff;}' +
            '.note{font-size:12px;color:#5f7d8f;margin-top:6px;line-height:1.7;}' +
            '.deviation{color:' + (dev && dev > 10 ? '#ff6b6b' : '#7ee787') + ';font-weight:bold;}' +
            '@media print{body{padding:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}button{display:none;}}' +
            '</style></head><body>' +
            '<h1>◆ CYBER_WING — 飞行器工程分析报告</h1>' +
            '<p style="color:#5f7d8f;font-size:12px;">生成时间：' + ts + '</p>' +
            '<h2>■ 1. 机型信息</h2>' +
            '<table><tr><th>机型</th><td>' + ac.name + '</td><th>类别</th><td>' + (ac.category === 'civil' || ac.category === '商用' ? '民航' : '军用') + '</td></tr>' +
            '<tr><th>数据来源</th><td colspan="3">' + (ac.source || '未标注') + '</td></tr></table>' +
            '<h2>■ 2. 输入参数</h2>' +
            '<table><tr><th>参数</th><th>数值</th><th>单位</th><th>说明</th></tr>' +
            '<tr><td>翼展 (b)</td><td>' + a.wingspan_m + '</td><td>m</td><td>翼尖到翼尖距离</td></tr>' +
            '<tr><td>机翼面积 (S)</td><td>' + a.wing_area_m2 + '</td><td>m²</td><td>参考面积</td></tr>' +
            '<tr><td>最大起飞重量 (W₀)</td><td>' + a.mtow_kg.toLocaleString() + '</td><td>kg</td><td>MTOW</td></tr>' +
            '<tr><td>巡航速度 (V)</td><td>' + a.cruise_speed_kmh + '</td><td>km/h</td><td>' + (a.cruise_alt_m ? '@ ' + a.cruise_alt_m + 'm' : '') + '</td></tr>' +
            '</table>' +
            '<h2>■ 3. 计算结果</h2>' +
            '<table><tr><th>指标</th><th>数值</th><th>公式</th></tr>' +
            '<tr><td>展弦比 (AR)</td><td>' + r.ar.toFixed(2) + '</td><td class="formula" style="border:none">AR = b² / S = ' + a.wingspan_m + '² / ' + a.wing_area_m2 + '</td></tr>' +
            '<tr><td>翼载荷 (W/S)</td><td>' + r.wingLoad.toFixed(1) + ' kg/m²</td><td class="formula" style="border:none">W/S = ' + a.mtow_kg.toLocaleString() + ' / ' + a.wing_area_m2 + '</td></tr>' +
            '<tr><td>巡航升力系数 (CL)</td><td>' + r.cl.toFixed(3) + '</td><td class="formula" style="border:none">CL = 2W / (ρ·V²·S)</td></tr>' +
            '<tr><td>巡航升阻比 (L/D)</td><td>' + r.ld.toFixed(1) + '</td><td class="formula" style="border:none">L/D = 1 / (CD₀ + CL² / (π·e·AR))</td></tr>' +
            '<tr><td>失速速度（光洁）</td><td>' + r.vsCleanKmh.toFixed(0) + ' km/h</td><td class="formula" style="border:none">Vs = √(2W / (ρ·CL_max·S)), CL_max=1.5</td></tr>' +
            '<tr><td>失速速度（襟翼）</td><td>' + r.vsFlapKmh.toFixed(0) + ' km/h</td><td class="formula" style="border:none">Vs = √(2W / (ρ·CL_max·S)), CL_max=2.5</td></tr>' +
            '<tr><td>Breguet 航程估算</td><td>' + r.rangeEstKm.toFixed(0) + ' km</td><td class="formula" style="border:none">R = (V/(TSFC·g))·(L/D)·ln(W₀/W₁), W₁=0.8·W₀</td></tr>' +
            (ac.range_km ? '<tr><td>官方公布航程</td><td>' + official + '</td><td>—</td></tr>' +
            (dev !== null ? '<tr><td>估算偏差</td><td class="deviation">' + dev.toFixed(1) + '%</td><td>估算值 vs 官方值</td></tr>' : '') : '') +
            '</table>' +
            '<h2>■ 4. 公式说明与假设</h2>' +
            '<div class="formula">ISA 大气模型：ρ = ρ₀ × (1 - Lh/T₀)^(g/(L·R))，h ≤ 11000 m</div>' +
            '<div class="formula">展弦比：AR = b² / S</div>' +
            '<div class="formula">升力系数：CL = 2W / (ρ·V²·S)</div>' +
            '<div class="formula">升阻比：L/D = 1 / (CD₀ + CL² / (π·e·AR))</div>' +
            '<div class="formula">失速速度：Vs = √(2W / (ρ·CL_max·S))</div>' +
            '<div class="formula">Breguet 航程：R = (V / (TSFC·g)) × (L/D) × ln(W₀/W₁)</div>' +
            '<div class="note">' +
            '假设条件：<br>' +
            '• ISA 标准大气模型，对流层高度 h ≤ 11000 m<br>' +
            '• 零升阻力系数 CD₀ = 0.05（客机典型值），战斗机可取 0.025<br>' +
            '• 展弦效率因子 e = 0.75（客机），战斗机约 0.65<br>' +
            '• 单位推力耗油率 TSFC = 1.6×10⁻⁵ kg/(N·s)（涡扇典型值）<br>' +
            '• 落地重量 W₁ = 0.8 × W₀（默认耗油 20%）<br>' +
            '• CL_max 光洁 = 1.5，襟翼放下 = 2.5<br>' +
            '• 以上为工程估算，仅供教学演示，与官方公布值存在偏差属正常。<br>' +
            '• 所有数据来源已标注，不确定字段留空显示"待核实"，禁止编造。' +
            '</div>' +
            '<h2>■ 5. 数据来源</h2>' +
            '<div class="note">' + (ac.source || '未标注') + '</div>' +
            '<p style="margin-top:30px;color:#5f7d8f;font-size:11px;text-align:center;">CyberWing Aviation Hub · 工程分析模块 · ' + ts + '</p>' +
            '<div style="text-align:center;margin-top:20px;"><button onclick="window.print()" style="padding:10px 28px;font-size:13px;cursor:pointer;letter-spacing:1px;font-family:inherit;background:rgba(0,229,255,.12);color:#00e5ff;border:1px solid rgba(0,229,255,.45);border-radius:8px;">[ 打印 / 另存为 PDF ]</button></div>' +
            '</body></html>';
        // 新窗口打开报告
        var w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); }
        else { alert('弹窗被浏览器拦截，请允许弹窗后重试'); }
    }

    /* ---------- 多机型对比报告导出 ---------- */
    function exportCompareReport() {
        var selected = state.data.filter(function (a) {
            return state.radarSel[a.id] && a.wing_area_m2 > 0;
        });
        if (selected.length < 2) {
            alert('请先在"雷达对比"标签中勾选至少 2 架机型');
            switchChart('radar');
            return;
        }
        var now = new Date();
        var ts = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') +
            ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

        // 为每架机型计算完整指标
        var rows = selected.map(function (a) {
            var r = analyze(a);
            var tw = a.max_thrust_kn ? (a.max_thrust_kn * 1000) / (a.mtow_kg * G) : 0;
            var toR = a.max_thrust_kn ? calcTakeoff(a) : null;
            var ldR = calcLanding(a);
            return {
                ac: a, r: r, tw: tw, toR: toR, ldR: ldR
            };
        });

        // 构建对比表
        var metrics = [
            { label: '翼展 (m)', get: function (x) { return x.ac.wingspan_m; } },
            { label: '机翼面积 (m²)', get: function (x) { return x.ac.wing_area_m2; } },
            { label: 'MTOW (kg)', get: function (x) { return x.ac.mtow_kg.toLocaleString(); } },
            { label: '展弦比 AR', get: function (x) { return x.r.ar.toFixed(2); } },
            { label: '翼载荷 W/S (kg/m²)', get: function (x) { return x.r.wingLoad.toFixed(1); } },
            { label: '巡航升力系数 CL', get: function (x) { return x.r.cl.toFixed(3); } },
            { label: '升阻比 L/D', get: function (x) { return x.r.ld.toFixed(1); } },
            { label: '失速速度-光洁 (km/h)', get: function (x) { return x.r.vsCleanKmh.toFixed(0); } },
            { label: '失速速度-襟翼 (km/h)', get: function (x) { return x.r.vsFlapKmh.toFixed(0); } },
            { label: '巡航速度 (km/h)', get: function (x) { return x.ac.cruise_speed_kmh || '—'; } },
            { label: 'Breguet航程估算 (km)', get: function (x) { return (x.r.rangeEstKm || 0).toFixed(0); } },
            { label: '官方航程 (km)', get: function (x) { return x.ac.range_km ? x.ac.range_km : '待核实'; } },
            { label: '推重比 T/W', get: function (x) { return x.tw > 0 ? x.tw.toFixed(3) : '—'; } },
            { label: '起飞距离 (m)', get: function (x) { return x.toR ? x.toR.total : '—'; } },
            { label: '着陆距离 (m)', get: function (x) { return x.ldR.total; } }
        ];

        var headerCells = selected.map(function (x) { return '<th>' + x.name + '</th>'; }).join('');
        var bodyRows = metrics.map(function (m) {
            var cells = rows.map(function (x) { return '<td style="text-align:right;">' + m.get(x) + '</td>'; }).join('');
            return '<tr><th style="text-align:left;">' + m.label + '</th>' + cells + '</tr>';
        }).join('');

        // 找出每项最优值（高优指标）
        var bestBadges = '';
        var highBetter = ['展弦比 AR', '升阻比 L/D', 'Breguet航程估算 (km)'];
        var lowBetter = ['翼载荷 W/S (kg/m²)', '失速速度-光洁 (km/h)', '失速速度-襟翼 (km/h)', '起飞距离 (m)', '着陆距离 (m)'];

        // 数据来源汇总
        var sources = selected.map(function (x) {
            return '<li><strong>' + x.name + '</strong>：' + (x.source || '未标注') + '</li>';
        }).join('');

        var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
            '<title>多机型对比报告</title><style>' +
            'body{font-family:"Consolas","Courier New",monospace;max-width:1100px;margin:0 auto;padding:42px 36px;color:#cfe8f5;' +
            'background:radial-gradient(900px 420px at 85% -10%,rgba(0,229,255,.08),transparent 60%),' +
            'radial-gradient(700px 360px at 5% 110%,rgba(186,104,200,.07),transparent 60%),' +
            'linear-gradient(160deg,#070b18 0%,#0a1020 55%,#070d1c 100%);}' +
            'h1{color:#00e5ff;font-size:20px;letter-spacing:1px;border-bottom:1.5px solid rgba(0,229,255,.45);padding-bottom:10px;text-shadow:0 0 14px rgba(0,229,255,.35);}' +
            'h2{color:#7dd3fc;font-size:14px;margin:26px 0 10px;border-left:3px solid #00e5ff;padding-left:10px;letter-spacing:.5px;}' +
            'table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px;}' +
            'td,th{border:1px solid rgba(0,229,255,.18);padding:7px 10px;}' +
            'th{background:rgba(0,229,255,.07);color:#00e5ff;font-weight:600;}' +
            'tr:nth-child(even){background:rgba(255,255,255,.02);}' +
            'td:first-child,th:first-child{position:sticky;left:0;background:#0a1020;z-index:1;}' +
            '.note{font-size:12px;color:#5f7d8f;margin-top:6px;line-height:1.7;}' +
            '.best{color:#7ee787;font-weight:bold;}' +
            '@media print{body{padding:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}button{display:none;}}' +
            '</style></head><body>' +
            '<h1>◆ CYBER_WING — 多机型工程对比报告</h1>' +
            '<p style="color:#5f7d8f;font-size:12px;">生成时间：' + ts + ' ｜ 对比机型数：' + selected.length + '</p>' +
            '<h2>■ 1. 对比机型一览</h2>' +
            '<table><tr><th>机型</th><th>类别</th><th>翼展</th><th>翼面积</th><th>MTOW</th><th>数据来源</th></tr>' +
            selected.map(function (x) {
                return '<tr><td><strong>' + x.name + '</strong></td><td>' + (x.category === 'civil' ? '民航' : '军用') +
                    '</td><td>' + x.wingspan_m + ' m</td><td>' + x.wing_area_m2 + ' m²</td><td>' + x.mtow_kg.toLocaleString() + ' kg</td><td style="font-size:11px;color:#5f7d8f;">' + (x.source || '未标注') + '</td></tr>';
            }).join('') + '</table>' +
            '<h2>■ 2. 性能参数对比表</h2>' +
            '<div style="overflow-x:auto;"><table><tr><th style="text-align:left;">指标</th>' + headerCells + '</tr>' +
            bodyRows + '</table></div>' +
            '<h2>■ 3. 关键指标最优值</h2>' +
            '<table><tr><th>指标</th><th>最优机型</th><th>最优值</th><th>评价方向</th></tr>' +
            '<tr><td>最高升阻比 L/D</td><td>' + getBest(rows, function (x) { return x.r.ld; }, true) + '</td><td>高=高效巡航</td></tr>' +
            '<tr><td>最低翼载荷 W/S</td><td>' + getBest(rows, function (x) { return x.r.wingLoad; }, false) + '</td><td>低=高机动性</td></tr>' +
            '<tr><td>最高推重比 T/W</td><td>' + getBest(rows, function (x) { return x.tw; }, true) + '</td><td>高=强加速/爬升</td></tr>' +
            '<tr><td>最短起飞距离</td><td>' + getBest(rows, function (x) { return x.toR ? x.toR.total : 99999; }, false) + '</td><td>短=短距起降</td></tr>' +
            '<tr><td>最长估算航程</td><td>' + getBest(rows, function (x) { return x.r.rangeEstKm || 0; }, true) + '</td><td>长=远航能力</td></tr>' +
            '</table>' +
            '<h2>■ 4. 公式说明</h2>' +
            '<div class="note">' +
            '• 展弦比：AR = b² / S<br>' +
            '• 翼载荷：W/S = MTOW / S (kg/m²)<br>' +
            '• 巡航升力系数：CL = 2W / (ρ·V²·S)<br>' +
            '• 升阻比：L/D = 1 / (CD₀ + CL² / (π·e·AR))，CD₀=0.05, e=0.75<br>' +
            '• 失速速度：Vs = √(2W / (ρ·CL_max·S))，CL_max 光洁=1.5, 襟翼=2.5<br>' +
            '• Breguet 航程：R = (V/(TSFC·g))·(L/D)·ln(W₀/W₁)，W₁=0.8·W₀<br>' +
            '• 推重比：T/W = 总推力 / (MTOW·g)<br>' +
            '• 起飞距离：滑跑距离 = V_R²/(2·a) + 爬升至15m水平距离<br>' +
            '• 着陆距离：进近距离(3°下滑) + 地面制动距离<br>' +
            '• ISA 标准大气模型，h ≤ 11000 m<br>' +
            '• 以上为工程估算，仅供教学演示，与官方公布值存在偏差属正常。<br>' +
            '• 所有数据来源已标注，不确定字段留空显示"待核实"，禁止编造。' +
            '</div>' +
            '<h2>■ 5. 数据来源</h2>' +
            '<ul style="font-size:12px;color:#8fb8cc;">' + sources + '</ul>' +
            '<p style="margin-top:30px;color:#5f7d8f;font-size:11px;text-align:center;">CyberWing Aviation Hub · 多机型对比报告 · ' + ts + '</p>' +
            '<div style="text-align:center;margin-top:20px;"><button onclick="window.print()" style="padding:10px 28px;font-size:13px;cursor:pointer;letter-spacing:1px;font-family:inherit;background:rgba(0,229,255,.12);color:#00e5ff;border:1px solid rgba(0,229,255,.45);border-radius:8px;">[ 打印 / 另存为 PDF ]</button></div>' +
            '</body></html>';

        var w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); }
        else { alert('弹窗被浏览器拦截，请允许弹窗后重试'); }
    }

    function getBest(rows, valFn, higherBetter) {
        var best = null, bestIdx = -1;
        rows.forEach(function (x, i) {
            var v = valFn(x);
            if (v === null || v === undefined || isNaN(v)) return;
            if (best === null || (higherBetter ? v > best : v < best)) { best = v; bestIdx = i; }
        });
        if (bestIdx < 0) return '<td>—</td><td>—</td>';
        var ac = rows[bestIdx].ac;
        var unit = '';
        return '<td><strong>' + ac.name + '</strong></td><td>' + (typeof best === 'number' ? best.toFixed(1) : best) + '</td>';
    }

    window.Engineering = {
        open: open,
        close: close,
        pickAircraft: selectAircraft,
        recalc: function () { recalc(); drawCurrentDebounced(); },
        resetToSource: resetToSource,
        switchChart: switchChart,
        viewIn3D: viewIn3D,
        sync3D: sync3D,
        exportReport: exportReport,
        exportCompareReport: exportCompareReport,
        toggleRadar: toggleRadar,
        analyze: analyze,
        rhoAtAltitude: rhoAtAltitude
    };
})();