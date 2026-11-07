/* ═══════════════════════════════════════════════════════════════
   航空知识竞答页 3D 背景氛围层（quiz_3d_bg.js v20260906a）
   - 独立 WebGL 画布：双层星域粒子 + 全息飞翼（YB-35）环绕飞行
     （独立 renderer/scene，不与主画廊 three.js 场景冲突）
   - 卡片 3D 倾斜视差（事件委托：知识卡片 / 模式按钮 / 答题选项）
   - 依赖 index.html 模块脚本暴露的 window.THREE / window.GLTFLoader
   - 对外接口：window.Quiz3DBG.start() / stop()
     （由 switchToTab 钩子调用：进竞答页启动，切走暂停，省性能）
   ═══════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    /* ── 配置 ── */
    var PLANE_URL = '/static/models/northrop-yb-35.glb';
    var PLANE_SIZE = 7.5;      // 归一化后最大边长（场景单位）
    var ORBIT_SPEED = 0.20;    // 环绕角速度 rad/s
    var PLANE_YAW_FIX = 0;     // 模型机头朝向修正（截图校验后如反向改 Math.PI）
    // 椭圆轨道右偏：飞机只巡航在右侧竞答区上空，不飘到左侧资料库卡片上
    // 相机 z=27、水平半 FOV≈45°；参数经投影换算：屏幕横坐标始终 ≥ 画面中点
    var ORBIT_CX = 10;         // 轨道中心 X 偏移（世界单位）
    var ORBIT_RX = 9;          // 轨道 X 半轴（横纵向收窄 → 屏幕投影集中在右半区）
    var ORBIT_RZ = 14;         // 轨道 Z 半轴（最近点仍留在画面内，避免飞机"消失感"）

    var NO_HOVER = window.matchMedia && window.matchMedia('(hover: none)').matches;
    var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var TILT_SEL = '.kb-card, #quiz-mode-panel .quiz-mode-btn, .quiz-option';

    var S = {
        running: false, ready: false, modelLoaded: false,
        raf: 0, t: 0, tries: 0,
        renderer: null, scene: null, camera: null, clock: null,
        starA: null, starB: null, planeGroup: null, holoWire: null,
        mouse: { x: 0, y: 0 }, cam: { x: 0, y: 2.6 },
        container: null, canvas: null
    };
    var currentTilt = null;
    var _vAhead = null;

    /* ── 星域粒子 ── */
    function makeStars(THREE, count, sx, sy, sz, size, colors, opacity, starTex) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        var c = new THREE.Color();
        for (var i = 0; i < count; i++) {
            pos[i * 3] = (Math.random() - 0.5) * sx;
            pos[i * 3 + 1] = (Math.random() - 0.5) * sy;
            pos[i * 3 + 2] = (Math.random() - 0.5) * sz;
            c.set(colors[i % colors.length]);
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var mat = new THREE.PointsMaterial({
            size: size, vertexColors: true, transparent: true, opacity: opacity,
            map: starTex, alphaTest: 0.01,
            blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
        });
        return new THREE.Points(geo, mat);
    }

    /* ── 全息光晕贴图（径向渐变 canvas） ── */
    function makeGlowTexture() {
        var c = document.createElement('canvas');
        c.width = c.height = 128;
        var ctx = c.getContext('2d');
        var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(0,229,255,0.9)');
        g.addColorStop(0.35, 'rgba(0,229,255,0.28)');
        g.addColorStop(1, 'rgba(0,229,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        return c;
    }

    /* ── 星点贴图（柔和圆形，修复无贴图时方形点问题） ── */
    function makeStarTexture() {
        var c = document.createElement('canvas');
        c.width = c.height = 64;
        var ctx = c.getContext('2d');
        var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.3, 'rgba(255,255,255,0.85)');
        g.addColorStop(0.65, 'rgba(255,255,255,0.22)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        return c;
    }

    /* ── 模型全息化：半透明实体 + 线框双层（与画廊全息展示台风格统一） ── */
    function holoify(model, THREE) {
        var solid = new THREE.MeshBasicMaterial({
            color: 0x00e5ff, transparent: true, opacity: 0.16,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        var wire = new THREE.MeshBasicMaterial({
            color: 0x9df8ff, wireframe: true, transparent: true, opacity: 0.55,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        S.holoWire = wire;
        // 先收集再处理：避免遍历中新增节点被重复访问
        var meshes = [];
        model.traverse(function (o) { if (o.isMesh) meshes.push(o); });
        meshes.forEach(function (m) {
            m.material = solid;
            if (m.parent) {
                var w = new THREE.Mesh(m.geometry, wire);
                w.position.copy(m.position);
                w.rotation.copy(m.rotation);
                w.scale.copy(m.scale);
                m.parent.add(w);
            }
        });
    }

    /* ── 模型加载失败兜底：全息纸飞机（ShapeGeometry 手绘飞翼） ── */
    function buildFallbackPlane() {
        if (S.modelLoaded) return;
        S.modelLoaded = true;
        var THREE = window.THREE;
        if (!THREE || !S.planeGroup) return;
        var shape = new THREE.Shape();
        shape.moveTo(0, 2.8);        // 机头
        shape.lineTo(2.5, -1.7);     // 右翼尖
        shape.lineTo(0.6, -1.2);
        shape.lineTo(0, -1.6);
        shape.lineTo(-0.6, -1.2);
        shape.lineTo(-2.5, -1.7);    // 左翼尖
        shape.closePath();
        var geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(Math.PI / 2);    // XY 平面 → XZ 平面，机头朝 +Z
        var solid = new THREE.MeshBasicMaterial({
            color: 0x00e5ff, transparent: true, opacity: 0.12,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        var wire = new THREE.MeshBasicMaterial({
            color: 0x7df3ff, wireframe: true, transparent: true, opacity: 0.35,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        S.holoWire = wire;
        var g = new THREE.Group();
        g.add(new THREE.Mesh(geo, solid));
        g.add(new THREE.Mesh(geo, wire));
        S.planeGroup.add(g);
    }

    /* ── 场景构建（仅一次）：双画布方案
       背景画布（z-index 0，面板下方）：星域粒子氛围层，透过玻璃面板隐约可见
       顶层画布（z-index 2，面板上方）：全息飞翼掠过界面上方 */
    function build() {
        var THREE = window.THREE;
        S.container = document.getElementById('quiz-container');
        if (!S.container) return false;

        // 背景画布（星域）
        S.bgCanvas = document.createElement('canvas');
        S.bgCanvas.id = 'quiz-3d-stars';
        S.container.insertBefore(S.bgCanvas, S.container.firstChild);
        S.bgRenderer = new THREE.WebGLRenderer({ canvas: S.bgCanvas, antialias: true, alpha: true });
        S.bgRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        S.bgRenderer.setClearColor(0x000000, 0);
        S.bgScene = new THREE.Scene();

        // 顶层画布（全息飞翼）
        S.canvas = document.createElement('canvas');
        S.canvas.id = 'quiz-3d-canvas';
        S.container.appendChild(S.canvas);
        S.renderer = new THREE.WebGLRenderer({ canvas: S.canvas, antialias: true, alpha: true });
        S.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        S.renderer.setClearColor(0x000000, 0);

        S.scene = new THREE.Scene();
        S.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
        S.camera.position.set(0, 2.6, 27);
        S.clock = new THREE.Clock();
        _vAhead = new THREE.Vector3();

        // 灯光（全息材质为主，灯光作氛围辅助）
        S.scene.add(new THREE.AmbientLight(0x8899bb, 0.7));
        var key = new THREE.DirectionalLight(0xffffff, 1.1);
        key.position.set(6, 10, 8);
        S.scene.add(key);
        var rimC = new THREE.DirectionalLight(0x00e5ff, 1.5);
        rimC.position.set(-10, -2, 4);
        S.scene.add(rimC);
        var rimM = new THREE.DirectionalLight(0xff2d95, 0.8);
        rimM.position.set(12, 5, -8);
        S.scene.add(rimM);

        // 双层星域（远层细密 / 近层大颗粒青品混色，反向缓旋；圆形贴图；渲染到背景画布）
        var starTex = new THREE.CanvasTexture(makeStarTexture());
        S.starA = makeStars(THREE, 300, 110, 60, 70, 0.9, ['#9fd8ff', '#e8f6ff', '#7bb8ff'], 0.85, starTex);
        S.starB = makeStars(THREE, 120, 80, 40, 50, 2.2, ['#00e5ff', '#ff2d95', '#e8f6ff'], 0.9, starTex);
        S.bgScene.add(S.starA);
        S.bgScene.add(S.starB);

        // 飞翼组
        S.planeGroup = new THREE.Group();
        S.scene.add(S.planeGroup);

        // 全息光晕跟随
        var glowTex = new THREE.CanvasTexture(makeGlowTexture());
        var glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTex, color: 0x00e5ff, transparent: true, opacity: 0.30,
            blending: THREE.AdditiveBlending, depthWrite: false
        }));
        glow.scale.set(11, 11, 1);
        S.planeGroup.add(glow);

        // 加载 YB-35 飞翼模型（最小 495KB；失败走兜底）
        if (window.GLTFLoader) {
            try {
                new window.GLTFLoader().load(PLANE_URL, function (gltf) {
                    S.modelLoaded = true;
                    var model = gltf.scene;
                    var box = new THREE.Box3().setFromObject(model);
                    var size = box.getSize(new THREE.Vector3());
                    var center = box.getCenter(new THREE.Vector3());
                    var maxDim = Math.max(size.x, size.y, size.z) || 1;
                    model.position.sub(center);           // 几何居中，环绕不甩偏
                    holoify(model, THREE);
                    var holder = new THREE.Group();
                    holder.rotation.y = PLANE_YAW_FIX;
                    holder.add(model);
                    holder.scale.setScalar(PLANE_SIZE / maxDim);
                    S.planeGroup.add(holder);
                }, undefined, function () { buildFallbackPlane(); });
            } catch (e) { buildFallbackPlane(); }
        } else {
            buildFallbackPlane();
        }

        window.addEventListener('resize', onResize);
        S.container.addEventListener('mousemove', onPointerMove);
        S.container.addEventListener('mouseleave', function () { resetTilt(); });
        return true;
    }

    function onResize() {
        if (!S.container) return;
        var w = S.container.clientWidth, h = S.container.clientHeight;
        if (!w || !h) return;
        if (S.renderer && S.camera) {
            S.renderer.setSize(w, h, false);
            S.camera.aspect = w / h;
            S.camera.updateProjectionMatrix();
        }
        if (S.bgRenderer) {
            S.bgRenderer.setSize(w, h, false);
        }
    }

    /* ── 主循环 ── */
    function loop() {
        if (!S.running) return;
        S.raf = requestAnimationFrame(loop);
        var dt = Math.min(S.clock.getDelta(), 0.05);
        var t = (S.t += dt);

        // 星域反向缓旋（背景画布渲染，与飞翼共用相机视线方向）
        S.starA.rotation.y = t * 0.012;
        S.starB.rotation.y = -t * 0.02;
        if (S.bgRenderer) {
            S.bgCamera = S.bgCamera || new (window.THREE.PerspectiveCamera)(55, 1, 0.1, 400);
            S.bgCamera.position.copy(S.camera.position);
            S.bgCamera.lookAt(0, 2.2, 0);
            S.bgRenderer.render(S.bgScene, S.bgCamera);
        }

        // 飞翼环绕：椭圆轨道（中心右偏，覆盖右侧竞答区）+ 垂直起伏 + 机头朝切线 + 侧倾
        var a = t * (REDUCED ? ORBIT_SPEED * 0.35 : ORBIT_SPEED);
        var y = 3.4 + Math.sin(t * 0.6) * 1.8;
        S.planeGroup.position.set(ORBIT_CX + Math.cos(a) * ORBIT_RX, y, Math.sin(a) * ORBIT_RZ);
        _vAhead.set(ORBIT_CX + Math.cos(a + 0.03) * ORBIT_RX, y, Math.sin(a + 0.03) * ORBIT_RZ);
        S.planeGroup.lookAt(_vAhead);
        S.planeGroup.rotateZ(-0.35 + Math.sin(t * 0.8) * 0.08);

        // 全息线框呼吸
        if (S.holoWire) S.holoWire.opacity = 0.48 + Math.sin(t * 1.7) * 0.12;

        // 相机鼠标视差（缓动跟随）
        S.cam.x += (S.mouse.x * 2.4 - S.cam.x) * Math.min(1, dt * 3.2);
        S.cam.y += (2.6 - S.mouse.y * 1.4 - S.cam.y) * Math.min(1, dt * 3.2);
        S.camera.position.x = S.cam.x;
        S.camera.position.y = S.cam.y;
        S.camera.lookAt(0, 2.2, 0);

        S.renderer.render(S.scene, S.camera);
    }

    /* ── 卡片 3D 倾斜（事件委托 + 相机视差共用一个 mousemove） ── */
    function onPointerMove(e) {
        // 相机视差
        var w = window.innerWidth || 1, h = window.innerHeight || 1;
        S.mouse.x = (e.clientX / w) * 2 - 1;
        S.mouse.y = (e.clientY / h) * 2 - 1;

        if (NO_HOVER || REDUCED) return;

        // 卡片倾斜
        var card = (e.target && e.target.closest) ? e.target.closest(TILT_SEL) : null;
        if (card !== currentTilt) {
            resetTilt();
            currentTilt = card;
            if (card) card.classList.add('tilting');
        }
        if (!card) return;
        var r = card.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        var max = card.classList.contains('quiz-option') ? 4
            : (card.classList.contains('quiz-mode-btn') ? 6 : 7);
        var rx = (0.5 - py) * 2 * max;
        var ry = (px - 0.5) * 2 * max;
        card.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateZ(6px)';
    }

    function resetTilt() {
        if (currentTilt) {
            currentTilt.classList.remove('tilting');
            currentTilt.style.transform = '';
            currentTilt = null;
        }
    }

    /* ── 启停（幂等，供 switchToTab 钩子调用） ── */
    function start() {
        if (S.running) return;
        if (!window.THREE) {
            // 模块脚本（CDN）未就绪：重试约 4s，仍失败则保持纯 CSS 深空背景
            if (++S.tries > 20) return;
            setTimeout(start, 200);
            return;
        }
        S.tries = 0;
        if (!S.ready) {
            if (!build()) return;
            S.ready = true;
        }
        onResize();
        S.running = true;
        S.clock.getDelta();   // 清空累积 delta，防止恢复时跳变
        cancelAnimationFrame(S.raf);
        S.raf = requestAnimationFrame(loop);
    }

    function stop() {
        S.running = false;
        cancelAnimationFrame(S.raf);
        resetTilt();
    }

    window.Quiz3DBG = { start: start, stop: stop };

    // 只读调试口（控制台验证用：ES 模块作用域变量控制台取不到）
    window.__quiz3dbg = function () {
        var info = S.renderer && S.renderer.info ? S.renderer.info.render : null;
        return {
            running: S.running, ready: S.ready, modelLoaded: S.modelLoaded,
            planeChildren: S.planeGroup ? S.planeGroup.children.length : 0,
            canvasInDom: !!(S.canvas && S.canvas.parentNode),
            starsCanvasInDom: !!(S.bgCanvas && S.bgCanvas.parentNode),
            drawCalls: info ? info.calls : -1,
            triangles: info ? info.triangles : -1
        };
    };
})();
