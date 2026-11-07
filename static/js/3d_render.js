/**
 * 3D高清渲染模块 - 基于Three.js（非ES Module版本）
 * 统一封装PBR渲染、轨道控制、GLB加载
 * 所有页面复用此模块，CDN优先+本地回退
 * 修复：模块加载、参数传递、资源销毁、错误捕获
 */

// ===== Three.js CDN加载器（本地优先，CDN回退） =====
const THREE_CDN = {
    core: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js',
    orbitControls: 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/js/controls/OrbitControls.js',
    gltfLoader: 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/js/loaders/GLTFLoader.js'
};
const THREE_LOCAL = {
    core: '/static/js/three/three.module.js',
    orbitControls: '/static/js/three/OrbitControls.js',
    gltfLoader: '/static/js/three/GLTFLoader.js'
};

/** 动态加载脚本 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        // 检查是否已加载
        if (src.includes('three.min.js') || src.includes('three.module.js')) {
            if (window.THREE) { resolve(); return; }
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

/** 加载Three.js及插件（本地优先，CDN回退） */
async function ensureThreeJS() {
    if (window.THREE && window.OrbitControls && window.GLTFLoader) {
        return; // 已加载
    }
    // 尝试本地加载
    try {
        await loadScript(THREE_LOCAL.core);
    } catch {
        // 本地失败，用CDN
        try {
            await loadScript(THREE_CDN.core);
        } catch (e) {
            console.error('[3D] Three.js核心库加载失败', e);
            throw new Error('Three.js核心库加载失败');
        }
    }
    // 加载OrbitControls
    if (!window.OrbitControls) {
        try { await loadScript(THREE_LOCAL.orbitControls); } catch {
            try { await loadScript(THREE_CDN.orbitControls); } catch (e) {
                console.error('[3D] OrbitControls加载失败', e);
            }
        }
    }
    // 加载GLTFLoader
    if (!window.GLTFLoader) {
        try { await loadScript(THREE_LOCAL.gltfLoader); } catch {
            try { await loadScript(THREE_CDN.gltfLoader); } catch (e) {
                console.error('[3D] GLTFLoader加载失败', e);
            }
        }
    }
}

// ===== 全局3D查看器状态 =====
window._3dViewer = null;
window._3dAnimating = false;

// ===== 沙盒手感参数（前端切换，不读写数据库） =====
// 默认：战斗机手感
window._currentAircraftWeight = 1.2;
window._currentAircraftGlide = 0.35;
window._currentAircraftWind = 0.2;
window._currentAircraftBounce = 0.4;

/** 沙盒机型手感切换（由 index.html 按钮调用） */
window.setAircraftHandling = function (type) {
    switch (type) {
        case 'fighter':
            window._currentAircraftWeight = 1.2;
            window._currentAircraftGlide = 0.35;
            window._currentAircraftWind = 0.2;
            window._currentAircraftBounce = 0.4;
            break;
        case 'airliner':
            window._currentAircraftWeight = 2.8;
            window._currentAircraftGlide = 0.75;
            window._currentAircraftWind = 0.3;
            window._currentAircraftBounce = 0.22;
            break;
        case 'transport':
            window._currentAircraftWeight = 4.5;
            window._currentAircraftGlide = 0.52;
            window._currentAircraftWind = 0.78;
            window._currentAircraftBounce = 0.36;
            break;
        default:
            console.warn('[setAircraftHandling] 未知机型:', type, '，使用默认战斗机参数');
            window._currentAircraftWeight = 1.2;
            window._currentAircraftGlide = 0.35;
            window._currentAircraftWind = 0.2;
            window._currentAircraftBounce = 0.4;
    }
    console.log('[setAircraftHandling] 切换到', type,
        'weight=', window._currentAircraftWeight,
        'glide=', window._currentAircraftGlide,
        'wind=', window._currentAircraftWind,
        'bounce=', window._currentAircraftBounce);
};

// ===== 沙盒风向系统变量（全局作用域） =====
/** 风向枚举 */
const WIND_DIRECTION = Object.freeze({
    NONE: '无风',       // 无风
    EAST: '东风',       // 东风（X轴正方向）
    WEST: '西风',       // 西风（X轴负方向）
    GUST: '阵风'        // 阵风（随机方向突变）
});

/** 当前风向枚举值，默认无风 */
window._windDirection = WIND_DIRECTION.NONE;

/** 风力强度数值（0-1），默认0，无风 */
window._windIntensity = 0;

/** 风向切换计时器ID（用于周期性自动切换风向） */
window._windSwitchTimer = null;

// ===== 沙盒风向定时随机切换 =====
/** 随机切换风向：从无风/东风/西风/阵风中随机选取，并同步更新风力强度 */
function randomizeWindDirection() {
    const directions = [WIND_DIRECTION.NONE, WIND_DIRECTION.EAST, WIND_DIRECTION.WEST, WIND_DIRECTION.GUST];
    const randomIndex = Math.floor(Math.random() * directions.length);
    const newDir = directions[randomIndex];
    window._windDirection = newDir;

    // 根据风向设置风力强度
    if (newDir === WIND_DIRECTION.NONE) {
        window._windIntensity = 0;
    } else if (newDir === WIND_DIRECTION.GUST) {
        window._windIntensity = 0.5 + Math.random() * 0.5; // 阵风强度 0.5~1.0
    } else {
        window._windIntensity = 0.3 + Math.random() * 0.7; // 东风/西风强度 0.3~1.0
    }

    console.log('[wind] 风向切换为:', newDir, '强度:', window._windIntensity.toFixed(2));
}

/** 启动风向定时切换（每5秒随机切换一次） */
function startWindSwitchTimer() {
    stopWindSwitchTimer();
    // 立即执行一次随机切换
    randomizeWindDirection();
    window._windSwitchTimer = setInterval(randomizeWindDirection, 5000);
}

/** 停止风向定时切换 */
function stopWindSwitchTimer() {
    if (window._windSwitchTimer) {
        clearInterval(window._windSwitchTimer);
        window._windSwitchTimer = null;
    }
}

// ===== 场景切换全局变量 =====
let currentSceneGroup = null;
const SCENE_TYPE = {
    CYBER: "cyber",
    GRASS: "grass",
    LAKE: "lake"
};

/** 清空旧场景（彻底递归销毁所有子物体，释放 geometry/material/texture/skeleton 全部 GPU 内存，杜绝残留无效 Three 对象抛出报错） */
function clearOldScene() {
    if (!currentSceneGroup) return;

    /**
     * 释放单个材质及其关联的所有纹理贴图
     * 覆盖常见 PBR 纹理通道：map, normalMap, roughnessMap, metalnessMap, emissiveMap, aoMap 等
     */
    function disposeMaterial(mat) {
        if (!mat) return;
        var texProps = [
            'map', 'lightMap', 'bumpMap', 'normalMap', 'specularMap',
            'envMap', 'alphaMap', 'aoMap', 'displacementMap',
            'emissiveMap', 'metalnessMap', 'roughnessMap',
            'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
            'sheenColorMap', 'sheenRoughnessMap',
            'transmissionMap', 'thicknessMap'
        ];
        texProps.forEach(function (prop) {
            if (mat[prop] && typeof mat[prop].dispose === 'function') {
                mat[prop].dispose();
                mat[prop] = null;
            }
        });
        if (typeof mat.dispose === 'function') {
            mat.dispose();
        }
    }

    /**
     * 递归遍历并彻底销毁一个 Three.Object3D 及其所有后代
     * - 覆盖 Mesh / SkinnedMesh / InstancedMesh / Line / Points 等常见可渲染对象
     * - 释放 geometry, material（含数组）, 纹理, skeleton, morphTarget 等 GPU 资源
     * - 从父节点移除、清空 userData、置空引用，杜绝残留无效对象
     * - 自底向上处理，确保所有层级无遗漏
     */
    function disposeObject(obj) {
        if (!obj) return;

        // 1. 先递归处理所有子物体（自底向上，保证最深层先释放）
        while (obj.children.length > 0) {
            disposeObject(obj.children[0]);
        }

        // 2. 释放几何体
        if (obj.geometry && typeof obj.geometry.dispose === 'function') {
            obj.geometry.dispose();
            obj.geometry = null;
        }

        // 3. 释放材质及其纹理（支持单材质 / 多材质数组）
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(function (m) { disposeMaterial(m); });
            } else {
                disposeMaterial(obj.material);
            }
            obj.material = null;
        }

        // 4. 处理骨骼（SkinnedMesh 专属）
        if (obj.skeleton) {
            if (obj.skeleton.bones && Array.isArray(obj.skeleton.bones)) {
                obj.skeleton.bones.forEach(function (bone) {
                    // 骨骼本身可能携带辅助几何体（如 BoneHelper 残留）
                    if (bone.children) {
                        while (bone.children.length > 0) {
                            var child = bone.children[0];
                            if (child.geometry && typeof child.geometry.dispose === 'function') {
                                child.geometry.dispose();
                                child.geometry = null;
                            }
                            if (child.material) {
                                if (Array.isArray(child.material)) {
                                    child.material.forEach(function (m) { disposeMaterial(m); });
                                } else {
                                    disposeMaterial(child.material);
                                }
                                child.material = null;
                            }
                            bone.remove(child);
                        }
                    }
                    // 骨骼自身的引用清理
                    bone.userData = {};
                });
            }
            obj.skeleton = null;
        }

        // 5. 清空 morphTarget 引用
        if (obj.morphTargetInfluences) { obj.morphTargetInfluences = null; }
        if (obj.morphTargetDictionary) { obj.morphTargetDictionary = null; }

        // 6. 清空用户自定义数据（释放闭包引用链）
        obj.userData = {};

        // 7. 从父对象中移除（切断 Three.js 内部引用链）
        if (obj.parent) {
            obj.parent.remove(obj);
        }

        // 8. 将父引用置 null，彻底解除关联
        obj.parent = null;
    }

    // ===== 执行销毁 =====

    // 递归销毁 currentSceneGroup 及其全部后代
    // disposeObject 内部已调用 disposeMaterial，释放所有材质及其关联的纹理贴图
    // 包括：墙体材质(map→sharedBuildingTex)、地面材质(map→sharedBuildingTex)、金属外立面材质(所有纹理通道)
    disposeObject(currentSceneGroup);

    // 额外释放全局缓存的共用贴图引用（虽已被第一个clone材质dispose，此处确保彻底清理）
    if (sharedBuildingTex && typeof sharedBuildingTex.dispose === 'function') {
        try { sharedBuildingTex.dispose(); } catch (e) { /* 已被disposeMaterial释放，忽略重复dispose */ }
    }
    sharedBuildingTex = null;

    // 从所有可能持有该 Group 的 Three.js 场景中安全移除（try-catch 防止重复移除报错）


    var viewer = window._3dViewer;
    if (viewer && viewer.scene) {
        try { viewer.scene.remove(currentSceneGroup); } catch (e) { /* 已经移除或不在场景中 */ }
    }
    if (window.sandboxScene) {
        try { window.sandboxScene.remove(currentSceneGroup); } catch (e) { /* 已经移除或不在场景中 */ }
    }

    // 清空全局引用
    currentSceneGroup = null;

    // 清空城市动画注册表（切场景后旧动画闭包随旧网格一同失效）
    window._cyberCityAnimators = null;

    // 尝试触发 GC（部分浏览器 devtools 环境可用）
    if (typeof window.gc === 'function') {
        try { window.gc(); } catch (e) { /* GC 不可用 */ }
    }

    console.log('[3D] 旧场景已彻底清除 — geometry / material / texture / skeleton 全部 GPU 内存已释放，无残留无效对象');
}

/** 全局场景切换入口 */
window.switchScene = function (type) {
    clearOldScene();
    let group = null;
    switch (type) {
        case SCENE_TYPE.CYBER:
            group = generateCyberScene();
            break;
        case SCENE_TYPE.GRASS:
            group = generateGrassScene();
            break;
        case SCENE_TYPE.LAKE:
            group = generateLakeScene();
            break;
        default:
            group = generateCyberScene();
            break;
    }
    if (!group) {
        console.warn("[switchScene] 场景生成失败，type=" + type);
        return null;
    }
    // 优先添加到弹窗查看器场景，其次添加到沙盒场景
    const viewer = window._3dViewer;
    if (viewer && viewer.scene) {
        // ===== 赛博朋克模式专属：雾效 + 环境光调整 + 地面反射镜面 =====
        if (type === SCENE_TYPE.CYBER && window.THREE) {
            var THREE = window.THREE;
            // 蓝紫色雾气 — 营造夜景氛围
            viewer.scene.fog = new THREE.Fog(0x080c1a, 15, 60);
            viewer.scene.background = new THREE.Color(0x060a18);
            // 调整渲染器曝光，增强霓虹光感
            if (viewer.renderer) {
                viewer.renderer.toneMappingExposure = 1.5;
            }
            // 添加地面反射镜面（使用MirrorReflector或简单反射平面）
            addCyberGroundReflection(viewer);
            // 调整现有灯光为赛博朋克风格
            adjustCyberLighting(viewer);
        } else {
            // 非赛博模式：移除雾气，恢复默认背景
            viewer.scene.fog = null;
            if (viewer.renderer) {
                viewer.renderer.toneMappingExposure = 1.2;
            }
            // 移除赛博反光地面
            removeCyberGroundReflection(viewer);
            // 恢复默认背景渐变
            var canvas = document.createElement('canvas');
            canvas.width = 2; canvas.height = 512;
            var ctx = canvas.getContext('2d');
            var grad = ctx.createLinearGradient(0, 0, 0, 512);
            grad.addColorStop(0, '#0a1628');
            grad.addColorStop(0.4, '#0f2847');
            grad.addColorStop(0.7, '#162d50');
            grad.addColorStop(1, '#1a3a5c');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 2, 512);
            var bgTex = new THREE.CanvasTexture(canvas);
            viewer.scene.background = bgTex;
        }
        viewer.scene.add(group);
        currentSceneGroup = group;
        console.log("[switchScene] 已添加到弹窗查看器场景：" + type);
    } else {
        // ── 单路径重构：程序化场景永不进入沙盒 ──
        // 沙盒由用户 GLB 赛博城市独占（历史 bug：此处会把程序化城市塞进沙盒并覆盖浓雾 near=30，
        // 导致 GLB 城市被雾吞掉、出现"旧场景叠加"——永久禁用该注入路径）
        console.log('[switchScene] 无弹窗查看器，程序化场景已丢弃（沙盒由用户 GLB 场景独占，禁止注入）');
        currentSceneGroup = null;
    }
    return group;
};

/** 添加赛博朋克反光地面（镜面反射平面） */
function addCyberGroundReflection(viewer) {
    if (!viewer || !viewer.scene || !window.THREE) return;
    var THREE = window.THREE;
    // 避免重复添加
    if (viewer.scene.getObjectByName('cyber-reflection-ground')) return;
    var groundGeo = new THREE.PlaneGeometry(60, 60);
    var groundMat = new THREE.MeshStandardMaterial({
        color: 0xCFCFCF,
        metalness: 0.9,
        roughness: 0.2,
        envMapIntensity: 0.8,
        transparent: true,
        opacity: 0.65
    });
    var ground = new THREE.Mesh(groundGeo, groundMat);
    ground.name = 'cyber-reflection-ground';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    ground.renderOrder = 0;
    viewer.scene.add(ground);
    console.log('[赛博场景] 反光地面已添加');
}

/** 移除赛博反光地面 */
function removeCyberGroundReflection(viewer) {
    if (!viewer || !viewer.scene) return;
    var ground = viewer.scene.getObjectByName('cyber-reflection-ground');
    if (ground) {
        if (ground.geometry) ground.geometry.dispose();
        if (ground.material) ground.material.dispose();
        viewer.scene.remove(ground);
    }
}

/** 调整现有灯光为赛博朋克风格 */
function adjustCyberLighting(viewer) {
    if (!viewer || !viewer.scene) return;
    // 遍历场景中现有灯光，调整色调和强度
    viewer.scene.traverse(function (child) {
        if (child.isLight) {
            if (child.isAmbientLight) {
                // 环境光改为蓝紫色调
                child.color.set(0x1a1040);
                child.intensity = 0.4;
            } else if (child.isDirectionalLight) {
                // 方向光改为冷色调，增强霓虹反射
                var pos = child.position;
                if (pos.y > 5) {
                    // 主光源：冷白偏蓝
                    child.color.set(0xccddff);
                    child.intensity = 1.8;
                } else if (pos.x < 0) {
                    // 补光：粉紫色
                    child.color.set(0xff4488);
                    child.intensity = 0.35;
                } else {
                    // 轮廓光：青色
                    child.color.set(0x44ccff);
                    child.intensity = 0.3;
                }
            }
            // HemisphereLight 调整
            if (child.isHemisphereLight) {
                child.color.set(0x221144);
                child.groundColor.set(0x0a0a18);
                child.intensity = 0.45;
            }
        }
    });
}

// ===== 打开3D查看弹窗 =====
window.open3DViewer = async function (aircraftId, modelFile, aircraftName) {
    try {
        // 【校验1】如果model_file为空，提示无资源
        if (!modelFile || modelFile.trim() === '') {
            alert('🛩️ 暂无3D模型资源\n该飞行器尚未上传3D模型文件');
            return;
        }

        // 【校验2】防止重复点击
        if (window._3dViewer) {
            close3DViewer();
        }

        // 创建弹窗DOM - 深空暗底风格
        const modal = document.createElement('div');
        modal.id = 'modal-3d';
        modal.innerHTML = `
            <div class="modal-3d-overlay">
                <div class="modal-3d-container">
                    <div class="modal-3d-header">
                        <h3 class="modal-3d-title">🛩️ ${aircraftName} - 高清3D查看</h3>
                        <div class="modal-3d-actions">
                            <button class="btn-3d" onclick="window._3dViewer&&window._3dViewer.toggleWireframe()" title="线框/实体切换">🔲 线框</button>
                            <button class="btn-3d" onclick="window._3dViewer&&window._3dViewer.resetCamera()" title="复位视角">🎯 复位</button>
                            <button class="btn-3d" onclick="window._3dViewer&&window._3dViewer.toggleAutoRotate()" title="自动旋转">🔄 旋转</button>
                            <button class="btn-3d btn-3d-close" onclick="close3DViewer()" title="关闭">✕ 关闭</button>
                        </div>
                    </div>
                    <div class="modal-3d-body" id="viewer-3d-container" style="background:#0A1629;">
                        <div class="viewer-loading" id="viewer-loading">
                            <div class="viewer-loading-spinner" style="border-color:#0F2040;border-top-color:#4EE0FF;"></div>
                            <div class="viewer-loading-text">🛩️ 3D引擎加载中...</div>
                            <div class="viewer-loading-progress" id="viewer-progress">0%</div>
                            <div class="viewer-loading-bar"><div class="viewer-loading-bar-fill" id="viewer-progress-bar"></div></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 点击遮罩关闭
        modal.querySelector('.modal-3d-overlay').addEventListener('click', function (e) {
            if (e.target === this) close3DViewer();
        });

        // ESC关闭
        window._3dEscHandler = function (e) {
            if (e.key === 'Escape') close3DViewer();
        };
        document.addEventListener('keydown', window._3dEscHandler);

        // 加载Three.js
        await ensureThreeJS();

        if (!window.THREE) {
            show3DError('Three.js引擎加载失败，请刷新重试');
            return;
        }

        // 初始化3D查看器
        window._3dViewer = new AircraftViewer('viewer-3d-container');

        // 加载模型
        try {
            await window._3dViewer.loadModel(modelFile);
        } catch (err) {
            console.error('[3D] 模型加载失败:', err);
            show3DError('3D模型加载失败，资源缺失或文件损坏\n路径: ' + modelFile);
        }

    } catch (err) {
        console.error('[3D] 初始化异常:', err);
        show3DError('3D渲染初始化失败: ' + err.message);
    }
};

// ===== 关闭3D弹窗 =====
window.close3DViewer = function () {
    // 销毁Three.js资源
    if (window._3dViewer) {
        try {
            window._3dViewer.dispose();
        } catch (e) {
            console.warn('[3D] 销毁异常:', e);
        }
        window._3dViewer = null;
    }
    window._3dAnimating = false;

    // 移除ESC监听
    if (window._3dEscHandler) {
        document.removeEventListener('keydown', window._3dEscHandler);
        window._3dEscHandler = null;
    }

    // 移除弹窗DOM
    const modal = document.getElementById('modal-3d');
    if (modal) modal.remove();
};

// ===== 显示3D错误 =====
function show3DError(msg) {
    const container = document.getElementById('viewer-3d-container');
    if (!container) {
        alert('❌ ' + msg);
        return;
    }
    const errEl = document.createElement('div');
    errEl.className = 'viewer-error';
    errEl.innerHTML = `<div class="viewer-error-icon">⚠️</div><div class="viewer-error-msg">${msg.replace(/\n/g, '<br>')}</div>`;
    container.appendChild(errEl);
    // 隐藏loading
    const loading = document.getElementById('viewer-loading');
    if (loading) loading.style.display = 'none';
}

// ===== AircraftViewer 类 =====
class AircraftViewer {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;
        this.options = {
            autoRotate: true,
            autoRotateSpeed: 1.0,
            showGrid: true,
            backgroundColor: 0x0a1628,
            ...options
        };
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.model = null;
        this.mixer = null;
        this.clock = null;
        this.isWireframe = false;
        this._animId = null;
        this._onResize = null;
        this.init();
    }

    init() {
        try {
            const w = this.container.clientWidth || 800;
            const h = this.container.clientHeight || 600;

            // 场景
            this.scene = new THREE.Scene();

            // 渐变深空背景
            const canvas = document.createElement('canvas');
            canvas.width = 2; canvas.height = 512;
            const ctx = canvas.getContext('2d');
            const grad = ctx.createLinearGradient(0, 0, 0, 512);
            grad.addColorStop(0, '#0a1628');
            grad.addColorStop(0.4, '#0f2847');
            grad.addColorStop(0.7, '#162d50');
            grad.addColorStop(1, '#1a3a5c');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 2, 512);
            const bgTex = new THREE.CanvasTexture(canvas);
            this.scene.background = bgTex;

            // 相机
            this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
            this.camera.position.set(5, 3, 5);

            // 渲染器
            this.renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                powerPreference: 'high-performance'
            });
            this.renderer.setSize(w, h);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.2;
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.container.appendChild(this.renderer.domElement);

            // 光影系统 - PBR级
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
            this.scene.add(ambientLight);

            const hemiLight = new THREE.HemisphereLight(0xccddff, 0x445566, 0.35);
            this.scene.add(hemiLight);

            const dirLight = new THREE.DirectionalLight(0xffeedd, 1.6);
            dirLight.position.set(5, 10, 7);
            dirLight.castShadow = true;
            dirLight.shadow.mapSize.width = 2048;
            dirLight.shadow.mapSize.height = 2048;
            dirLight.shadow.camera.near = 0.5;
            dirLight.shadow.camera.far = 50;
            dirLight.shadow.camera.left = -10;
            dirLight.shadow.camera.right = 10;
            dirLight.shadow.camera.top = 10;
            dirLight.shadow.camera.bottom = -10;
            dirLight.shadow.bias = -0.0001;
            this.scene.add(dirLight);

            const fillLight = new THREE.DirectionalLight(0x4488ff, 0.25);
            fillLight.position.set(-5, 3, -5);
            this.scene.add(fillLight);

            const rimLight = new THREE.DirectionalLight(0x88ccff, 0.2);
            rimLight.position.set(0, -3, -5);
            this.scene.add(rimLight);

            // 地面网格
            if (this.options.showGrid) {
                const gridHelper = new THREE.GridHelper(20, 40, 0x2a5298, 0x1a3a5c);
                gridHelper.material.opacity = 0.4;
                gridHelper.material.transparent = true;
                this.scene.add(gridHelper);

                const groundGeo = new THREE.PlaneGeometry(20, 20);
                const groundMat = new THREE.ShadowMaterial({ opacity: 0.2 });
                const ground = new THREE.Mesh(groundGeo, groundMat);
                ground.rotation.x = -Math.PI / 2;
                ground.receiveShadow = true;
                this.scene.add(ground);
            }

            // 轨道控制器
            if (window.OrbitControls) {
                this.controls = new window.OrbitControls(this.camera, this.renderer.domElement);
                this.controls.enableDamping = true;
                this.controls.dampingFactor = 0.08;
                this.controls.autoRotate = this.options.autoRotate;
                this.controls.autoRotateSpeed = this.options.autoRotateSpeed;
                this.controls.minDistance = 1;
                this.controls.maxDistance = 50;
                this.controls.target.set(0, 1, 0);
            }

            // 时钟
            this.clock = new THREE.Clock();

            // 窗口自适应
            this._onResize = () => {
                const w = this.container.clientWidth;
                const h = this.container.clientHeight;
                if (w > 0 && h > 0) {
                    this.camera.aspect = w / h;
                    this.camera.updateProjectionMatrix();
                    this.renderer.setSize(w, h);
                }
            };
            window.addEventListener('resize', this._onResize);

            // 动画循环
            this._animate();

            // 延时加载默认赛博朋克场景
            setTimeout(() => {
                console.log("init延时1000ms，切换默认场景");
                window.switchScene(SCENE_TYPE.CYBER);
            }, 1000);

        } catch (err) {
            console.error('[3D] 初始化失败:', err);
            show3DError('3D渲染初始化失败: ' + err.message);
        }
    }

    /** 批量生成赛博朋克楼房（全部集中在右侧高塔区域，避开飞机飞行轨迹） */
    createCyberBuildings(count = 10) {
        const buildings = new THREE.Group();
        buildings.name = 'cyber-buildings';
        // 右侧区域：X轴 +5 ~ +16，Z轴纵深 -15 ~ +15
        const minX = 5, maxX = 16;
        const minZ = -15, maxZ = 15;
        // 前排/后排错落层次
        const rows = [6, 9, 12, 15];
        const colors = {
            pink: 0xff0080,
            cyan: 0x00e5ff,
            body: 0xb0bcc6,
            bodyDark: 0x8899aa,
        };
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const rand = (lo, hi) => lo + Math.random() * (hi - lo);
        const countClamped = clamp(count, 8, 12);
        for (let i = 0; i < countClamped; i++) {
            // 高度范围拉大：4~38，低矮底层+摩天高楼分层
            const h = i < 3 ? rand(4, 10) : (i < 7 ? rand(10, 22) : rand(22, 38));
            const w = rand(0.9, 3.0);
            const d = rand(0.9, 3.0);
            // 全部在右侧，X分4个层次前后错落
            const xLayer = rows[i % rows.length];
            const x = xLayer + rand(-1.5, 1.5);
            const z = rand(minZ, maxZ);
            const y = h / 2;
            const bodyGeo = new THREE.BoxGeometry(w, h, d);
            const bodyMat = new THREE.MeshStandardMaterial({
                color: i % 3 === 0 ? colors.body : (i % 3 === 1 ? colors.bodyDark : 0x99aabb),
                metalness: 0.85,
                roughness: 0.10,
            });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.set(x, y, z);
            body.castShadow = true;
            body.receiveShadow = true;
            buildings.add(body);
            // 霓虹灯带 — 强化自发光亮度
            const stripW = 0.07;
            const stripD = 0.025;
            const stripCount = Math.floor(h / 2.0);
            const neonColor = i % 2 === 0 ? colors.pink : colors.cyan;
            const stripMat = new THREE.MeshStandardMaterial({
                color: neonColor,
                emissive: neonColor,
                emissiveIntensity: 3.5,
                metalness: 0.05,
                roughness: 0.15,
            });
            for (let s = 0; s < stripCount; s++) {
                const stripH = h * rand(0.55, 0.98);
                const stripGeo = new THREE.BoxGeometry(stripW, stripH, stripD);
                const stripFront = new THREE.Mesh(stripGeo, stripMat);
                stripFront.position.set(x + rand(-w / 2 + 0.25, w / 2 - 0.25), y + rand(-h / 3, h / 3), z + d / 2 + 0.015);
                buildings.add(stripFront);
                const stripBack = new THREE.Mesh(stripGeo, stripMat);
                stripBack.position.set(x + rand(-w / 2 + 0.25, w / 2 - 0.25), y + rand(-h / 3, h / 3), z - d / 2 - 0.015);
                buildings.add(stripBack);
                const sideStripGeo = new THREE.BoxGeometry(stripD, stripH, stripW);
                const stripLeft = new THREE.Mesh(sideStripGeo, stripMat);
                stripLeft.position.set(x - w / 2 - 0.015, y + rand(-h / 3, h / 3), z + rand(-d / 2 + 0.25, d / 2 - 0.25));
                buildings.add(stripLeft);
                const stripRight = new THREE.Mesh(sideStripGeo, stripMat);
                stripRight.position.set(x + w / 2 + 0.015, y + rand(-h / 3, h / 3), z + rand(-d / 2 + 0.25, d / 2 - 0.25));
                buildings.add(stripRight);
            }
            // 屋顶霓虹广告牌 — 强化发光
            const signW = w * clamp(rand(0.35, 0.75), 0.35, 0.75);
            const signD = d * clamp(rand(0.15, 0.45), 0.15, 0.45);
            const signH = clamp(rand(0.5, 1.5), 0.5, 1.5);
            const signGeo = new THREE.BoxGeometry(signW, signH, signD);
            const signColor = i % 2 === 0 ? colors.cyan : colors.pink;
            const signMat = new THREE.MeshStandardMaterial({
                color: signColor,
                emissive: signColor,
                emissiveIntensity: 4.0,
                metalness: 0.1,
                roughness: 0.08,
            });
            const sign = new THREE.Mesh(signGeo, signMat);
            sign.position.set(x + rand(-w * 0.12, w * 0.12), h + signH / 2, z + rand(-d * 0.08, d * 0.08));
            sign.castShadow = true;
            buildings.add(sign);
            const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, signH * 0.5, 8);
            const poleMat = new THREE.MeshStandardMaterial({
                color: colors.bodyDark,
                metalness: 0.92,
                roughness: 0.25,
            });
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(sign.position.x, h + signH * 0.25, sign.position.z);
            buildings.add(pole);
        }
        this.scene.add(buildings);
        return buildings;
    }

    /** 加载GLB/GLTF模型 */
    loadModel(url) {
        return new Promise((resolve, reject) => {
            this._showLoading();

            if (!window.GLTFLoader) {
                this._showError('GLTFLoader未加载，无法解析模型文件');
                reject(new Error('GLTFLoader未加载'));
                return;
            }

            const loader = new window.GLTFLoader();

            loader.load(
                url,
                (gltf) => {
                    // 移除旧模型
                    if (this.model) {
                        this.scene.remove(this.model);
                    }

                    this.model = gltf.scene;

                    // 自动缩放和居中
                    const box = new THREE.Box3().setFromObject(this.model);
                    const size = box.getSize(new THREE.Vector3());
                    const center = box.getCenter(new THREE.Vector3());
                    const maxDim = Math.max(size.x, size.y, size.z);
                    const scale = maxDim > 0 ? 3 / maxDim : 1;
                    this.model.scale.setScalar(scale);

                    // 居中
                    const scaledBox = new THREE.Box3().setFromObject(this.model);
                    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
                    this.model.position.sub(scaledCenter);
                    this.model.position.y += scaledBox.getSize(new THREE.Vector3()).y / 2;

                    // 开启阴影 & PBR材质优化（关闭HDR环境光映射，使用纯物理光照）
                    this.model.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });

                    this.scene.add(this.model);

                    // 调整相机
                    const modelHeight = scaledBox.getSize(new THREE.Vector3()).y;
                    if (this.controls) {
                        this.controls.target.set(0, modelHeight / 2, 0);
                    }
                    this.camera.position.set(5, 3, 5);

                    // 动画
                    if (gltf.animations && gltf.animations.length > 0) {
                        this.mixer = new THREE.AnimationMixer(this.model);
                        gltf.animations.forEach(clip => {
                            this.mixer.clipAction(clip).play();
                        });
                    }

                    this._hideLoading();
                    resolve(this.model);
                },
                (progress) => {
                    if (progress.total > 0) {
                        const pct = Math.round(progress.loaded / progress.total * 100);
                        this._updateLoading(pct);
                    }
                },
                (error) => {
                    console.error('[3D] 模型加载失败:', url, error);
                    this._showError('3D模型加载失败，资源缺失或文件损坏');
                    reject(error);
                }
            );
        });
    }

    /** 加载占位飞机模型（无GLB时显示） */
    loadPlaceholder() {
        if (this.model) this.scene.remove(this.model);

        const group = new THREE.Group();

        // 机身
        const bodyGeo = new THREE.CylinderGeometry(0.3, 0.15, 4, 32);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x4488cc,
            metalness: 0.7,
            roughness: 0.3
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.rotation.z = Math.PI / 2;
        body.castShadow = true;
        group.add(body);

        // 机头
        const noseGeo = new THREE.ConeGeometry(0.3, 1, 32);
        const nose = new THREE.Mesh(noseGeo, bodyMat);
        nose.rotation.z = -Math.PI / 2;
        nose.position.x = 2.5;
        nose.castShadow = true;
        group.add(nose);

        // 主翼
        const wingGeo = new THREE.BoxGeometry(1.5, 0.05, 5);
        const wingMat = new THREE.MeshStandardMaterial({
            color: 0x336699,
            metalness: 0.6,
            roughness: 0.4
        });
        const wing = new THREE.Mesh(wingGeo, wingMat);
        wing.castShadow = true;
        group.add(wing);

        // 尾翼
        const tailGeo = new THREE.BoxGeometry(0.6, 0.05, 1.8);
        const tail = new THREE.Mesh(tailGeo, wingMat);
        tail.position.set(-1.8, 0, 0);
        tail.castShadow = true;
        group.add(tail);

        // 垂尾
        const vtailGeo = new THREE.BoxGeometry(0.6, 1.2, 0.05);
        const vtail = new THREE.Mesh(vtailGeo, wingMat);
        vtail.position.set(-1.8, 0.6, 0);
        vtail.castShadow = true;
        group.add(vtail);

        group.position.y = 1.5;
        this.model = group;
        this.scene.add(group);
        this._hideLoading();
    }

    /** 切换线框/实体模式 */
    toggleWireframe() {
        if (!this.model) return;
        this.isWireframe = !this.isWireframe;
        this.model.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.wireframe = this.isWireframe;
            }
        });
        return this.isWireframe;
    }

    /** 重置视角 */
    resetCamera() {
        this.camera.position.set(5, 3, 5);
        if (this.controls) {
            this.controls.target.set(0, 1, 0);
            this.controls.update();
        }
    }

    /** 切换自动旋转 */
    toggleAutoRotate() {
        if (this.controls) {
            this.controls.autoRotate = !this.controls.autoRotate;
            return this.controls.autoRotate;
        }
        return false;
    }

    /** 销毁释放资源 */
    dispose() {
        // 停止动画循环
        if (this._animId) {
            cancelAnimationFrame(this._animId);
            this._animId = null;
        }

        // 移除resize监听
        if (this._onResize) {
            window.removeEventListener('resize', this._onResize);
            this._onResize = null;
        }

        // 销毁模型
        if (this.model) {
            this.model.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                }
            });
            this.scene.remove(this.model);
            this.model = null;
        }

        // 销毁mixer
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }

        // 销毁控制器
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }

        // 销毁渲染器
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();
            this.renderer.domElement = null;
            this.renderer = null;
        }

        // 清空场景
        if (this.scene) {
            this.scene.clear();
            this.scene = null;
        }

        this.camera = null;
        this.clock = null;
    }

    // ===== 内部方法 =====

    _animate() {
        this._animId = requestAnimationFrame(() => this._animate());
        if (!this.renderer || !this.scene || !this.camera) return;
        const delta = this.clock ? this.clock.getDelta() : 0;
        if (this.mixer) this.mixer.update(delta);
        if (this.controls) this.controls.update();

        // ================================================
        //  🆕 地面灯光规律闪烁动画（仅左右两侧，禁飞通道无灯）
        // ================================================
        // 原理：遍历场景中所有标记 isGroundLight=true 的 mesh，
        //       根据 type/group 施加不同的 emissiveIntensity 周期波形
        if (this.scene) {
            const now = performance.now() / 1000;  // 秒级时间戳

            /**
             * 平滑插值器：从当前值渐变到目标值
             * 避免 emissiveIntensity 突变产生频闪刺眼问题
             */
            const lerpFactor = 0.08;  // 平滑速率（每帧8%趋近目标）

            this.scene.traverse(function (child) {
                if (!child.isMesh || !child.userData || !child.userData.isGroundLight) return;
                if (!child.material || typeof child.material.emissiveIntensity !== 'number') return;

                const ud = child.userData;
                const baseIntensity = ud.originalIntensity || child.material.emissiveIntensity;
                let targetIntensity = baseIntensity;

                if (ud.type === 'strip') {
                    // ======= 线性灯带：3秒周期 =======
                    // 0.0~1.0s: 完全亮起 (bright=1.0)
                    // 1.0~1.5s: 缓慢变暗 (bright=1.0→0.05)
                    // 1.5~2.0s: 熄灭 (bright=0.05)
                    // 2.0~3.0s: 缓慢亮起 (bright=0.05→1.0)
                    const T = 3.0;
                    const phase = (now % T);  // 0~3秒循环
                    let bright = 1.0;

                    if (phase < 1.0) {
                        bright = 1.0;
                    } else if (phase < 1.5) {
                        // 0.5秒内从1.0渐变到0.55
                        const t = (phase - 1.0) / 0.5;
                        bright = 1.0 - t * 0.45;
                    } else if (phase < 2.0) {
                        bright = 0.55;
                    } else {
                        // 1.0秒从0.55渐变回1.0
                        const t = (phase - 2.0) / 1.0;
                        bright = 0.55 + t * 0.45;
                    }
                    targetIntensity = baseIntensity * Math.max(0.55, bright);

                } else if (ud.type === 'dot' || ud.type === 'halo') {
                    // ======= 点状地灯/光晕：分组错开相位 =======
                    // A组：亮2秒, 暗1秒 (周期3秒)
                    // B组：暗2秒, 亮1秒 (周期3秒) —— 与A组完全互补
                    const T = 3.0;
                    const phase = (now % T);
                    const isGroupA = (ud.group === 'A');
                    const isOn = isGroupA
                        ? (phase < 2.0)   // A组前2秒亮
                        : (phase >= 2.0);  // B组最后一秒亮

                    targetIntensity = isOn ? baseIntensity : baseIntensity * 0.60;
                }

                // 平滑过渡：从当前 emissiveIntensity 插值到目标值
                if (typeof child.material.emissiveIntensity === 'number') {
                    child.material.emissiveIntensity +=
                        (targetIntensity - child.material.emissiveIntensity) * lerpFactor;
                }
            });
        }

        this.renderer.render(this.scene, this.camera);
    }

    _showLoading() {
        const el = document.getElementById('viewer-loading');
        if (el) el.style.display = 'flex';
    }

    _updateLoading(pct) {
        const el = document.getElementById('viewer-progress');
        if (el) el.textContent = pct + '%';
        const bar = document.getElementById('viewer-progress-bar');
        if (bar) bar.style.width = pct + '%';
    }

    _hideLoading() {
        const el = document.getElementById('viewer-loading');
        if (el) el.style.display = 'none';
    }

    _showError(msg) {
        this._hideLoading();
        show3DError(msg);
    }
}

/**
 * generateCyberCity()
 * 赛博朋克城市建筑群 — 精细化升级版
 * 左右分区各7栋（共14栋），中部飞行通道禁建
 * 建筑高度维持现有设定不变，全面提升几何细节与材质层次
 * @returns {THREE.Group} 楼房群组
 */
function generateCyberCity() {
    console.log("✅ 进入赛博城市生成函数，开始精细化创建楼房");
    try {
        if (!window.THREE) return null;

        const THREE = window.THREE;
        const buildingsGroup = new THREE.Group();
        buildingsGroup.name = 'cyber-city-buildings';

        // ======================== 分区参数（加宽禁建空白通道） ========================
        // 左侧区域：X < -10，远离飞机跑道与飞行通道
        const LEFT_ZONE = { minX: -22, maxX: -10 };
        // 右侧区域：X > 10，远离飞机跑道与飞行通道
        const RIGHT_ZONE = { minX: 10, maxX: 22 };
        // 拓宽Z轴生成区间：-42~+34，让飞行全程（标尺-40m~起飞端）两侧均有城市覆盖
        const MIN_Z = -42, MAX_Z = 34;
        const BUILDING_COUNT_PER_SIDE = 12;
        const HEIGHT_SCALE = 0.55;
        // 闪烁广告牌收集器（供动画系统注册使用）
        const flickerSigns = [];
        // 街道车流光轨网格收集器
        const trafficMeshes = [];
        // 空中巡航灯收集器
        const skyTrafficLights = [];

        // ======================== 材质体系（三层分级） ========================
        // ---- 第一层：墙体材质（镜面金属反光，冷调银灰金属质感） ----
        // envMapIntensity：环境贴图反射强度（沙盒场景挂了程序化夜景 envMap，金属靠它反射出银色光泽）
        const matWallDarkGray = new THREE.MeshStandardMaterial({
            color: 0xbcc6cc, metalness: 0.85, roughness: 0.10, envMapIntensity: 1.0
        });
        const matWallLightGray = new THREE.MeshStandardMaterial({
            color: 0xcdd5db, metalness: 0.85, roughness: 0.10, envMapIntensity: 1.0
        });
        const wallMats = [matWallDarkGray, matWallLightGray];
        // 凹凸面板色差材质（与主墙体形成对比，镜面金属）
        const matWallInset = new THREE.MeshStandardMaterial({
            color: 0xa0adb8, metalness: 0.85, roughness: 0.10, envMapIntensity: 1.0
        });
        const matWallPanel = new THREE.MeshStandardMaterial({
            color: 0xb0bcc6, metalness: 0.85, roughness: 0.10, envMapIntensity: 1.0
        });
        // 幕墙网格分格线颜色（深色细边框，暗银灰金属线，独立于墙体反光材质）
        const GRID_LINE_COLOR = 0x4a4a4a;
        /** 为box网格添加幕墙分格线（深色细边框） */
        function addGridLines(boxMesh, w, h, d) {
            const edgesGeo = new THREE.EdgesGeometry(boxMesh.geometry);
            const lineMat = new THREE.LineBasicMaterial({ color: GRID_LINE_COLOR, transparent: true, opacity: 0.65 });
            const lineSegments = new THREE.LineSegments(edgesGeo, lineMat);
            lineSegments.renderOrder = 1;
            lineSegments.material.depthTest = true;
            lineSegments.material.depthWrite = false;
            boxMesh.add(lineSegments);
        }

        // ---- 第二层：金属构件材质（浅灰金属，低粗糙，高金属度） ----
        const matMetalGray = new THREE.MeshStandardMaterial({
            color: 0x889099, metalness: 0.88, roughness: 0.22, envMapIntensity: 0.9
        });
        // 🆕 暗色金属构件材质（改为中等灰银反光金属，避免纯黑涂黑）
        const matMetalDark = new THREE.MeshStandardMaterial({
            color: 0x6a6e78, metalness: 0.92, roughness: 0.18, envMapIntensity: 0.9
        });
        const matMetalAccent = new THREE.MeshStandardMaterial({
            color: 0x556070, metalness: 0.85, roughness: 0.25, envMapIntensity: 0.9
        });

        // ---- 第三层：自发光霓虹材质（保留PBR自发光效果） ----
        // 🆕 窗格双色材质体系：暖白 / 粉紫，各分亮暗两级
        const matWinWarmBright = new THREE.MeshStandardMaterial({
            color: 0xfff5cc, emissive: 0xffcc88, emissiveIntensity: 2.4,
            metalness: 0.05, roughness: 0.10
        });
        const matWinWarmDim = new THREE.MeshStandardMaterial({
            color: 0xffeebb, emissive: 0xffaa66, emissiveIntensity: 1.4,
            metalness: 0.05, roughness: 0.14
        });
        const matWinPurpleBright = new THREE.MeshStandardMaterial({
            color: 0xff88cc, emissive: 0xff44aa, emissiveIntensity: 2.6,
            metalness: 0.05, roughness: 0.10
        });
        const matWinPurpleDim = new THREE.MeshStandardMaterial({
            color: 0xffaaee, emissive: 0xff66bb, emissiveIntensity: 1.3,
            metalness: 0.05, roughness: 0.14
        });
        const matNeonPink = new THREE.MeshStandardMaterial({
            color: 0xff1493, emissive: 0xff1493, emissiveIntensity: 3.5,
            metalness: 0.05, roughness: 0.10
        });
        const matNeonCyan = new THREE.MeshStandardMaterial({
            color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 3.5,
            metalness: 0.05, roughness: 0.10
        });
        const matNeonWarm = new THREE.MeshStandardMaterial({
            color: 0xffdd88, emissive: 0xff9944, emissiveIntensity: 2.2,
            metalness: 0.05, roughness: 0.12
        });
        const matNeonPinkDim = new THREE.MeshStandardMaterial({
            color: 0xff69b4, emissive: 0xff1493, emissiveIntensity: 1.8,
            metalness: 0.05, roughness: 0.15
        });
        const matNeonCyanDim = new THREE.MeshStandardMaterial({
            color: 0x88ddff, emissive: 0x00ccff, emissiveIntensity: 1.8,
            metalness: 0.05, roughness: 0.15
        });
        // 灯带层级材质：主灯带高亮 / 辅灯带微亮
        const matStripeMain = new THREE.MeshStandardMaterial({
            color: 0xffdd88, emissive: 0xffaa44, emissiveIntensity: 3.0,
            metalness: 0.05, roughness: 0.10
        });
        const matStripeAux = new THREE.MeshStandardMaterial({
            color: 0xeeddcc, emissive: 0xcc9966, emissiveIntensity: 1.5,
            metalness: 0.06, roughness: 0.16
        });
        // 广告牌强光材质
        const matBillboardPink = new THREE.MeshStandardMaterial({
            color: 0xff1493, emissive: 0xff1493, emissiveIntensity: 4.0,
            metalness: 0.10, roughness: 0.06
        });
        const matBillboardCyan = new THREE.MeshStandardMaterial({
            color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 4.0,
            metalness: 0.10, roughness: 0.06
        });

        // ======================== 工具函数 ========================
        const rand = (min, max) => min + Math.random() * (max - min);
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        /** 创建Box辅助：便捷生成带阴影的Box，自动添加幕墙网格分格线 */
        function createBox(w, h, d, mat) {
            const geo = new THREE.BoxGeometry(w, h, d);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            // 自动添加幕墙网格分格线（深色细边框）
            addGridLines(mesh, w, h, d);
            return mesh;
        }
        /** 创建圆柱辅助 */
        function createCylinder(rTop, rBot, h, mat) {
            const geo = new THREE.CylinderGeometry(rTop, rBot, h, 8);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            return mesh;
        }

        // ======================== 单栋建筑精细化生成 ========================
        function spawnBuildingsInZone(zone, sideLabel) {
            const zoneWidth = zone.maxX - zone.minX;
            const layers = [
                zone.minX + zoneWidth * 0.15,
                zone.minX + zoneWidth * 0.50,
                zone.minX + zoneWidth * 0.85
            ];

            for (let i = 0; i < BUILDING_COUNT_PER_SIDE; i++) {
                const buildingGroup = new THREE.Group();
                buildingGroup.name = sideLabel + '-building-' + (i + 1);

                // 建筑风格变体 & 霓虹色系
                const archType = i % 4;                                    // 0~3 四种建筑造型
                const usePink = (sideLabel === '左侧' ? i : i + BUILDING_COUNT_PER_SIDE) % 2 === 0;

                // 🔷 两栋楼区分高低体型：主楼瘦高竖长 / 副楼宽矮分层
                const isTallSlim = (archType === 0 || archType === 1);      // 主楼：瘦高竖长
                const isWideLow = (archType === 2 || archType === 3);      // 副楼：宽矮分层
                const height = isTallSlim
                    ? rand(18, 30) * HEIGHT_SCALE                           // 主楼更高
                    : rand(6, 14) * HEIGHT_SCALE;                            // 副楼较矮
                const width = isTallSlim
                    ? rand(1.4, 2.4)                                         // 主楼瘦窄
                    : rand(2.8, 4.5);                                        // 副楼宽体
                const depth = isTallSlim
                    ? rand(1.4, 2.4)
                    : rand(2.8, 4.5);
                const halfW = width / 2, halfD = depth / 2;

                // 世界坐标（Z轴分格随机，避免楼体重叠）
                const baseX = layers[i % 3];
                const worldX = baseX + rand(-1.8, 1.8);
                const slotLen = (MAX_Z - MIN_Z) / BUILDING_COUNT_PER_SIDE;
                const worldZ = MIN_Z + (i + rand(0.15, 0.85)) * slotLen;

                // ========== 【超大飞行禁建区强制过滤】 ==========
                // 以飞机模型为中心，飞机朝向跑道的整条前进视线通道全部禁止造楼
                // X轴：-10 ~ +10（飞机左右两侧各留10米隔离带）
                // Z轴：-10 ~ +30（从飞机脚下一直延伸到远处标尺跑道前方，整片开阔地带清空）
                // 只要建筑坐标落在该矩形区域，直接跳过不生成，杜绝任何楼房挡在飞行路线正前方
                const FLIGHT_CORRIDOR_X_MIN = -10, FLIGHT_CORRIDOR_X_MAX = 10;
                const RUNWAY_ZONE_Z_MIN = -10, RUNWAY_ZONE_Z_MAX = 30;
                if (worldX >= FLIGHT_CORRIDOR_X_MIN && worldX <= FLIGHT_CORRIDOR_X_MAX &&
                    worldZ >= RUNWAY_ZONE_Z_MIN && worldZ <= RUNWAY_ZONE_Z_MAX) {
                    console.warn(`🚫 ${sideLabel}楼房 #${i + 1} 坐标(${worldX.toFixed(2)}, ${worldZ.toFixed(2)}) 落入超大飞行禁建区，已跳过`);
                    continue;
                }

                console.log(`🏗️ ${sideLabel}楼房 #${i + 1}: 坐标(${worldX.toFixed(2)}, ${(height / 2).toFixed(2)}, ${worldZ.toFixed(2)}), 高度=${height.toFixed(1)}m`);

                const neonMat = usePink ? matNeonPink : matNeonCyan;
                const neonMatDim = usePink ? matNeonPinkDim : matNeonCyanDim;
                const billMat = usePink ? matBillboardCyan : matBillboardPink; // 屋顶广告牌颜色与灯带互补

                // ========== 【1. 建筑结构分层细化】多层错落分体结构 ==========
                // 🆕 墙体凹槽+转角切角+镂空断墙+分段收窄/加宽+边角立柱

                // 1a. 底部加厚方形基座（宽矮平台，加厚比例，带四角斜切装饰）
                const podiumH = height * rand(0.12, 0.20);
                const podiumW = width * rand(1.05, 1.15);
                const podiumD = depth * rand(1.05, 1.15);
                const podium = createBox(podiumW, podiumH, podiumD, wallMats[i % 2]);
                podium.position.set(0, podiumH / 2, 0);
                buildingGroup.add(podium);
                // 基座四角斜切块
                const chamferSize = podiumH * 0.55;
                for (let cc = 0; cc < 4; cc++) {
                    const cxSign = cc % 2 === 0 ? 1 : -1;
                    const czSign = cc < 2 ? 1 : -1;
                    const cfGeo = new THREE.BoxGeometry(chamferSize, podiumH * 0.80, chamferSize);
                    const cf = new THREE.Mesh(cfGeo, matMetalAccent);
                    cf.position.set(cxSign * (podiumW / 2 - chamferSize * 0.35), podiumH * 0.55, czSign * (podiumD / 2 - chamferSize * 0.35));
                    buildingGroup.add(cf);
                }

                // 1b. 主塔 — 下段宽、上段窄（收窄变化） + 四角立柱
                const mainW = width * rand(0.50, 0.70);
                const mainD = depth * rand(0.50, 0.70);
                const mainH = height * rand(0.75, 0.95);
                const mainXoff = rand(-halfW * 0.30, halfW * 0.30);
                const mainZoff = rand(-halfD * 0.25, halfD * 0.25);
                // 上下段分割
                const lowerH = mainH * rand(0.50, 0.65);
                const upperH = mainH - lowerH;
                const upperNarrow = rand(0.70, 0.88);
                const upperW = mainW * upperNarrow;
                const upperD = mainD * upperNarrow;
                // 下段（宽）
                const lowerTower = createBox(mainW, lowerH, mainD, wallMats[(i + 1) % 2]);
                lowerTower.position.set(mainXoff, podiumH + lowerH / 2, mainZoff);
                buildingGroup.add(lowerTower);
                // 上段（窄，向内收进）
                const upperTower = createBox(upperW, upperH, upperD, matWallInset);
                upperTower.position.set(mainXoff, podiumH + lowerH + upperH / 2, mainZoff);
                buildingGroup.add(upperTower);
                // 下段四角立柱
                for (let pil = 0; pil < 4; pil++) {
                    const pxSign = pil % 2 === 0 ? 1 : -1;
                    const pzSign = pil < 2 ? 1 : -1;
                    const pilW = rand(0.08, 0.15);
                    const pilD = rand(0.08, 0.15);
                    const pilH = lowerH * rand(0.85, 0.98);
                    const pilGeo = new THREE.BoxGeometry(pilW, pilH, pilD);
                    const pillar = new THREE.Mesh(pilGeo, matMetalAccent);
                    pillar.position.set(mainXoff + pxSign * (mainW / 2 + pilW * 0.3), podiumH + pilH / 2, mainZoff + pzSign * (mainD / 2 + pilD * 0.3));
                    buildingGroup.add(pillar);
                }
                // 侧边薄墙延伸
                if (archType !== 2) {
                    const extCount = Math.floor(rand(1, 3));
                    for (let ex = 0; ex < extCount; ex++) {
                        const extW = rand(0.04, 0.10);
                        const extH = mainH * rand(0.35, 0.65);
                        const extD = mainD * rand(0.60, 0.95);
                        const extSide = rand(0, 1) > 0.5 ? 1 : -1;
                        const extGeo = new THREE.BoxGeometry(extW, extH, extD);
                        const extWall = new THREE.Mesh(extGeo, matWallPanel);
                        extWall.position.set(mainXoff + extSide * (mainW / 2 + extW / 2), podiumH + mainH * rand(0.25, 0.65), mainZoff);
                        buildingGroup.add(extWall);
                    }
                }
                // 附属小型墙体
                if (rand(0, 1) > 0.45) {
                    const auxW = mainW * rand(0.15, 0.30);
                    const auxH = mainH * rand(0.30, 0.55);
                    const auxD = mainD * rand(0.10, 0.22);
                    const auxSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const aux = createBox(auxW, auxH, auxD, matWallInset);
                    aux.position.set(mainXoff + auxSide * (mainW / 2 + auxW / 2 + rand(0.02, 0.10)), podiumH + mainH * rand(0.30, 0.60), mainZoff + rand(-mainD * 0.20, mainD * 0.20));
                    buildingGroup.add(aux);
                }

                // 🔷 外立面细密网格分格线（幕墙框架）
                // 在四个立面绘制细密横向+竖直线条，将整面墙体划分为均等小方格
                // 幕墙分格线：深色细线独立材质，不混入墙体银灰反光主色
                const gridLineMat = new THREE.MeshStandardMaterial({
                    color: 0x4a4a4a, metalness: 0.0, roughness: 0.70
                });
                const gridFaces = [
                    { axis: 'z', side: 1, lenA: mainW, lenB: mainH, cx: mainXoff, cz: mainZoff + mainD / 2 },
                    { axis: 'z', side: -1, lenA: mainW, lenB: mainH, cx: mainXoff, cz: mainZoff - mainD / 2 },
                    { axis: 'x', side: 1, lenA: mainD, lenB: mainH, cx: mainXoff + mainW / 2, cz: mainZoff },
                    { axis: 'x', side: -1, lenA: mainD, lenB: mainH, cx: mainXoff - mainW / 2, cz: mainZoff }
                ];
                const gridCellSize = rand(0.18, 0.35); // 小方格边长
                const gridLineThick = rand(0.012, 0.022);
                const gridLineDepth = rand(0.04, 0.08);

                for (const gf of gridFaces) {
                    const faceLen = gf.lenA;
                    const faceH = gf.lenB;
                    const vertLines = Math.floor(faceLen / gridCellSize);
                    const horzLines = Math.floor(faceH / gridCellSize);

                    // 竖线（沿面宽方向均匀分布）
                    for (let vl = 0; vl <= vertLines; vl++) {
                        const vx = -faceLen / 2 + vl * gridCellSize;
                        const vLineGeo = new THREE.BoxGeometry(gridLineThick, faceH * 0.96, gridLineDepth);
                        const vLine = new THREE.Mesh(vLineGeo, gridLineMat);
                        if (gf.axis === 'z') {
                            vLine.position.set(gf.cx + vx, podiumH + faceH / 2, gf.cz);
                        } else {
                            vLine.position.set(gf.cx, podiumH + faceH / 2, gf.cz + vx);
                        }
                        buildingGroup.add(vLine);
                    }
                    // 横线（沿面高方向均匀分布）
                    for (let hl = 0; hl <= horzLines; hl++) {
                        const hy = podiumH + hl * gridCellSize;
                        if (hy > podiumH + faceH * 0.98) continue;
                        const hLineGeo = new THREE.BoxGeometry(faceLen * 0.96, gridLineThick, gridLineDepth);
                        const hLine = new THREE.Mesh(hLineGeo, gridLineMat);
                        if (gf.axis === 'z') {
                            hLine.position.set(gf.cx, hy, gf.cz);
                        } else {
                            hLine.rotation.y = Math.PI / 2;
                            hLine.position.set(gf.cx, hy, gf.cz);
                        }
                        buildingGroup.add(hLine);
                    }
                }

                // 🔷 楼顶粉色发光平顶方块（还原参考图楼顶发光造型）
                const flatTopW = upperW * rand(0.55, 0.75);
                const flatTopD = upperD * rand(0.55, 0.75);
                const flatTopH = rand(0.10, 0.22);
                const flatTopMat = new THREE.MeshStandardMaterial({
                    color: 0xff3388, emissive: 0xff1166, emissiveIntensity: 3.8,
                    metalness: 0.08, roughness: 0.12
                });
                const flatTop = createBox(flatTopW, flatTopH, flatTopD, flatTopMat);
                flatTop.position.set(mainXoff + rand(-0.08, 0.08), podiumH + mainH + flatTopH / 2, mainZoff + rand(-0.08, 0.08));
                buildingGroup.add(flatTop);
                // 平顶边角发光小方块（粉色强化轮廓）
                for (let ftc = 0; ftc < 4; ftc++) {
                    const ftcXSign = ftc % 2 === 0 ? 1 : -1;
                    const ftcZSign = ftc < 2 ? 1 : -1;
                    const ftcW = rand(0.06, 0.12);
                    const ftcH = rand(0.04, 0.08);
                    const ftcGeo = new THREE.BoxGeometry(ftcW, ftcH, ftcW);
                    const ftcBlock = new THREE.Mesh(ftcGeo, flatTopMat);
                    ftcBlock.position.set(
                        mainXoff + ftcXSign * (flatTopW / 2 - ftcW * 0.4),
                        podiumH + mainH + flatTopH + ftcH / 2,
                        mainZoff + ftcZSign * (flatTopD / 2 - ftcW * 0.4)
                    );
                    buildingGroup.add(ftcBlock);
                }

                // 1c. 退台屋顶 + 错落平台第二层
                const setbackW = upperW * rand(0.65, 0.85);
                const setbackD = upperD * rand(0.65, 0.85);
                const setbackH = height * rand(0.06, 0.14);
                const setback = createBox(setbackW, setbackH, setbackD, matWallPanel);
                setback.position.set(mainXoff + rand(-0.10, 0.10), podiumH + mainH + setbackH / 2, mainZoff + rand(-0.10, 0.10));
                buildingGroup.add(setback);
                // 第二层错落平台
                if (archType !== 0) {
                    const plat2W = setbackW * rand(0.40, 0.65);
                    const plat2D = setbackD * rand(0.40, 0.65);
                    const plat2H = setbackH * rand(0.80, 1.30);
                    const plat2 = createBox(plat2W, plat2H, plat2D, matWallInset);
                    plat2.position.set(mainXoff + rand(-0.12, 0.12), podiumH + mainH + setbackH + plat2H / 2, mainZoff + rand(-0.12, 0.12));
                    buildingGroup.add(plat2);
                }
                // 🆕 屋顶矮围边
                const parapetCount = Math.floor(rand(2, 4));
                const roofTopY = podiumH + mainH + setbackH;
                for (let pp = 0; pp < parapetCount; pp++) {
                    const paraLen = setbackW * rand(0.40, 0.70);
                    const paraH = rand(0.04, 0.10);
                    const paraD = rand(0.04, 0.08);
                    const paraGeo = new THREE.BoxGeometry(paraLen, paraH, paraD);
                    const para = new THREE.Mesh(paraGeo, matMetalDark);
                    const ppSide = pp % 2 === 0 ? 1 : -1;
                    const ppFace = Math.floor(pp / 2) % 2;
                    if (ppFace === 0) {
                        para.position.set(mainXoff + rand(-setbackW * 0.28, setbackW * 0.28), roofTopY + paraH / 2, mainZoff + ppSide * (setbackD / 2));
                    } else {
                        para.rotation.y = Math.PI / 2;
                        para.position.set(mainXoff + ppSide * (setbackW / 2), roofTopY + paraH / 2, mainZoff + rand(-setbackD * 0.28, setbackD * 0.28));
                    }
                    buildingGroup.add(para);
                }
                // 🆕 屋顶设备方块
                const equipCount = Math.floor(rand(3, 7));
                for (let eq = 0; eq < equipCount; eq++) {
                    const eqW = rand(0.06, 0.18);
                    const eqH = rand(0.08, 0.22);
                    const eqD = rand(0.06, 0.18);
                    const eqGeo = new THREE.BoxGeometry(eqW, eqH, eqD);
                    const eqMesh = new THREE.Mesh(eqGeo, eq % 2 === 0 ? matMetalDark : matMetalGray);
                    eqMesh.position.set(mainXoff + rand(-setbackW * 0.38, setbackW * 0.38), roofTopY + eqH / 2 + rand(0, 0.06), mainZoff + rand(-setbackD * 0.38, setbackD * 0.38));
                    buildingGroup.add(eqMesh);
                }
                // 🆕 屋顶边角斜切造型
                for (let bc = 0; bc < 4; bc++) {
                    const bxSign = bc % 2 === 0 ? 1 : -1;
                    const bzSign = bc < 2 ? 1 : -1;
                    const bevW = rand(0.10, 0.22);
                    const bevH = rand(0.10, 0.20);
                    const bevD = rand(0.10, 0.22);
                    const bevGeo = new THREE.BoxGeometry(bevW, bevH, bevD);
                    const bev = new THREE.Mesh(bevGeo, matMetalAccent);
                    if (bc >= 2) bev.rotation.y = Math.PI / 2;
                    bev.position.set(mainXoff + bxSign * (setbackW / 2 - bevW * 0.4), roofTopY + bevH / 2, mainZoff + bzSign * (setbackD / 2 - bevD * 0.4));
                    buildingGroup.add(bev);
                }

                // 1d. 副楼（矮体块，贴附主塔一侧，带边角立柱）
                const subW = width * rand(0.25, 0.40);
                const subD = depth * rand(0.30, 0.50);
                const subH = mainH * rand(0.40, 0.65);
                const subSide = rand(0, 1) > 0.5 ? 1 : -1;
                const subXoff = mainXoff + subSide * (mainW / 2 + subW / 2 - rand(0.05, 0.20));
                const subZoff = mainZoff + rand(-mainD * 0.20, mainD * 0.20);
                const subTower = createBox(subW, subH, subD, wallMats[(i + 1) % 2]);
                subTower.position.set(subXoff, podiumH + subH / 2, subZoff);
                buildingGroup.add(subTower);
                // 副楼角柱
                if (rand(0, 1) > 0.5) {
                    for (let sp = 0; sp < 2; sp++) {
                        const spXSign = sp === 0 ? 1 : -1;
                        const spPilGeo = new THREE.BoxGeometry(rand(0.06, 0.12), subH * rand(0.80, 0.95), rand(0.06, 0.12));
                        const spPillar = new THREE.Mesh(spPilGeo, matMetalAccent);
                        spPillar.position.set(subXoff + spXSign * (subW / 2 + 0.04), podiumH + subH * 0.45, subZoff);
                        buildingGroup.add(spPillar);
                    }
                }

                // 1e. 外挑设备平台
                const platW = mainW * rand(0.30, 0.50);
                const platD = rand(0.10, 0.22);
                const platH = rand(0.06, 0.12);
                const platY = podiumH + mainH * rand(0.45, 0.75);
                const platSide = rand(0, 1) > 0.5 ? 1 : -1;
                const plat = createBox(platW, platH, platD, matMetalGray);
                plat.position.set(mainXoff + platSide * (mainW / 2 + platD / 2), platY, mainZoff);
                buildingGroup.add(plat);

                // 1f. 突出机房/通风管道
                const ventCount = Math.floor(rand(2, 4));
                for (let v = 0; v < ventCount; v++) {
                    const ventW = rand(0.08, 0.20);
                    const ventD = rand(0.08, 0.20);
                    const ventH = rand(0.15, 0.40);
                    const vent = createBox(ventW, ventH, ventD, matMetalDark);
                    vent.position.set(mainXoff + rand(-mainW * 0.30, mainW * 0.30), roofTopY + ventH / 2 + rand(0, 0.05), mainZoff + rand(-mainD * 0.30, mainD * 0.30));
                    buildingGroup.add(vent);
                }
                for (let p = 0; p < Math.floor(rand(1, 3)); p++) {
                    const pipeR = rand(0.03, 0.07);
                    const pipeH = rand(0.20, 0.60);
                    const pipe = createCylinder(pipeR, pipeR, pipeH, matMetalDark);
                    pipe.position.set(mainXoff + rand(-mainW * 0.35, mainW * 0.35), roofTopY + pipeH / 2, mainZoff + rand(-mainD * 0.35, mainD * 0.35));
                    buildingGroup.add(pipe);
                }

                // ========== 【2. 墙体凹槽、镂空与转角切角】 ==========
                // 2a. 纵向内凹凹槽（深浅不一）
                const grooveCount = Math.floor(rand(3, 7));
                for (let g = 0; g < grooveCount; g++) {
                    const gDepth = rand(0.04, 0.12);
                    const gW = rand(0.04, 0.10);
                    const gH = mainH * rand(0.50, 0.92);
                    const gY = podiumH + mainH * rand(0.06, 0.45);
                    const gSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const gGeo = new THREE.BoxGeometry(gW, gH, gDepth);
                    const gMesh = new THREE.Mesh(gGeo, matMetalDark);
                    gMesh.position.set(mainXoff + rand(-mainW * 0.38, mainW * 0.38), gY + gH / 2, mainZoff + gSide * (mainD / 2 - gDepth * 0.45));
                    buildingGroup.add(gMesh);
                    if (rand(0, 1) > 0.55) {
                        const innerGeo = new THREE.BoxGeometry(gW * 0.6, gH * 0.85, 0.015);
                        const innerStrip = new THREE.Mesh(innerGeo, neonMatDim);
                        innerStrip.position.set(gMesh.position.x, gMesh.position.y, mainZoff + gSide * (mainD / 2 - gDepth * 0.08));
                        buildingGroup.add(innerStrip);
                    }
                }
                // 2b. 横向凹槽
                const hGrooveCount = Math.floor(rand(2, 5));
                for (let hg = 0; hg < hGrooveCount; hg++) {
                    const hgDepth = rand(0.03, 0.08);
                    const hgH = rand(0.03, 0.07);
                    const hgLen = mainW * rand(0.55, 0.90);
                    const hgY = podiumH + mainH * rand(0.15, 0.85);
                    const hgSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const hgGeo = new THREE.BoxGeometry(hgLen, hgH, hgDepth);
                    const hgMesh = new THREE.Mesh(hgGeo, matMetalDark);
                    hgMesh.position.set(mainXoff, hgY, mainZoff + hgSide * (mainD / 2 - hgDepth * 0.45));
                    buildingGroup.add(hgMesh);
                }
                // 2c. 局部镂空断墙
                if (archType % 3 !== 1) {
                    const gapCount = Math.floor(rand(1, 3));
                    for (let gap = 0; gap < gapCount; gap++) {
                        const gapW = mainW * rand(0.15, 0.35);
                        const gapH = mainH * rand(0.08, 0.18);
                        const gapY = podiumH + mainH * rand(0.35, 0.75);
                        const gapSide = rand(0, 1) > 0.5 ? 1 : -1;
                        const gapGeo = new THREE.BoxGeometry(gapW, gapH, 0.02);
                        const gapMesh = new THREE.Mesh(gapGeo, matMetalDark);
                        gapMesh.position.set(mainXoff + rand(-mainW * 0.25, mainW * 0.25), gapY, mainZoff + gapSide * (mainD / 2 + 0.01));
                        buildingGroup.add(gapMesh);
                    }
                }
                // 2d. 转角切角装饰块
                for (let cc2 = 0; cc2 < 4; cc2++) {
                    if (rand(0, 1) > 0.4) continue;
                    const cx2Sign = cc2 % 2 === 0 ? 1 : -1;
                    const cz2Sign = cc2 < 2 ? 1 : -1;
                    const cutW = rand(0.10, 0.20);
                    const cutD = rand(0.10, 0.20);
                    const cutH = mainH * rand(0.30, 0.55);
                    const cutY = podiumH + mainH * rand(0.08, 0.45);
                    const cutGeo = new THREE.BoxGeometry(cutW, cutH, cutD);
                    const cut = new THREE.Mesh(cutGeo, matMetalAccent);
                    cut.position.set(mainXoff + cx2Sign * (mainW / 2 + cutW * 0.35), cutY + cutH / 2, mainZoff + cz2Sign * (mainD / 2 + cutD * 0.35));
                    buildingGroup.add(cut);
                }

                // ========== 【2e. 转角斜切倒角与圆弧切边】 ==========
                // 2e-1. 斜切倒角板（45°旋转的薄板覆盖直角边）
                const bevelCount = Math.floor(rand(4, 8));
                for (let bv = 0; bv < bevelCount; bv++) {
                    const bvSide = bv % 4; // 0:前右 1:前左 2:后右 3:后左
                    const bxSign = bvSide % 2 === 0 ? 1 : -1;
                    const bzSign = bvSide < 2 ? 1 : -1;
                    const bvW = rand(0.08, 0.18);
                    const bvH = mainH * rand(0.20, 0.60);
                    const bvY = podiumH + mainH * rand(0.08, 0.55);
                    const bvGeo = new THREE.BoxGeometry(bvW, bvH, 0.025);
                    const bvMesh = new THREE.Mesh(bvGeo, matMetalGray);
                    bvMesh.rotation.y = Math.PI / 4;
                    bvMesh.position.set(
                        mainXoff + bxSign * (mainW / 2 + bvW * 0.4),
                        bvY + bvH / 2,
                        mainZoff + bzSign * (mainD / 2 + bvW * 0.3)
                    );
                    buildingGroup.add(bvMesh);
                }
                // 2e-2. 圆弧切边（短圆柱贴合墙体转角模拟圆角）
                for (let rc = 0; rc < 4; rc++) {
                    if (rand(0, 1) > 0.55) continue;
                    const rxSign = rc % 2 === 0 ? 1 : -1;
                    const rzSign = rc < 2 ? 1 : -1;
                    const rRadius = rand(0.04, 0.09);
                    const rH = mainH * rand(0.40, 0.75);
                    const rY = podiumH + mainH * rand(0.10, 0.45);
                    const rGeo = new THREE.CylinderGeometry(rRadius, rRadius, rH, 8);
                    const rMesh = new THREE.Mesh(rGeo, matMetalDark);
                    rMesh.position.set(
                        mainXoff + rxSign * (mainW / 2),
                        rY + rH / 2,
                        mainZoff + rzSign * (mainD / 2)
                    );
                    buildingGroup.add(rMesh);
                }

                // ========== 【2f. 外凸墙板 + 内嵌凹墙穿插搭配】 ==========
                // 2f-1. 小幅外凸墙板
                const protCount = Math.floor(rand(2, 5));
                for (let pt = 0; pt < protCount; pt++) {
                    const ptW = mainW * rand(0.18, 0.35);
                    const ptH = mainH * rand(0.25, 0.50);
                    const ptD = rand(0.04, 0.10);
                    const ptY = podiumH + mainH * rand(0.08, 0.55);
                    const ptSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const ptGeo = new THREE.BoxGeometry(ptW, ptH, ptD);
                    const ptMesh = new THREE.Mesh(ptGeo, matWallPanel);
                    ptMesh.position.set(
                        mainXoff + rand(-mainW * 0.28, mainW * 0.28),
                        ptY + ptH / 2,
                        mainZoff + ptSide * (mainD / 2 + ptD / 2)
                    );
                    buildingGroup.add(ptMesh);
                }
                // 2f-2. 内嵌凹墙（向内收缩的墙面区块）
                const insetCount = Math.floor(rand(2, 4));
                for (let ins = 0; ins < insetCount; ins++) {
                    const insW = mainW * rand(0.15, 0.30);
                    const insH = mainH * rand(0.30, 0.55);
                    const insDepth = rand(0.05, 0.12);
                    const insY = podiumH + mainH * rand(0.12, 0.55);
                    const insSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const insGeo = new THREE.BoxGeometry(insW, insH, insDepth);
                    const insMesh = new THREE.Mesh(insGeo, matWallInset);
                    insMesh.position.set(
                        mainXoff + rand(-mainW * 0.28, mainW * 0.28),
                        insY + insH / 2,
                        mainZoff + insSide * (mainD / 2 - insDepth / 2)
                    );
                    buildingGroup.add(insMesh);
                    // 凹墙内小型凹龛（暗色小方块嵌入）
                    const nCount = Math.floor(rand(1, 3));
                    for (let nc = 0; nc < nCount; nc++) {
                        const nGeo = new THREE.BoxGeometry(insW * rand(0.25, 0.45), rand(0.06, 0.14), 0.015);
                        const nMesh = new THREE.Mesh(nGeo, matMetalDark);
                        nMesh.position.set(
                            insMesh.position.x + rand(-insW * 0.25, insW * 0.25),
                            insY + insH * rand(0.15, 0.78),
                            mainZoff + insSide * (mainD / 2 - insDepth - 0.005)
                        );
                        buildingGroup.add(nMesh);
                    }
                }

                // ========== 【2g. 竖向薄隔断竖棱 + 横向楼层分割腰线】 ==========
                // 2g-1. 竖向薄隔断竖棱（将大墙面分割为独立小墙面区块）
                const ribCount = Math.floor(rand(4, 9));
                for (let rb = 0; rb < ribCount; rb++) {
                    const ribW = rand(0.03, 0.07);
                    const ribH = mainH * rand(0.55, 0.95);
                    const ribY = podiumH + mainH * rand(0.03, 0.25);
                    const ribDepth = rand(0.06, 0.14);
                    const ribSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const ribGeo = new THREE.BoxGeometry(ribW, ribH, ribDepth);
                    const rib = new THREE.Mesh(ribGeo, matMetalAccent);
                    rib.position.set(
                        mainXoff + rand(-mainW * 0.42, mainW * 0.42),
                        ribY + ribH / 2,
                        mainZoff + ribSide * (mainD / 2 + ribDepth / 2)
                    );
                    buildingGroup.add(rib);
                    // 侧面竖棱（正交面）
                    if (rand(0, 1) > 0.45) {
                        const ribSideGeo = new THREE.BoxGeometry(ribDepth, ribH, ribW);
                        const ribSideMesh = new THREE.Mesh(ribSideGeo, matMetalAccent);
                        ribSideMesh.position.set(
                            mainXoff + ribSide * (mainW / 2 + ribDepth / 2),
                            ribY + ribH / 2,
                            mainZoff + rand(-mainD * 0.42, mainD * 0.42)
                        );
                        buildingGroup.add(ribSideMesh);
                    }
                }
                // 2g-2. 横向楼层分割腰线
                const beltCount = Math.floor(rand(3, 7));
                for (let bl = 0; bl < beltCount; bl++) {
                    const beltLen = mainW * rand(0.85, 1.15);
                    const beltH = rand(0.03, 0.06);
                    const beltDepth = rand(0.05, 0.10);
                    const beltY = podiumH + mainH * (bl / beltCount) + rand(-0.03, 0.03);
                    // 正面腰线
                    const beltGeoF = new THREE.BoxGeometry(beltLen, beltH, beltDepth);
                    const beltF = new THREE.Mesh(beltGeoF, matMetalGray);
                    beltF.position.set(mainXoff, beltY, mainZoff + mainD / 2 + beltDepth / 2);
                    buildingGroup.add(beltF);
                    // 背面腰线
                    if (rand(0, 1) > 0.35) {
                        const beltB = new THREE.Mesh(beltGeoF, matMetalGray);
                        beltB.position.set(mainXoff, beltY, mainZoff - mainD / 2 - beltDepth / 2);
                        buildingGroup.add(beltB);
                    }
                    // 侧面腰线
                    if (archType % 3 !== 1) {
                        const beltGeoS = new THREE.BoxGeometry(beltDepth, beltH, mainD * rand(0.85, 1.10));
                        const beltS = new THREE.Mesh(beltGeoS, matMetalGray);
                        beltS.position.set(mainXoff + (rand(0, 1) > 0.5 ? 1 : -1) * (mainW / 2 + beltDepth / 2), beltY, mainZoff);
                        buildingGroup.add(beltS);
                    }
                }

                // ========== 【2h. 墙面区块内凹槽缝隙 + 窄长镂空缝 + 小型凹龛】 ==========
                // 2h-1. 窄长条镂空缝（竖向细缝）
                const slitCount = Math.floor(rand(3, 8));
                const slitGeoThin = new THREE.BoxGeometry(0.02, 1, 0.02);
                for (let sl = 0; sl < slitCount; sl++) {
                    const slitH = mainH * rand(0.30, 0.70);
                    const slitY = podiumH + mainH * rand(0.05, 0.45);
                    const slitSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const slitGeo = new THREE.BoxGeometry(0.025, slitH, 0.015);
                    const slit = new THREE.Mesh(slitGeo, matMetalDark);
                    slit.position.set(
                        mainXoff + rand(-mainW * 0.40, mainW * 0.40),
                        slitY + slitH / 2,
                        mainZoff + slitSide * (mainD / 2 - 0.02)
                    );
                    buildingGroup.add(slit);
                }
                // 2h-2. 墙面区块内深浅凹槽缝隙（在腰线/竖棱划分的区块内）
                const panelGrooveCount = Math.floor(rand(5, 12));
                for (let pg = 0; pg < panelGrooveCount; pg++) {
                    const pgLen = rand(0.08, 0.28);
                    const pgH = rand(0.015, 0.04);
                    const pgDepth = rand(0.02, 0.06);
                    const pgY = podiumH + mainH * rand(0.06, 0.90);
                    const pgSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const pgGeo = new THREE.BoxGeometry(pgLen, pgH, pgDepth);
                    const pgMesh = new THREE.Mesh(pgGeo, matMetalDark);
                    pgMesh.position.set(
                        mainXoff + rand(-mainW * 0.40, mainW * 0.40),
                        pgY,
                        mainZoff + pgSide * (mainD / 2 - pgDepth * 0.45)
                    );
                    buildingGroup.add(pgMesh);
                }
                // 2h-3. 小型凹龛（墙面内的小型方形凹陷 - 已在上文2f-2处理，此处补充独立凹龛）
                const alcoveCount = Math.floor(rand(2, 5));
                for (let al = 0; al < alcoveCount; al++) {
                    const alW = rand(0.06, 0.16);
                    const alH = rand(0.08, 0.20);
                    const alDepth = rand(0.03, 0.06);
                    const alY = podiumH + mainH * rand(0.10, 0.82);
                    const alSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const alGeo = new THREE.BoxGeometry(alW, alH, alDepth);
                    const alMesh = new THREE.Mesh(alGeo, matMetalDark);
                    alMesh.position.set(
                        mainXoff + rand(-mainW * 0.38, mainW * 0.38),
                        alY + alH / 2,
                        mainZoff + alSide * (mainD / 2 - alDepth / 2)
                    );
                    buildingGroup.add(alMesh);
                }
                // 2h-4. 墙面区块间十字交叉缝（竖棱与腰线交汇处加深缝）
                const crossCount = Math.floor(rand(2, 4));
                for (let cr = 0; cr < crossCount; cr++) {
                    const crX = mainXoff + rand(-mainW * 0.35, mainW * 0.35);
                    const crY = podiumH + mainH * rand(0.15, 0.80);
                    const crSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const crGeoH = new THREE.BoxGeometry(rand(0.06, 0.14), 0.02, 0.02);
                    const crH = new THREE.Mesh(crGeoH, matMetalDark);
                    crH.position.set(crX, crY, mainZoff + crSide * (mainD / 2 - 0.03));
                    buildingGroup.add(crH);
                    const crGeoV = new THREE.BoxGeometry(0.02, rand(0.06, 0.14), 0.02);
                    const crV = new THREE.Mesh(crGeoV, matMetalDark);
                    crV.position.set(crX, crY, mainZoff + crSide * (mainD / 2 - 0.03));
                    buildingGroup.add(crV);
                }

                // ========== 【3. 阳台与凹凸立面】 ==========
                const balcCount = clamp(Math.floor(height / 1.5), 2, 6);
                for (let b = 0; b < balcCount; b++) {
                    const balcW = rand(0.25, 0.55);
                    const balcD = rand(0.08, 0.18);
                    const balcH = rand(0.04, 0.08);
                    const balcY = podiumH + rand(0.15, mainH - 0.20);
                    const bFront = createBox(balcW * (mainW / width), balcH, balcD, matMetalGray);
                    bFront.position.set(mainXoff + rand(-mainW * 0.30, mainW * 0.30), balcY, mainZoff + mainD / 2 + balcD / 2);
                    buildingGroup.add(bFront);
                    if (rand(0, 1) > 0.4) {
                        const bBack = createBox(balcW * (mainW / width), balcH, balcD, matMetalGray);
                        bBack.position.set(mainXoff + rand(-mainW * 0.30, mainW * 0.30), balcY, mainZoff - mainD / 2 - balcD / 2);
                        buildingGroup.add(bBack);
                    }
                    if (archType % 2 === 0) {
                        const bSide = createBox(balcD, balcH, balcW * (mainD / depth), matMetalGray);
                        bSide.position.set(mainXoff + halfW + balcD / 2, balcY, mainZoff + rand(-mainD * 0.30, mainD * 0.30));
                        buildingGroup.add(bSide);
                    }
                }

                // ========== 【两栋楼差异化造型补充】archType驱动 ==========
                const isCompactVertical = (archType === 0 || archType === 1);
                if (isCompactVertical) {
                    // 🔷 紧凑竖高错落型：竖向叠加模块 + 屋顶尖塔天线
                    // 额外竖向脊线（细长条，贴附主塔侧面强化竖向感）
                    const spineCount = Math.floor(rand(3, 6));
                    for (let sp = 0; sp < spineCount; sp++) {
                        const spineW = rand(0.04, 0.08);
                        const spineH = mainH * rand(0.75, 0.98);
                        const spineDepth = rand(0.03, 0.06);
                        const spineY = podiumH + mainH * rand(0.01, 0.12);
                        const spineSide = rand(0, 1) > 0.5 ? 1 : -1;
                        const spineGeo = new THREE.BoxGeometry(spineW, spineH, spineDepth);
                        const spine = new THREE.Mesh(spineGeo, matMetalAccent);
                        spine.position.set(mainXoff + rand(-mainW * 0.40, mainW * 0.40), spineY + spineH / 2, mainZoff + spineSide * (mainD / 2 + spineDepth / 2));
                        buildingGroup.add(spine);
                    }
                    // 屋顶尖塔天线（细高圆柱 + 顶端小球）
                    const antennaR = rand(0.04, 0.08);
                    const antennaH = rand(0.80, 2.5);
                    const antennaGeo = new THREE.CylinderGeometry(antennaR, antennaR * 1.3, antennaH, 8);
                    const antenna = new THREE.Mesh(antennaGeo, matMetalDark);
                    antenna.position.set(mainXoff + rand(-0.10, 0.10), roofTopY + antennaH / 2, mainZoff + rand(-0.10, 0.10));
                    buildingGroup.add(antenna);
                    // 天线顶端发光球
                    const tipGeo = new THREE.SphereGeometry(antennaR * 1.6, 8, 6);
                    const tip = new THREE.Mesh(tipGeo, billMat);
                    tip.position.set(antenna.position.x, roofTopY + antennaH, antenna.position.z);
                    buildingGroup.add(tip);
                    // 次级竖向堆叠模块（小型方块叠叠乐）
                    const stackCount = Math.floor(rand(3, 6));
                    for (let stk = 0; stk < stackCount; stk++) {
                        const stkW = upperW * rand(0.25, 0.45);
                        const stkD = upperD * rand(0.25, 0.45);
                        const stkH = rand(0.10, 0.28);
                        const stkGeo = new THREE.BoxGeometry(stkW, stkH, stkD);
                        const stkMesh = new THREE.Mesh(stkGeo, matWallPanel);
                        stkMesh.position.set(mainXoff + rand(-0.12, 0.12), roofTopY + setbackH + stkH / 2 + stk * stkH, mainZoff + rand(-0.12, 0.12));
                        buildingGroup.add(stkMesh);
                    }
                } else {
                    // 🔶 宽体分层悬挑型：加宽基座 + 大型悬挑平台 + 多层悬檐
                    // 底座外扩平台
                    const extPodiumW = width * rand(1.05, 1.25);
                    const extPodiumD = depth * rand(1.05, 1.25);
                    const extPodiumH = podiumH * rand(0.70, 1.10);
                    const extPodium = createBox(extPodiumW, extPodiumH, extPodiumD, matWallInset);
                    extPodium.position.set(0, extPodiumH / 2, 0);
                    buildingGroup.add(extPodium);
                    // 多层悬挑平台（每层向外延伸，逐层缩进）
                    const cantLayers = Math.floor(rand(3, 5));
                    for (let cl = 0; cl < cantLayers; cl++) {
                        const clY = podiumH + mainH * ((cl + 1) / (cantLayers + 1));
                        const clW = mainW * (1.15 - cl * 0.12);
                        const clD = mainD * (1.15 - cl * 0.12);
                        const clH = rand(0.04, 0.09);
                        const clGeo = new THREE.BoxGeometry(clW, clH, clD);
                        const clMesh = new THREE.Mesh(clGeo, matMetalGray);
                        clMesh.position.set(mainXoff, clY, mainZoff);
                        buildingGroup.add(clMesh);
                        // 悬挑平台下方斜撑支架
                        if (cl > 0) {
                            const braceW = rand(0.04, 0.07);
                            const braceH = clH * rand(1.5, 3.0);
                            for (let br = 0; br < 4; br++) {
                                const brXSign = br % 2 === 0 ? 1 : -1;
                                const brZSign = br < 2 ? 1 : -1;
                                const braceGeo = new THREE.BoxGeometry(braceW, braceH, braceW);
                                const brace = new THREE.Mesh(braceGeo, matMetalDark);
                                brace.position.set(mainXoff + brXSign * (clW / 2 - braceW), clY - braceH / 2 - clH / 2, mainZoff + brZSign * (clD / 2 - braceW));
                                buildingGroup.add(brace);
                            }
                        }
                    }
                    // 侧边悬檐翼板（主塔侧面外挑薄板）
                    const eavesCount = Math.floor(rand(2, 5));
                    for (let ev = 0; ev < eavesCount; ev++) {
                        const evY = podiumH + mainH * rand(0.30, 0.80);
                        const evLen = mainD * rand(0.70, 1.10);
                        const evW = rand(0.15, 0.35);
                        const evH = rand(0.03, 0.06);
                        const evSide = rand(0, 1) > 0.5 ? 1 : -1;
                        const evGeo = new THREE.BoxGeometry(evW, evH, evLen);
                        const evMesh = new THREE.Mesh(evGeo, matMetalGray);
                        evMesh.position.set(mainXoff + evSide * (mainW / 2 + evW / 2), evY, mainZoff);
                        buildingGroup.add(evMesh);
                    }
                    // 屋顶宽体飞檐（大跨度薄板覆盖顶部）
                    const eaveWideW = setbackW * rand(1.10, 1.35);
                    const eaveWideD = setbackD * rand(1.10, 1.35);
                    const eaveWideH = rand(0.04, 0.08);
                    const eaveWide = createBox(eaveWideW, eaveWideH, eaveWideD, matMetalGray);
                    eaveWide.position.set(mainXoff, roofTopY + eaveWideH / 2, mainZoff);
                    buildingGroup.add(eaveWide);
                }

                // ========== 【3. 丰富霓虹发光细节】 ==========

                // 3a. 竖向灯带（原有样式，增强为四个面 + 部分嵌入凹槽）
                const vertCount = clamp(Math.floor(mainH / 2.0), 2, 8);
                for (let s = 0; s < vertCount; s++) {
                    const stripH = mainH * rand(0.35, 0.92);
                    const stripGeoV = new THREE.BoxGeometry(0.06, stripH, 0.02);
                    const recessed = rand(0, 1) > 0.65; // 部分灯带半嵌入（向内偏移）

                    // 正面
                    const sf = new THREE.Mesh(stripGeoV, neonMat);
                    sf.position.set(mainXoff + rand(-mainW / 2 + 0.20, mainW / 2 - 0.20),
                        podiumH + rand(stripH / 2, mainH - stripH / 2),
                        mainZoff + mainD / 2 + (recessed ? -0.03 : 0.02));
                    buildingGroup.add(sf);
                    // 背面
                    const sb = new THREE.Mesh(stripGeoV, neonMat);
                    sb.position.set(mainXoff + rand(-mainW / 2 + 0.20, mainW / 2 - 0.20),
                        podiumH + rand(stripH / 2, mainH - stripH / 2),
                        mainZoff - mainD / 2 - (recessed ? -0.03 : 0.02));
                    buildingGroup.add(sb);
                    // 侧面（用侧向geometry）
                    const sideGeoV = new THREE.BoxGeometry(0.02, stripH, 0.06);
                    const sl = new THREE.Mesh(sideGeoV, neonMat);
                    sl.position.set(mainXoff - mainW / 2 - (recessed ? -0.03 : 0.02),
                        podiumH + rand(stripH / 2, mainH - stripH / 2),
                        mainZoff + rand(-mainD / 2 + 0.20, mainD / 2 - 0.20));
                    buildingGroup.add(sl);
                    const sr = new THREE.Mesh(sideGeoV, neonMat);
                    sr.position.set(mainXoff + mainW / 2 + (recessed ? -0.03 : 0.02),
                        podiumH + rand(stripH / 2, mainH - stripH / 2),
                        mainZoff + rand(-mainD / 2 + 0.20, mainD / 2 - 0.20));
                    buildingGroup.add(sr);
                }

                // 3b. 横向霓虹灯带（新增大类）
                const horzCount = clamp(Math.floor(mainH / 2.5), 1, 5);
                for (let hh = 0; hh < horzCount; hh++) {
                    const stripLen = rand(0.30, 0.75) * mainW;
                    const stripGeoH = new THREE.BoxGeometry(stripLen, 0.06, 0.02);
                    const hY = podiumH + mainH * rand(0.20, 0.85);
                    // 正面主塔
                    const hf = new THREE.Mesh(stripGeoH, neonMatDim);
                    hf.position.set(mainXoff + rand(-0.20, 0.20), hY, mainZoff + mainD / 2 + 0.02);
                    buildingGroup.add(hf);
                    // 背面主塔
                    if (rand(0, 1) > 0.4) {
                        const hb = new THREE.Mesh(stripGeoH, neonMatDim);
                        hb.position.set(mainXoff + rand(-0.20, 0.20), hY, mainZoff - mainD / 2 - 0.02);
                        buildingGroup.add(hb);
                    }
                    // 副楼正面
                    const subLen = rand(0.30, 0.65) * subW;
                    const subGeoH = new THREE.BoxGeometry(subLen, 0.06, 0.02);
                    const shf = new THREE.Mesh(subGeoH, neonMatDim);
                    shf.position.set(subXoff, podiumH + subH * rand(0.25, 0.80), subZoff + subD / 2 + 0.02);
                    buildingGroup.add(shf);
                }

                // 3c. 🆕 窗洞系统：方形亮窗 + 长条竖窗，沿竖向轴线错落穿插，暖白/淡粉双色调，内嵌凹槽+边框

                // 材质：暖白亮窗 / 淡粉窗（两种发光色调，错落穿插，不统一全亮）
                const matWinWarmWhite = new THREE.MeshStandardMaterial({
                    color: 0xfff5e0, emissive: 0xffddaa, emissiveIntensity: 2.2,
                    metalness: 0.05, roughness: 0.10
                });
                const matWinSoftPink = new THREE.MeshStandardMaterial({
                    color: 0xffccee, emissive: 0xff88cc, emissiveIntensity: 2.0,
                    metalness: 0.05, roughness: 0.10
                });
                // 内嵌凹槽暗色材质
                const matRecess = new THREE.MeshStandardMaterial({
                    color: 0x4a4a5a, metalness: 0.40, roughness: 0.60,
                    emissive: 0x2a2a35, emissiveIntensity: 0.12
                });
                // 细微边框材质（深灰金属微反光）
                const matFrameFine = new THREE.MeshStandardMaterial({
                    color: 0x3a3a4a, metalness: 0.0, roughness: 0.70
                });

                const faces = [
                    { axis: 'z', side: 1, lenA: mainW, lenB: mainH, cx: mainXoff, cz: mainZoff + mainD / 2, depthOff: 0.04 },
                    { axis: 'z', side: -1, lenA: mainW, lenB: mainH, cx: mainXoff, cz: mainZoff - mainD / 2, depthOff: -0.04 },
                    { axis: 'x', side: 1, lenA: mainD, lenB: mainH, cx: mainXoff + mainW / 2, cz: mainZoff, depthOff: 0.04 },
                    { axis: 'x', side: -1, lenA: mainD, lenB: mainH, cx: mainXoff - mainW / 2, cz: mainZoff, depthOff: -0.04 }
                ];

                for (const face of faces) {
                    const faceLen = face.lenA;
                    const faceH = face.lenB;
                    // 竖向轴线：沿面宽方向均匀分布 4~8 条轴线
                    const colCount = Math.floor(rand(4, 8));
                    const colSpacing = faceLen / colCount;
                    // 每列轴线上的窗户排数
                    const rowsPerCol = Math.floor(rand(3, 7));

                    // 随机标记 1~3 个空白幕墙区域（整段完全不排窗）
                    const blankZoneCount = Math.floor(rand(1, 3));
                    const blankZones = [];
                    for (let bz = 0; bz < blankZoneCount; bz++) {
                        blankZones.push({
                            yStart: podiumH + rand(0, faceH * 0.55),
                            yEnd: 0 // 将在下面计算
                        });
                        blankZones[bz].yEnd = blankZones[bz].yStart + rand(0.15, 0.35) * faceH;
                    }

                    for (let col = 0; col < colCount; col++) {
                        const colX = -faceLen / 2 + col * colSpacing + rand(-colSpacing * 0.15, colSpacing * 0.15);
                        // 该列的色调倾向（暖白或淡粉为主，但允许个别窗混搭）
                        const colIsWarm = rand(0, 1) > 0.5;

                        for (let r = 0; r < rowsPerCol; r++) {
                            const wy = podiumH + faceH * 0.06 + (r / (rowsPerCol - 1 || 1)) * faceH * 0.82 + rand(-0.06, 0.06);

                            // 检查是否落入空白幕墙区域
                            let inBlank = false;
                            for (const bz of blankZones) {
                                if (wy > bz.yStart && wy < bz.yEnd) { inBlank = true; break; }
                            }
                            if (inBlank) continue; // 空白幕墙区域，不排窗

                            // 窗洞类型：方形亮窗 或 长条竖窗（约 55% 方窗 / 45% 竖窗）
                            const isSquare = rand(0, 1) > 0.45;
                            let winW, winH;
                            if (isSquare) {
                                // 方形亮窗
                                winW = rand(0.10, 0.22);
                                winH = rand(0.10, 0.22);
                            } else {
                                // 长条竖窗
                                winW = rand(0.04, 0.08);
                                winH = rand(0.16, 0.32);
                            }

                            // 错落微调：同一列中相邻窗微微偏移X
                            const offsetX = colX + rand(-0.03, 0.03);

                            // 计算世界坐标
                            let worldX, worldZ;
                            if (face.axis === 'z') {
                                worldX = face.cx + offsetX;
                                worldZ = face.cz;
                            } else {
                                worldX = face.cz;
                                worldZ = face.cx + offsetX;
                            }

                            // ===== 内嵌凹槽结构（暗色深槽，比窗户稍大） =====
                            const recessW = winW + rand(0.016, 0.030);
                            const recessH = winH + rand(0.016, 0.030);
                            const recessDepth = rand(0.025, 0.045);
                            const recessGeo = new THREE.BoxGeometry(recessW, recessH, recessDepth);
                            const recess = new THREE.Mesh(recessGeo, matRecess);
                            recess.position.set(worldX, wy, worldZ + face.depthOff * 0.3);
                            buildingGroup.add(recess);

                            // ===== 窗户发光体（暖白/淡粉双色调，错落穿插） =====
                            const winGeo = new THREE.BoxGeometry(winW, winH, 0.015);
                            // 列主色调为主，但约35%概率混搭异色
                            const useWarm = (rand(0, 1) > 0.65) ? !colIsWarm : colIsWarm;
                            const winMat = useWarm ? matWinWarmWhite : matWinSoftPink;
                            const winMesh = new THREE.Mesh(winGeo, winMat);
                            winMesh.position.set(worldX, wy, worldZ + face.depthOff * 0.55);
                            buildingGroup.add(winMesh);

                            // ===== 细微边框轮廓（4条细杆围合，边框材质 matFrameFine） =====
                            const frameThick = rand(0.006, 0.010);
                            const frameDepth = 0.018;
                            const fTop = new THREE.Mesh(
                                new THREE.BoxGeometry(winW + frameThick * 2, frameThick, frameDepth),
                                matFrameFine
                            );
                            fTop.position.set(worldX, wy + winH / 2 + frameThick / 2, worldZ + face.depthOff * 0.65);
                            buildingGroup.add(fTop);
                            const fBot = new THREE.Mesh(
                                new THREE.BoxGeometry(winW + frameThick * 2, frameThick, frameDepth),
                                matFrameFine
                            );
                            fBot.position.set(worldX, wy - winH / 2 - frameThick / 2, worldZ + face.depthOff * 0.65);
                            buildingGroup.add(fBot);
                            const fLeft = new THREE.Mesh(
                                new THREE.BoxGeometry(frameThick, winH, frameDepth),
                                matFrameFine
                            );
                            fLeft.position.set(worldX - winW / 2 - frameThick / 2, wy, worldZ + face.depthOff * 0.65);
                            buildingGroup.add(fLeft);
                            const fRight = new THREE.Mesh(
                                new THREE.BoxGeometry(frameThick, winH, frameDepth),
                                matFrameFine
                            );
                            fRight.position.set(worldX + winW / 2 + frameThick / 2, wy, worldZ + face.depthOff * 0.65);
                            buildingGroup.add(fRight);

                            // 窗下沿短灯带（部分窗搭配，概率约40%）
                            if (rand(0, 1) > 0.60) {
                                const stripGeo = new THREE.BoxGeometry(winW * rand(0.70, 0.95), 0.010, 0.020);
                                const strip = new THREE.Mesh(stripGeo, matNeonWarm);
                                strip.position.set(worldX, wy - winH / 2 - 0.012, worldZ + face.depthOff * 0.60);
                                buildingGroup.add(strip);
                            }
                        } // end rows per column
                    } // end columns
                } // end faces loop

                // 3d. 屋顶发光模块（粉色/青色发光方块排列于屋顶边缘）
                const roofEdgeCount = Math.floor(rand(3, 7));
                for (let re = 0; re < roofEdgeCount; re++) {
                    const modGeo = new THREE.BoxGeometry(rand(0.08, 0.18), rand(0.06, 0.12), rand(0.08, 0.18));
                    const rMod = new THREE.Mesh(modGeo, billMat);
                    rMod.position.set(
                        mainXoff + rand(-mainW * 0.40, mainW * 0.40),
                        podiumH + mainH + setbackH + rand(0.05, 0.15),
                        mainZoff + rand(-mainD * 0.40, mainD * 0.40)
                    );
                    buildingGroup.add(rMod);
                }

                // 3e. 小型点状氛围灯（零散分布在建筑凹槽/边缘，适度减量保持精致）
                const dotCount = Math.floor(rand(5, 12));
                const dotGeo = new THREE.SphereGeometry(0.025, 4, 3);
                for (let dd = 0; dd < dotCount; dd++) {
                    const dot = new THREE.Mesh(dotGeo, rand(0, 1) > 0.5 ? matNeonWarm : neonMatDim);
                    dot.position.set(
                        mainXoff + rand(-mainW * 0.45, mainW * 0.45),
                        podiumH + rand(0.10, mainH + setbackH + 0.10),
                        mainZoff + (rand(0, 1) > 0.5 ? 1 : -1) * (mainD / 2 + rand(0.01, 0.08))
                    );
                    buildingGroup.add(dot);
                }

                // 3f. 🆕 墙面穿插斜向/竖向/短横霓虹灯带（错落布置，不扎堆）
                const stripeFaces4 = ['+X', '-X', '+Z', '-Z'];
                const totalStripes = Math.floor(rand(6, 14));
                for (let stp = 0; stp < totalStripes; stp++) {
                    const sFace = stripeFaces4[stp % 4];
                    let sx, sz, sBaseX, sBaseZ, sNormalX, sNormalZ;
                    const sLen = rand(0.30, 1.00);
                    const sH = rand(0.015, 0.03);
                    const sDepth = rand(0.03, 0.06);
                    const sY = podiumH + mainH * rand(0.05, 0.88);
                    // 随机选择朝向
                    if (sFace === '+Z') { sBaseX = mainXoff; sBaseZ = mainZoff + mainD / 2; sNormalX = 0; sNormalZ = sDepth; }
                    else if (sFace === '-Z') { sBaseX = mainXoff; sBaseZ = mainZoff - mainD / 2; sNormalX = 0; sNormalZ = -sDepth; }
                    else if (sFace === '+X') { sBaseX = mainXoff + mainW / 2; sBaseZ = mainZoff; sNormalX = sDepth; sNormalZ = 0; }
                    else { sBaseX = mainXoff - mainW / 2; sBaseZ = mainZoff; sNormalX = -sDepth; sNormalZ = 0; }
                    // 灯带角度：斜向(rotateZ) / 竖向 / 横向随机
                    const orientRoll = rand(0, 1);
                    let stripeGeo, rotZ = 0, offsetX = 0, offsetZ = 0;
                    if (orientRoll < 0.35) {
                        // 斜向灯带：长条绕Z轴旋转 30°~60°
                        stripeGeo = new THREE.BoxGeometry(sLen, sH, 0.012);
                        rotZ = rand(-60, 60) * Math.PI / 180;
                    } else if (orientRoll < 0.70) {
                        // 竖向细灯带：窄高
                        stripeGeo = new THREE.BoxGeometry(0.015, sLen, 0.012);
                        offsetX = 0; offsetZ = 0;
                    } else {
                        // 短横灯带：扁平横条
                        const shortLen = rand(0.15, 0.45);
                        stripeGeo = new THREE.BoxGeometry(shortLen, sH, 0.012);
                    }
                    // 灯带层级：主灯带高亮 / 辅灯带微亮
                    const isMainStripe = rand(0, 1) > 0.55;
                    const stripeColor = isMainStripe ? matStripeMain : matStripeAux;
                    const stripe = new THREE.Mesh(stripeGeo, stripeColor);
                    stripe.position.set(
                        sBaseX + sNormalX + rand(-mainW * 0.38, mainW * 0.38),
                        sY,
                        sBaseZ + sNormalZ + rand(-mainD * 0.38, mainD * 0.38)
                    );
                    if (orientRoll < 0.35) stripe.rotation.z = rotZ;
                    buildingGroup.add(stripe);
                }

                // 3g. 🆕 微型发光小方块 + 长条发光缝隙灯 + 墙角地脚灯带
                // 3g-1. 微型发光小方块（散点分布，不扎堆）
                const microGlowCount = Math.floor(rand(8, 16));
                const microGeo = new THREE.BoxGeometry(0.025, 0.025, 0.02);
                for (let mg = 0; mg < microGlowCount; mg++) {
                    const mgMesh = new THREE.Mesh(microGeo, rand(0, 1) > 0.5 ? billMat : matNeonWarm);
                    mgMesh.position.set(
                        mainXoff + rand(-mainW * 0.46, mainW * 0.46),
                        podiumH + mainH * rand(0.04, 0.92),
                        mainZoff + (rand(0, 1) > 0.5 ? 1 : -1) * (mainD / 2 + rand(0.005, 0.05))
                    );
                    buildingGroup.add(mgMesh);
                }
                // 3g-2. 长条发光缝隙灯（细长发光嵌入缝）
                const seamLightCount = Math.floor(rand(3, 8));
                for (let sm = 0; sm < seamLightCount; sm++) {
                    const seamLen = rand(0.18, 0.55);
                    const seamGeo = new THREE.BoxGeometry(seamLen, 0.008, 0.015);
                    const seam = new THREE.Mesh(seamGeo, matNeonWarm);
                    seam.position.set(
                        mainXoff + rand(-mainW * 0.42, mainW * 0.42),
                        podiumH + mainH * rand(0.08, 0.85),
                        mainZoff + (rand(0, 1) > 0.5 ? 1 : -1) * (mainD / 2 + 0.005)
                    );
                    buildingGroup.add(seam);
                }
                // 3g-3. 墙角地脚灯带（沿底部四边敷设的细灯条）
                const baseY = podiumH + rand(0.02, 0.08);
                for (let bl = 0; bl < 4; bl++) {
                    const bxSign = bl % 2 === 0 ? 1 : -1;
                    const bzSign = bl < 2 ? 1 : -1;
                    const baseLen = (bl % 2 === 0) ? mainW * rand(0.70, 0.95) : mainD * rand(0.70, 0.95);
                    const baseGeo = new THREE.BoxGeometry(baseLen, 0.012, 0.03);
                    const baseLight = new THREE.Mesh(baseGeo, matNeonWarm);
                    if (bl % 2 === 0) {
                        baseLight.position.set(mainXoff, baseY, mainZoff + bzSign * (mainD / 2 + 0.015));
                    } else {
                        baseLight.rotation.y = Math.PI / 2;
                        baseLight.position.set(mainXoff + bxSign * (mainW / 2 + 0.015), baseY, mainZoff);
                    }
                    buildingGroup.add(baseLight);
                }

                // ========== 【4. 赛博朋克装饰构件】 ==========

                // 4a. 外置金属支架（L形/十字形边角加强筋）
                const bracketCount = Math.floor(rand(3, 6));
                for (let bk = 0; bk < bracketCount; bk++) {
                    const brH = rand(0.30, 0.80) * mainH;
                    const brGeo = new THREE.BoxGeometry(0.04, brH, 0.04);
                    const bracket = new THREE.Mesh(brGeo, matMetalAccent);
                    // 放置在主塔四个角落外围
                    const cornerX = mainXoff + (rand(0, 1) > 0.5 ? 1 : -1) * (mainW / 2 + 0.02);
                    const cornerZ = mainZoff + (rand(0, 1) > 0.5 ? 1 : -1) * (mainD / 2 + 0.02);
                    bracket.position.set(cornerX, podiumH + brH / 2, cornerZ);
                    buildingGroup.add(bracket);
                }

                // 4b. 横向管线（圆柱形管道沿建筑侧面敷设）
                const pipeCount = Math.floor(rand(2, 5));
                for (let pp = 0; pp < pipeCount; pp++) {
                    const pipeLen = rand(0.40, 0.90) * mainW;
                    const pipeR = rand(0.02, 0.05);
                    const pipeGeoH = new THREE.CylinderGeometry(pipeR, pipeR, pipeLen, 6);
                    const pipeMesh = new THREE.Mesh(pipeGeoH, matMetalDark);
                    pipeMesh.rotation.z = Math.PI / 2;  // 水平放置
                    pipeMesh.position.set(
                        mainXoff + rand(-0.15, 0.15),
                        podiumH + mainH * rand(0.30, 0.80),
                        mainZoff + (rand(0, 1) > 0.5 ? 1 : -1) * (mainD / 2 + 0.03)
                    );
                    buildingGroup.add(pipeMesh);
                }

                // 4c. 外挂机箱（小型金属箱体附着于立面）
                const cabinetCount = Math.floor(rand(1, 4));
                for (let cb = 0; cb < cabinetCount; cb++) {
                    const cabGeo = new THREE.BoxGeometry(rand(0.10, 0.22), rand(0.12, 0.25), rand(0.06, 0.14));
                    const cab = new THREE.Mesh(cabGeo, matMetalDark);
                    cab.position.set(
                        mainXoff + rand(-mainW * 0.30, mainW * 0.30),
                        podiumH + mainH * rand(0.25, 0.75),
                        mainZoff + (rand(0, 1) > 0.5 ? 1 : -1) * (mainD / 2 + rand(0.03, 0.10))
                    );
                    buildingGroup.add(cab);
                }

                // 4d. 阶梯式凸起墙体（副楼顶部叠层）
                if (archType !== 0) {
                    const stepCount = Math.floor(rand(2, 4));
                    for (let st = 0; st < stepCount; st++) {
                        const stepW = subW * (0.85 - st * 0.15);
                        const stepD = subD * (0.85 - st * 0.15);
                        const stepH = rand(0.08, 0.18);
                        const step = createBox(stepW, stepH, stepD, matWallPanel);
                        step.position.set(subXoff, podiumH + subH + st * stepH + stepH / 2, subZoff);
                        buildingGroup.add(step);
                    }
                }

                // 4e. 边角装饰块（小立方体削弱生硬直角）
                const cornerDotCount = Math.floor(rand(5, 10));
                const cornerDotGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
                for (let cd = 0; cd < cornerDotCount; cd++) {
                    const dot = new THREE.Mesh(cornerDotGeo, matMetalAccent);
                    dot.position.set(
                        mainXoff + (rand(0, 1) > 0.5 ? 1 : -1) * (mainW / 2 + rand(0.01, 0.06)),
                        podiumH + rand(0.05, mainH - 0.05),
                        mainZoff + (rand(0, 1) > 0.5 ? 1 : -1) * (mainD / 2 + rand(0.01, 0.06))
                    );
                    buildingGroup.add(dot);
                }

                // 4f. 🆕 楼顶增设小型设备方块、矮护栏、边角立柱、斜向装饰架、小型悬挑平台
                // 4f-1. 楼顶小型设备方块簇（空调外机/通信箱体模拟）
                const roofEquipCount = Math.floor(rand(3, 8));
                for (let rq = 0; rq < roofEquipCount; rq++) {
                    const rqW = rand(0.08, 0.22);
                    const rqH = rand(0.08, 0.20);
                    const rqD = rand(0.08, 0.22);
                    const rqGeo = new THREE.BoxGeometry(rqW, rqH, rqD);
                    const rqMesh = new THREE.Mesh(rqGeo, rq % 3 === 0 ? matMetalDark : (rq % 3 === 1 ? matMetalGray : matMetalAccent));
                    rqMesh.position.set(
                        mainXoff + rand(-setbackW * 0.42, setbackW * 0.42),
                        roofTopY + rqH / 2 + rand(-0.02, 0.06),
                        mainZoff + rand(-setbackD * 0.42, setbackD * 0.42)
                    );
                    // 部分设备加底座垫高
                    if (rand(0, 1) > 0.55) {
                        const baseH = rand(0.02, 0.05);
                        const baseGeo = new THREE.BoxGeometry(rqW + 0.04, baseH, rqD + 0.04);
                        const base = new THREE.Mesh(baseGeo, matMetalDark);
                        base.position.set(rqMesh.position.x, rqMesh.position.y - rqH / 2 - baseH / 2, rqMesh.position.z);
                        buildingGroup.add(base);
                    }
                    buildingGroup.add(rqMesh);
                }
                // 4f-2. 楼顶矮护栏（连续短栅栏条围绕退台屋顶边缘）
                const railSegCount = Math.floor(rand(5, 10));
                for (let rs = 0; rs < railSegCount; rs++) {
                    const railLen = rand(0.10, 0.30);
                    const railH = rand(0.06, 0.14);
                    const railThick = rand(0.02, 0.04);
                    const railGeo = new THREE.BoxGeometry(railLen, railH, railThick);
                    const rail = new THREE.Mesh(railGeo, matMetalGray);
                    const rsSide = rs % 4;
                    const rxSign = rsSide % 2 === 0 ? 1 : -1;
                    const rzSign = rsSide < 2 ? 1 : -1;
                    if (rsSide % 2 === 0) {
                        rail.position.set(mainXoff + rand(-setbackW * 0.38, setbackW * 0.38), roofTopY + railH / 2, mainZoff + rzSign * (setbackD / 2 + railThick / 2));
                    } else {
                        rail.rotation.y = Math.PI / 2;
                        rail.position.set(mainXoff + rxSign * (setbackW / 2 + railThick / 2), roofTopY + railH / 2, mainZoff + rand(-setbackD * 0.38, setbackD * 0.38));
                    }
                    buildingGroup.add(rail);
                }
                // 4f-3. 楼顶边角立柱（四角强化立柱 + 部分顶部小球）
                for (let rpc = 0; rpc < 4; rpc++) {
                    const rpcXSign = rpc % 2 === 0 ? 1 : -1;
                    const rpcZSign = rpc < 2 ? 1 : -1;
                    const rpcW = rand(0.06, 0.14);
                    const rpcH = rand(0.15, 0.45);
                    const rpcGeo = new THREE.BoxGeometry(rpcW, rpcH, rpcW);
                    const rpcMesh = new THREE.Mesh(rpcGeo, matMetalAccent);
                    rpcMesh.position.set(mainXoff + rpcXSign * (setbackW / 2 - rpcW * 0.3), roofTopY + rpcH / 2, mainZoff + rpcZSign * (setbackD / 2 - rpcW * 0.3));
                    buildingGroup.add(rpcMesh);
                    // 柱顶发光球（50%概率）
                    if (rand(0, 1) > 0.5) {
                        const ballGeo = new THREE.SphereGeometry(rpcW * rand(1.2, 1.8), 6, 4);
                        const ball = new THREE.Mesh(ballGeo, rand(0, 1) > 0.5 ? billMat : matNeonWarm);
                        ball.position.set(rpcMesh.position.x, roofTopY + rpcH + ballGeo.parameters.radius * 0.5, rpcMesh.position.z);
                        buildingGroup.add(ball);
                    }
                }
                // 4f-4. 楼顶斜向装饰架（交叉十字杆 + 对角撑架）
                const roofCrossCount = Math.floor(rand(1, 3));
                for (let dc = 0; dc < roofCrossCount; dc++) {
                    const crsLen = rand(0.40, 0.80);
                    const crsH = rand(0.04, 0.08);
                    const crsThick = rand(0.03, 0.06);
                    // 主横杆
                    const crsGeo = new THREE.BoxGeometry(crsLen, crsH, crsThick);
                    const crs = new THREE.Mesh(crsGeo, matMetalDark);
                    crs.position.set(mainXoff + rand(-0.15, 0.15), roofTopY + setbackH + rand(0.08, 0.25), mainZoff + rand(-0.15, 0.15));
                    crs.rotation.y = rand(-Math.PI / 4, Math.PI / 4);
                    buildingGroup.add(crs);
                    // 交叉斜撑（第二条杆旋转90°）
                    const crs2Geo = new THREE.BoxGeometry(crsLen * 0.75, crsH * 0.7, crsThick);
                    const crs2 = new THREE.Mesh(crs2Geo, matMetalDark);
                    crs2.position.copy(crs.position);
                    crs2.rotation.y = crs.rotation.y + Math.PI / 2;
                    buildingGroup.add(crs2);
                }
                // 4f-5. 楼顶小型悬挑平台（探出退台屋顶外侧的薄板平台）
                const roofCantCount = Math.floor(rand(1, 3));
                for (let rcc = 0; rcc < roofCantCount; rcc++) {
                    const rccW = setbackW * rand(0.25, 0.55);
                    const rccD = rand(0.06, 0.15);
                    const rccH = rand(0.03, 0.06);
                    const rccSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const rccGeo = new THREE.BoxGeometry(rccW, rccH, rccD);
                    const rccMesh = new THREE.Mesh(rccGeo, matMetalGray);
                    rccMesh.position.set(mainXoff + rand(-0.10, 0.10), roofTopY + rccH / 2, mainZoff + rccSide * (setbackD / 2 + rccD / 2));
                    buildingGroup.add(rccMesh);
                    // 小平台下斜撑
                    if (rand(0, 1) > 0.5) {
                        const braceGeo = new THREE.BoxGeometry(0.03, rccD * rand(1.5, 2.5), 0.03);
                        const brace = new THREE.Mesh(braceGeo, matMetalDark);
                        brace.position.set(rccMesh.position.x, roofTopY - rccD * rand(0.5, 1.0), rccMesh.position.z);
                        buildingGroup.add(brace);
                    }
                }

                // 4g. 🆕 楼栋底部增加基座分层凹凸、侧边矮墙体延伸小结构
                // 4g-1. 基座外围分层凹凸带（在基座正面/侧面叠加凹凸条带）
                const baseLayerCount = Math.floor(rand(2, 4));
                for (let bly = 0; bly < baseLayerCount; bly++) {
                    const blyH = rand(0.04, 0.09);
                    const blyY = podiumH * (bly + 1) / (baseLayerCount + 1) - blyH / 2;
                    // 正面凹凸层
                    const blyLenF = podiumW * rand(0.75, 1.05);
                    const blyDepth = rand(0.06, 0.15);
                    const blyGeoF = new THREE.BoxGeometry(blyLenF, blyH, blyDepth);
                    const blyMeshF = new THREE.Mesh(blyGeoF, matMetalGray);
                    blyMeshF.position.set(0, blyY, podiumD / 2 + blyDepth / 2);
                    buildingGroup.add(blyMeshF);
                    // 背面凹凸层
                    if (rand(0, 1) > 0.4) {
                        const blyMeshB = new THREE.Mesh(blyGeoF, matMetalGray);
                        blyMeshB.position.set(0, blyY, -podiumD / 2 - blyDepth / 2);
                        buildingGroup.add(blyMeshB);
                    }
                    // 侧面凹凸层
                    if (archType % 2 === 0) {
                        const blyLenS = podiumD * rand(0.75, 1.05);
                        const blyGeoS = new THREE.BoxGeometry(blyDepth, blyH, blyLenS);
                        const blyMeshS = new THREE.Mesh(blyGeoS, matMetalGray);
                        blyMeshS.position.set((rand(0, 1) > 0.5 ? 1 : -1) * (podiumW / 2 + blyDepth / 2), blyY, 0);
                        buildingGroup.add(blyMeshS);
                    }
                }
                // 4g-2. 基座底部倒角收边带
                const baseTrimH = rand(0.02, 0.05);
                const baseTrimDepth = rand(0.05, 0.10);
                const trimGeoF = new THREE.BoxGeometry(podiumW * rand(0.85, 1.05), baseTrimH, baseTrimDepth);
                const trimF = new THREE.Mesh(trimGeoF, matMetalDark);
                trimF.position.set(0, baseTrimH / 2, podiumD / 2 + baseTrimDepth / 2);
                buildingGroup.add(trimF);
                const trimB = new THREE.Mesh(trimGeoF, matMetalDark);
                trimB.position.set(0, baseTrimH / 2, -podiumD / 2 - baseTrimDepth / 2);
                buildingGroup.add(trimB);
                // 4g-3. 侧边矮墙体延伸小结构（低矮翼墙向两侧延伸）
                const extWingCount = Math.floor(rand(1, 2));
                for (let ew = 0; ew < extWingCount; ew++) {
                    const ewW = rand(0.06, 0.15);
                    const ewH = podiumH * rand(0.70, 1.20) + rand(0.10, 0.40);
                    const ewD = podiumD * rand(0.40, 0.75);
                    const ewSide = rand(0, 1) > 0.5 ? 1 : -1;
                    const ewGeo = new THREE.BoxGeometry(ewW, ewH, ewD);
                    const ewMesh = new THREE.Mesh(ewGeo, matWallInset);
                    ewMesh.position.set(ewSide * (podiumW / 2 + ewW / 2 + rand(0.05, 0.20)), ewH / 2, rand(-podiumD * 0.15, podiumD * 0.15));
                    buildingGroup.add(ewMesh);
                    // 矮墙顶部小檐口
                    if (rand(0, 1) > 0.55) {
                        const eaveGeo = new THREE.BoxGeometry(ewW + 0.04, rand(0.02, 0.04), ewD * rand(0.80, 1.05));
                        const eave = new THREE.Mesh(eaveGeo, matMetalGray);
                        eave.position.set(ewMesh.position.x, ewH + ewMesh.position.y - ewH / 2 + eaveGeo.parameters.height / 2, ewMesh.position.z);
                        buildingGroup.add(eave);
                    }
                }
                // 4g-4. 基座正面入口凹进（模拟大门/车库入口）
                if (rand(0, 1) > 0.55) {
                    const gateW = podiumW * rand(0.20, 0.40);
                    const gateH = podiumH * rand(0.55, 0.80);
                    const gateDepth = rand(0.06, 0.14);
                    const gateGeo = new THREE.BoxGeometry(gateW, gateH, gateDepth);
                    const gate = new THREE.Mesh(gateGeo, matMetalDark);
                    // 入口于基座正面居中偏下
                    gate.position.set(rand(-podiumW * 0.20, podiumW * 0.20), gateH / 2, podiumD / 2 - gateDepth / 2 + 0.005);
                    buildingGroup.add(gate);
                    // 门两侧细柱
                    for (let gs = 0; gs < 2; gs++) {
                        const gsXSign = gs === 0 ? 1 : -1;
                        const gsGeo = new THREE.BoxGeometry(0.03, gateH, gateDepth + 0.02);
                        const gsMesh = new THREE.Mesh(gsGeo, matMetalAccent);
                        gsMesh.position.set(gate.position.x + gsXSign * (gateW / 2 + 0.02), gateH / 2, podiumD / 2 - gateDepth / 2 + 0.01);
                        buildingGroup.add(gsMesh);
                    }
                }

                // ========== 【5. 屋顶大型发光广告牌（保留原设计）】 ==========
                const signW = width * clamp(rand(0.4, 0.8), 0.4, 0.8);
                const signH = clamp(rand(0.6, 1.8), 0.6, 1.8);
                const signD = depth * clamp(rand(0.2, 0.5), 0.2, 0.5);
                const signGeo = new THREE.BoxGeometry(signW, signH, signD);
                const sign = new THREE.Mesh(signGeo, billMat);
                sign.position.set(
                    rand(-width * 0.15, width * 0.15),
                    podiumH + mainH + setbackH + signH / 2,
                    rand(-depth * 0.15, depth * 0.15)
                );
                sign.castShadow = true;
                // 35% 概率克隆材质并注册霓虹闪烁动画（不影响共享材质）
                if (Math.random() < 0.35) {
                    sign.material = billMat.clone();
                    sign.userData.flicker = {
                        base: sign.material.emissiveIntensity,
                        speed: rand(1.5, 5.0),
                        phase: rand(0, Math.PI * 2)
                    };
                    flickerSigns.push(sign);
                }
                buildingGroup.add(sign);
                // 广告牌立柱
                const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, signH * 0.5, 8);
                const poleMat = new THREE.MeshStandardMaterial({ color: 0x6a6e78, metalness: 0.85, roughness: 0.18 });
                const pole = new THREE.Mesh(poleGeo, poleMat);
                pole.position.set(sign.position.x, podiumH + mainH + setbackH + signH * 0.25, sign.position.z);
                buildingGroup.add(pole);

                // 定位建筑组到世界坐标
                buildingGroup.position.set(worldX, 0, worldZ);
                // 宽矮副楼不投射阴影（性能优化，瘦高楼保留阴影）
                if (!isTallSlim) {
                    buildingGroup.traverse(function (o) { o.castShadow = false; });
                }
                buildingsGroup.add(buildingGroup);
            }
        }

        // ========== 调用生成 ==========
        spawnBuildingsInZone(LEFT_ZONE, '左侧');
        spawnBuildingsInZone(RIGHT_ZONE, '右侧');

        console.log("✅ 全部" + (BUILDING_COUNT_PER_SIDE * 2) + "栋精细化楼房生成完成（左" + BUILDING_COUNT_PER_SIDE + "栋 + 右" + BUILDING_COUNT_PER_SIDE + "栋）");

        // ============================================
        //  🆕🆕 中景楼群（外围第二圈，纯剪影+窗光，零精细装饰，性能优先）
        // ============================================
        (function spawnMidRingBuildings() {
            const midMats = [
                new THREE.MeshStandardMaterial({ color: 0x141b2e, metalness: 0.55, roughness: 0.55 }),
                new THREE.MeshStandardMaterial({ color: 0x1a2338, metalness: 0.50, roughness: 0.60 }),
                new THREE.MeshStandardMaterial({ color: 0x101828, metalness: 0.60, roughness: 0.50 })
            ];
            const midWinMats = [
                new THREE.MeshStandardMaterial({ color: 0xffcc88, emissive: 0xffaa55, emissiveIntensity: 1.1 }),
                new THREE.MeshStandardMaterial({ color: 0x88ddff, emissive: 0x55bbff, emissiveIntensity: 1.0 }),
                new THREE.MeshStandardMaterial({ color: 0xff88cc, emissive: 0xff55aa, emissiveIntensity: 1.0 })
            ];
            const zones = [
                { xMin: -40, xMax: -24, zMin: -48, zMax: 40 },
                { xMin: 24, xMax: 40, zMin: -48, zMax: 40 }
            ];
            zones.forEach(function (zone, zi) {
                const count = 26;
                for (let i = 0; i < count; i++) {
                    const w = rand(2.5, 5.5), d = rand(2.5, 5.5);
                    const h = rand(8, 26) * HEIGHT_SCALE * 1.6;
                    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), midMats[(i + zi) % midMats.length]);
                    const x = rand(zone.xMin, zone.xMax);
                    const z = rand(zone.zMin, zone.zMax);
                    mesh.position.set(x, h / 2, z);
                    buildingsGroup.add(mesh);
                    // 竖向发光窗条（2~5条，营造万家灯火感）
                    const strips = Math.floor(rand(2, 6));
                    for (let s = 0; s < strips; s++) {
                        const sw = 0.08, sh = h * rand(0.45, 0.85);
                        const strip = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.05), midWinMats[Math.floor(rand(0, midWinMats.length))]);
                        const fx = x + rand(-w / 2 + 0.4, w / 2 - 0.4);
                        const fz = (Math.random() > 0.5 ? 1 : -1) * (d / 2 + 0.03);
                        strip.position.set(fx, h * rand(0.35, 0.55), fz);
                        buildingsGroup.add(strip);
                    }
                }
            });
            console.log("🏙️ 中景楼群生成完成（52栋 + 窗光条）");
        })();

        // ============================================
        //  🆕🆕 远景天际线剪影（最外圈，超远超密，纯氛围）
        // ============================================
        (function spawnFarSkyline() {
            const farMat = new THREE.MeshStandardMaterial({ color: 0x0b1120, metalness: 0.40, roughness: 0.75 });
            const farGlowMat = new THREE.MeshStandardMaterial({ color: 0x223355, emissive: 0x1a2a4a, emissiveIntensity: 0.8 });
            // 城市背景色雾中天际带：横跨全场景四周边缘
            for (let i = 0; i < 90; i++) {
                const w = rand(3, 8), d = rand(3, 8);
                const h = rand(8, 26) * HEIGHT_SCALE;
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), Math.random() > 0.85 ? farGlowMat : farMat);
                // 均匀撒在 [-70,70] 边缘区域（避开中心跑道走廊）
                // 额外约束：z∈[-75,-40] 段避开 |x|<9 的跑道正前方视线走廊，保住直达地平线的视野
                const edge = Math.floor(rand(0, 4));
                let x, z;
                if (edge === 0) { x = rand(-70, 70); z = rand(-70, -46); }
                else if (edge === 1) { x = rand(-70, 70); z = rand(46, 70); }
                else if (edge === 2) { x = rand(-70, -46); z = rand(-46, 46); }
                else { x = rand(46, 70); z = rand(-46, 46); }
                if (edge === 0 && Math.abs(x) < 9) { i--; continue; }
                mesh.position.set(x, h / 2, z);
                buildingsGroup.add(mesh);
                // 顶部航空障碍红灯（稀疏点缀）
                if (Math.random() < 0.30) {
                    const lamp = new THREE.Mesh(
                        new THREE.SphereGeometry(0.12, 6, 6),
                        new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 3.0 })
                    );
                    lamp.position.set(x, h + 0.15, z);
                    buildingsGroup.add(lamp);
                }
            }
            console.log("🌆 远景天际线剪影生成完成（90栋）");
        })();

        // ============================================
        //  🆕🆕 夜空系统：星空粒子 + 月亮
        // ============================================
        (function spawnNightSky() {
            // 星空：BufferGeometry 点云（1400颗，性能友好）
            const starCount = 1400;
            const positions = new Float32Array(starCount * 3);
            for (let i = 0; i < starCount; i++) {
                // 双层分布：60%贴着地平线形成"银河带"（默认俯视相机唯一可见的天空带），
                // 40%撒在上半球（用户旋转视角抬头时可见）
                const theta = Math.random() * Math.PI * 2;
                const r = rand(150, 210);
                let elev;
                if (i < starCount * 0.6) {
                    elev = -7 + Math.random() * 6;  // -7°~-1°：地平线银河带
                } else {
                    elev = 5 + Math.random() * 50;  // 5°~55°：上半球星带
                }
                const elevRad = elev * Math.PI / 180;
                positions[i * 3] = r * Math.cos(elevRad) * Math.cos(theta);
                positions[i * 3 + 1] = 8 + r * Math.sin(elevRad);
                positions[i * 3 + 2] = r * Math.cos(elevRad) * Math.sin(theta);
            }
            const starGeo = new THREE.BufferGeometry();
            starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const starMat = new THREE.PointsMaterial({
                color: 0xffffff, size: 2.6, sizeAttenuation: false,
                transparent: true, opacity: 1.0, fog: false
            });
            const stars = new THREE.Points(starGeo, starMat);
            stars.name = 'night-stars';
            buildingsGroup.add(stars);

            // 月亮：低悬在跑道尽头地平线上方（沙盒默认相机俯视24°，可见天空带仅地平线上方一条窄缝，
            // 月亮必须落在该带内才能入画；投影验证：NDC y≈0.84，画面上部居左）
            const moonGroup = new THREE.Group();
            const moonMat = new THREE.MeshBasicMaterial({ color: 0xf5f3e8, fog: false });
            const moon = new THREE.Mesh(new THREE.CircleGeometry(6.5, 32), moonMat);
            moonGroup.add(moon);
            const haloMat = new THREE.MeshBasicMaterial({ color: 0x9db8e0, transparent: true, opacity: 0.30, fog: false });
            const halo = new THREE.Mesh(new THREE.CircleGeometry(11, 32), haloMat);
            halo.position.z = -0.5;
            moonGroup.add(halo);
            moonGroup.position.set(-6, 1.5, -125);
            moonGroup.lookAt(0, 8, 18);
            moonGroup.name = 'night-moon';
            buildingsGroup.add(moonGroup);

            // 地平线城市光晕（远处天际的蓝色光污染带，营造大都市夜幕纵深）
            function makeHorizonGlow(glowColor, opacity) {
                const cvs = document.createElement('canvas');
                cvs.width = 4; cvs.height = 128;
                const ctx = cvs.getContext('2d');
                const grad = ctx.createLinearGradient(0, 128, 0, 0);
                grad.addColorStop(0, glowColor);
                grad.addColorStop(1, 'rgba(10,16,32,0)');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, 4, 128);
                const tex = new THREE.CanvasTexture(cvs);
                const mat = new THREE.MeshBasicMaterial({
                    map: tex, transparent: true, opacity: opacity,
                    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
                });
                const mesh = new THREE.Mesh(new THREE.PlaneGeometry(360, 55), mat);
                return mesh;
            }
            const glowFront = makeHorizonGlow('rgba(80,140,220,0.95)', 0.95);
            glowFront.position.set(0, 20, -150);
            glowFront.name = 'horizon-glow';
            buildingsGroup.add(glowFront);
            const glowBack = makeHorizonGlow('rgba(70,125,200,0.85)', 0.85);
            glowBack.position.set(0, 20, 150);
            glowBack.rotation.y = Math.PI;
            glowBack.name = 'horizon-glow';
            buildingsGroup.add(glowBack);
            console.log("🌌 夜空系统生成完成（星空1400 + 月亮 + 地平线光晕）");

            // 全息光柱（赛博城市标志性元素：垂直发光渐变面片，随机穿插在楼群中）
            const pillarColors = ['rgba(255,64,160,0.85)', 'rgba(64,210,255,0.85)', 'rgba(255,190,80,0.85)', 'rgba(160,120,255,0.85)'];
            for (let i = 0; i < 10; i++) {
                const side = Math.random() > 0.5 ? 1 : -1;
                const px = side * rand(11, 21);
                const pz = rand(-45, 35);
                const ph = rand(14, 30);
                const cvs = document.createElement('canvas');
                cvs.width = 4; cvs.height = 64;
                const ctx = cvs.getContext('2d');
                const grad = ctx.createLinearGradient(0, 64, 0, 0);
                grad.addColorStop(0, pillarColors[i % pillarColors.length]);
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, 4, 64);
                const tex = new THREE.CanvasTexture(cvs);
                const mat = new THREE.MeshBasicMaterial({
                    map: tex, transparent: true, opacity: 0.75,
                    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
                });
                const pillar = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.5, 1.2), ph), mat);
                pillar.position.set(px, ph / 2, pz);
                // 双面交叉十字片，任意角度都有体积感
                const pillar2 = pillar.clone();
                pillar2.rotation.y = Math.PI / 2;
                buildingsGroup.add(pillar);
                buildingsGroup.add(pillar2);
            }
            console.log("✨ 全息光柱生成完成（10组）");
        })();

        // ============================================
        //  🆕🆕 街道车流光轨（左右主干道，移动动画）
        // ============================================
        (function spawnTrafficStreams() {
            const headMatA = new THREE.MeshBasicMaterial({ color: 0xffcc44, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95 });  // 出城方向：暖黄车头灯
            const tailMatA = new THREE.MeshBasicMaterial({ color: 0xff3333, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95 });  // 回城方向：红色尾灯
            const headMatB = new THREE.MeshBasicMaterial({ color: 0x44ccff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95 });
            const tailMatB = new THREE.MeshBasicMaterial({ color: 0xff5588, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95 });
            // 四条主干道：X = ±11.5（近道）与 ±15.5（外道），像城市快速路网
            // 每条道下方铺深色路面，让车流光轨落在真实道路上
            const roadMat = new THREE.MeshStandardMaterial({ color: 0x151d30, roughness: 0.45, metalness: 0.35 });
            [-15.5, -11.5, 11.5, 15.5].forEach(function (roadX, ri) {
                const road = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.02, 130), roadMat);
                road.position.set(roadX, 0.012, 0);
                buildingsGroup.add(road);
                for (let i = 0; i < 24; i++) {
                    const goingOut = (i % 2 === 0);
                    const mat = goingOut
                        ? (ri % 2 === 0 ? headMatA : headMatB)
                        : (ri % 2 === 0 ? tailMatA : tailMatB);
                    // 光轨拉长加宽：远看呈光带效果（长条发光块）
                    const car = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.07, rand(1.2, 2.4)), mat);
                    // 车道偏移：出城/回城各走一侧
                    car.position.set(roadX + (goingOut ? 0.45 : -0.45), 0.08, rand(-60, 60));
                    car.userData.isTrafficCar = true;
                    car.userData.trafficSpeed = rand(6, 13);
                    trafficMeshes.push(car);
                    buildingsGroup.add(car);
                }
            });
            console.log("🚗 街道车流光轨生成完成（4道×24辆）");
        })();

        // ============================================
        //  🆕🆕 空中巡航灯（远处缓慢飘过的飞行灯，点缀天际）
        // ============================================
        (function spawnSkyLights() {
            for (let i = 0; i < 8; i++) {
                const light = new THREE.Mesh(
                    new THREE.SphereGeometry(0.35, 6, 6),
                    new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0xff5566 : 0x55ffcc })
                );
                light.position.set(rand(-60, 60), rand(18, 38), rand(-70, 40));
                light.userData.isSkyLight = true;
                light.userData.skySpeed = rand(0.8, 2.0);
                skyTrafficLights.push(light);
                buildingsGroup.add(light);
            }
            console.log("✈️ 空中巡航灯生成完成（8盏）");
        })();

        // ============================================
        //  🆕🆕 注册城市动画系统（车流移动 + 广告牌闪烁）
        // ============================================
        window._cyberCityAnimators = {
            group: buildingsGroup,
            cars: trafficMeshes,
            signs: flickerSigns,
            skyLights: skyTrafficLights,
            // 动画更新（由主循环每帧调用，t = performance.now()/1000）
            update: function (t, dt) {
                // 车流：沿Z轴往返移动（超出范围回绕）
                for (let i = 0; i < this.cars.length; i++) {
                    const car = this.cars[i];
                    car.position.z -= car.userData.trafficSpeed * dt * (car.position.x > 0 ? 1 : -1);
                    if (car.position.z < -62) car.position.z = 62;
                    if (car.position.z > 62) car.position.z = -62;
                }
                // 霓虹广告牌闪烁（sin+随机脉冲混合）
                for (let i = 0; i < this.signs.length; i++) {
                    const sign = this.signs[i];
                    const f = sign.userData.flicker;
                    const pulse = 0.55 + 0.45 * Math.sin(t * f.speed + f.phase);
                    // 偶发断电式闪烁
                    const glitch = (Math.sin(t * f.speed * 7.3 + f.phase) > 0.98) ? 0.25 : 1.0;
                    sign.material.emissiveIntensity = f.base * pulse * glitch;
                }
                // 空中巡航灯缓慢漂移
                for (let i = 0; i < this.skyLights.length; i++) {
                    const l = this.skyLights[i];
                    l.position.x += l.userData.skySpeed * dt;
                    if (l.position.x > 70) l.position.x = -70;
                }
            }
        };
        console.log("🎬 城市动画系统注册完成（车流/广告牌/巡航灯）");

        // ============================================
        //  🆕 地面赛博朋克灯光系统（仅左右两侧，禁飞通道无灯）
        // ============================================
        console.log("💡 开始生成地面赛博灯光...");

        // --- 灯光材质体系（PBR自发光，柔和不刺眼） ---
        // 粉色系地灯材质
        const matGroundPinkLinear = new THREE.MeshStandardMaterial({
            color: 0xff3388, emissive: 0xff3388, emissiveIntensity: 3.6,
            metalness: 0.10, roughness: 0.35, transparent: true, opacity: 0.85
        });
        const matGroundWhiteLinear = new THREE.MeshStandardMaterial({
            color: 0xddeeff, emissive: 0xaaccff, emissiveIntensity: 3.0,
            metalness: 0.10, roughness: 0.35, transparent: true, opacity: 0.80
        });
        const matGroundPinkDot = new THREE.MeshStandardMaterial({
            color: 0xff4499, emissive: 0xff2288, emissiveIntensity: 1.8,
            metalness: 0.08, roughness: 0.40, transparent: true, opacity: 0.75
        });
        const matGroundCyanDot = new THREE.MeshStandardMaterial({
            color: 0x88ddff, emissive: 0x55bbff, emissiveIntensity: 1.8,
            metalness: 0.08, roughness: 0.40, transparent: true, opacity: 0.75
        });

        // 禁飞通道坐标边界（与楼房禁建区一致，地面灯绝不踏入）
        const LIGHT_NOFLY_X_MIN = -10, LIGHT_NOFLY_X_MAX = 10;
        const LIGHT_NOFLY_Z_MIN = -10, LIGHT_NOFLY_Z_MAX = 30;

        /**
         * 判断坐标是否在禁飞通道内
         * @returns {boolean} true=禁飞区，不放置灯光
         */
        function isInNoFlyZone(x, z) {
            return x >= LIGHT_NOFLY_X_MIN && x <= LIGHT_NOFLY_X_MAX &&
                z >= LIGHT_NOFLY_Z_MIN && z <= LIGHT_NOFLY_Z_MAX;
        }

        // ==================== ① 地面线性灯带 ====================
        // 沿跑道方向（Z轴）在左右两侧各铺设3条长灯带，粉/浅白交替
        const stripZMin = -15, stripZMax = 30;
        const stripZLen = stripZMax - stripZMin;  // 45m长
        const stripOffsetsX = [10.5, 12.0, 13.5, -10.5, -12.0, -13.5]; // X绝对值>10，贴紧禁飞区边界
        const stripColors = [matGroundPinkLinear, matGroundWhiteLinear, matGroundPinkLinear,  // 右侧
            matGroundWhiteLinear, matGroundPinkLinear, matGroundWhiteLinear]; // 左侧

        for (let si = 0; si < stripOffsetsX.length; si++) {
            const sx = stripOffsetsX[si];
            const stripGeo = new THREE.BoxGeometry(0.10, 0.015, stripZLen);
            // 克隆材质，确保每条灯带独立 emissiveIntensity，避免共享材质动画冲突
            const stripMat = stripColors[si].clone();
            const strip = new THREE.Mesh(stripGeo, stripMat);
            strip.position.set(sx, 0.02, (stripZMin + stripZMax) / 2);
            strip.receiveShadow = true;
            strip.castShadow = false;  // 地灯不投射阴影，避免干扰原有阴影系统
            strip.renderOrder = 1;
            // 标记为地面灯带，存储原始发光强度供闪烁动画使用
            strip.userData = { isGroundLight: true, type: 'strip', originalIntensity: stripMat.emissiveIntensity };
            buildingsGroup.add(strip);
            console.log(`  ▓ 地面灯带: X=${sx}, Z=${stripZMin}~${stripZMax}`);
        }

        // ==================== ② 点状地灯（随机散布） ====================
        const dotCount = 120;
        const dotGeo = new THREE.BoxGeometry(0.12, 0.012, 0.12);
        // 允许点状地灯分布的 X 区间（与建筑分区一致）
        const dotXZones = [
            { minX: -22, maxX: -10 },
            { minX: 10, maxX: 22 }
        ];
        const dotZMin = -14, dotZMax = 29;

        for (let d = 0; d < dotCount; d++) {
            // 随机选择左侧或右侧
            const zone = dotXZones[Math.floor(rand(0, dotXZones.length))];
            const dx = rand(zone.minX, zone.maxX);
            const dz = rand(dotZMin, dotZMax);

            // 禁飞区二次校验（理论上坐标已在外，保留安全兜底）
            if (isInNoFlyZone(dx, dz)) {
                console.warn(`  ⚠️ 点状地灯坐标(${dx.toFixed(2)}, ${dz.toFixed(2)}) 意外落入禁飞区，已跳过`);
                continue;
            }

            // 随机粉/青冷暖色 — 必须 clone 材质，每个点灯独立 emissiveIntensity
            const isPink = rand(0, 1) > 0.5;
            const dotMat = (isPink ? matGroundPinkDot : matGroundCyanDot).clone();
            const dot = new THREE.Mesh(dotGeo, dotMat);
            dot.position.set(dx, 0.015, dz);
            dot.receiveShadow = true;
            dot.castShadow = false;
            dot.renderOrder = 1;
            // 标记为点状地灯，分组A/B错开相位闪烁（A:0~59, B:60~119）
            const dotGroup = d < dotCount / 2 ? 'A' : 'B';
            dot.userData = { isGroundLight: true, type: 'dot', group: dotGroup, originalIntensity: dotMat.emissiveIntensity };
            buildingsGroup.add(dot);
        }
        console.log(`  ✦ 点状地灯: ${dotCount}个随机散布完成`);

        // ==================== ③ 建筑底部轮廓地灯光晕 ====================
        // 在每个建筑组下方围绕一圈微型地灯光环，强化建筑基底发光
        if (buildingsGroup.children.length > 0) {
            buildingsGroup.children.forEach(function (child) {
                if (child.isGroup && child.name && child.name.match(/building-/)) {
                    const bx = child.position.x;
                    const bz = child.position.z;
                    // 只在非禁飞区的建筑脚下生成
                    if (isInNoFlyZone(bx, bz)) return;

                    // 4个角各放一个方片地灯
                    const haloGeo = new THREE.BoxGeometry(0.15, 0.010, 0.15);
                    const offsets = [
                        [-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]
                    ];
                    offsets.forEach(function (off) {
                        // 必须 clone，每个光晕独立 emissiveIntensity
                        const haloMat = (rand(0, 1) > 0.5 ? matGroundPinkDot : matGroundCyanDot).clone();
                        const halo = new THREE.Mesh(haloGeo, haloMat);
                        halo.position.set(bx + off[0], 0.012, bz + off[1]);
                        halo.receiveShadow = true;
                        halo.castShadow = false;
                        halo.renderOrder = 1;
                        // 标记为光晕地灯，归入B组闪烁相位
                        halo.userData = { isGroundLight: true, type: 'halo', group: 'B', originalIntensity: haloMat.emissiveIntensity };
                        buildingsGroup.add(halo);
                    });
                }
            });
        }
        console.log("💡 地面赛博灯光系统生成完成");

        // ============================================
        //  🆕🆕 静态几何合并（性能优化核心）
        //  问题：~2万个静态小mesh（窗户/灯带/构件）逐个提交GPU，draw call爆炸（实测8600+，FPS<5）
        //  方案：按材质特征分桶 → 烘焙世界矩阵 → 每桶拼接成1个大mesh（预计降至几十个draw call）
        //  豁免：车流isTrafficCar/巡航灯isSkyLight/地面灯isGroundLight/闪烁广告牌flicker/
        //        星空night-stars/月亮night-moon/地平线光晕horizon-glow（全息光柱独立纹理天然独立）
        //  安全性：合并在首次渲染前完成，被合并的原始几何从未上传GPU，无泄漏；
        //          动画系统（_cyberCityAnimators/主循环闪烁traverse）引用的mesh全部豁免，行为不变
        // ============================================
        (function mergeStaticCityGeometry() {
            const t0 = performance.now();
            let mergedIn = 0, mergedOut = 0;

            // 材质特征键：参数相同的不同实例（如每栋楼独立new的立柱材质）归为同桶，合并后共用首个材质
            function matKey(mat) {
                if (!mat) return 'null';
                return [
                    mat.type,
                    mat.color ? mat.color.getHexString() : '-',
                    mat.emissive ? mat.emissive.getHexString() : '-',
                    mat.emissiveIntensity, mat.metalness, mat.roughness,
                    mat.transparent ? 1 : 0, mat.opacity,
                    mat.blending, mat.depthWrite === false ? 1 : 0,
                    mat.side || 0, mat.fog === false ? 1 : 0
                ].join('|');
            }

            // 动态对象判定：被动画系统逐帧驱动的对象必须保持独立
            function isDynamic(o) {
                const ud = o.userData || {};
                if (ud.isTrafficCar || ud.isSkyLight || ud.isGroundLight) return true;
                if (ud.flicker) return true;
                if (o.name === 'night-stars' || o.name === 'night-moon' || o.name === 'horizon-glow') return true;
                return false;
            }

            const meshBuckets = new Map();   // key -> {mat, cs, rs, items[]}
            const lineBuckets = new Map();   // key -> {mat, items[]}
            let staticMeshCount = 0;
            let skippedInvalid = 0;          // 防御性过滤计数（matrixWorld含非有限值的mesh不入桶）

            // 防御性检查：变换矩阵含 NaN/Infinity 的 mesh（上游生成代码bug产物）不入桶，
            // 避免污染合并缓冲导致整个 merged-static 不可渲染（three 报 "Computed radius is NaN"）
            function hasInvalidMatrix(o) {
                const e = o.matrixWorld.elements;
                for (let i = 0; i < 16; i++) if (!isFinite(e[i])) return true;
                const p = o.geometry.attributes.position.array;
                for (let i = 0; i < p.length; i++) if (!isFinite(p[i])) return true;
                return false;
            }

            buildingsGroup.updateMatrixWorld(true);  // 确保烘焙矩阵最新（buildingsGroup自身无变换）

            buildingsGroup.traverse(function (o) {
                if (o === buildingsGroup || isDynamic(o)) return;
                if (o.isMesh) {
                    if (hasInvalidMatrix(o)) { skippedInvalid++; return; }
                    staticMeshCount++;
                    const key = matKey(o.material) + '#s' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0);
                    let b = meshBuckets.get(key);
                    if (!b) { b = { mat: o.material, cs: o.castShadow, rs: o.receiveShadow, items: [] }; meshBuckets.set(key, b); }
                    b.items.push(o);
                } else if (o.isLineSegments) {
                    if (hasInvalidMatrix(o)) { skippedInvalid++; return; }
                    const key = matKey(o.material);
                    let b = lineBuckets.get(key);
                    if (!b) { b = { mat: o.material, items: [] }; lineBuckets.set(key, b); }
                    b.items.push(o);
                }
            });

            /**
             * 通用几何拼接：兼容 indexed / 非 indexed、任意同名属性集
             * @param {boolean} preferIndex true=Mesh桶（优先索引拼接）；false=Line桶（纯顶点拼接）
             */
            function buildMergedGeometry(items, preferIndex) {
                let allIndexed = preferIndex;
                items.forEach(m => { if (!m.geometry.index) allIndexed = false; });
                const attrNames = Object.keys(items[0].geometry.attributes);
                const itemSizes = attrNames.map(n => items[0].geometry.attributes[n].itemSize);
                // 顶点数与索引数分开统计（如BoxGeometry: 24顶点配36索引，两者不等！）
                let totalVerts = 0, totalIdx = 0;
                items.forEach(m => {
                    if (allIndexed) {
                        totalVerts += m.geometry.attributes.position.count;
                        totalIdx += m.geometry.index.count;
                    } else {
                        totalVerts += m.geometry.index
                            ? m.geometry.index.count
                            : m.geometry.attributes.position.count;  // 展开索引后顶点数=索引数
                    }
                });
                const arrays = attrNames.map((n, i) => new Float32Array(totalVerts * itemSizes[i]));
                // 索引数组长度取决于totalIdx而非totalVerts（修复：两者不等时写越界产生NaN）
                const IndexArr = totalVerts > 65535 ? Uint32Array : Uint16Array;
                const idxArr = allIndexed ? new IndexArr(totalIdx) : null;
                let vOff = 0, iOff = 0;
                items.forEach(function (m) {
                    let g = m.geometry.clone();
                    if (!allIndexed && g.index) g = g.toNonIndexed();  // 展开索引，拓扑转为显式顶点流
                    g.applyMatrix4(m.matrixWorld);                     // 烘焙世界变换（含旋转/平移）
                    attrNames.forEach(function (n, ai) {
                        arrays[ai].set(g.attributes[n].array, vOff * itemSizes[ai]);
                    });
                    if (allIndexed) {
                        const si = g.index.array;
                        for (let i = 0; i < si.length; i++) idxArr[iOff + i] = si[i] + vOff;
                        iOff += si.length;
                    }
                    vOff += g.attributes.position.count;
                    g.dispose();
                });
                const merged = new THREE.BufferGeometry();
                attrNames.forEach(function (n, ai) {
                    merged.setAttribute(n, new THREE.BufferAttribute(arrays[ai], itemSizes[ai]));
                });
                if (allIndexed) merged.setIndex(new THREE.BufferAttribute(idxArr, 1));
                return merged;
            }

            let seq = 0;
            meshBuckets.forEach(function (b) {
                if (b.items.length < 2) return;  // 单元素桶无需合并
                const geo = buildMergedGeometry(b.items, true);
                const big = new THREE.Mesh(geo, b.mat);
                big.castShadow = b.cs;
                big.receiveShadow = b.rs;
                big.name = 'merged-static-' + (++seq);
                b.items.forEach(m => { if (m.parent) m.parent.remove(m); });
                buildingsGroup.add(big);
                mergedIn += b.items.length; mergedOut++;
            });
            lineBuckets.forEach(function (b) {
                if (b.items.length < 2) return;
                const geo = buildMergedGeometry(b.items, false);
                const big = new THREE.LineSegments(geo, b.mat);
                big.name = 'merged-lines-' + (++seq);
                b.items.forEach(m => { if (m.parent) m.parent.remove(m); });
                buildingsGroup.add(big);
                mergedIn += b.items.length; mergedOut++;
            });

            console.log('🔧 静态几何合并完成: ' + mergedIn + '个静态对象 → ' + mergedOut +
                '个合并网格（场景内静态对象总数' + staticMeshCount + '，跳过无效几何' + skippedInvalid +
                '个，耗时' + (performance.now() - t0).toFixed(0) + 'ms）');
        })();

        return buildingsGroup;
    } catch (e) {
        console.error("❌ generateCyberCity 执行异常:", e.message, e.stack);
        return null;
    }
}

// ===== 纹理材质系统（从/static/texture/目录加载外部共用贴图，墙体+地面共用） =====
/** 已加载的共用纹理缓存（墙体与地面共用同一张贴图） */
let sharedBuildingTex = null;

/**
 * 从 /static/texture/ 目录加载外部共用贴图文件
 * 使用 THREE.TextureLoader 加载，不读取GLB模型内部自带纹理
 * @param {string} texturePath - 贴图文件路径（相对于 static/texture/）
 * @returns {Promise<THREE.Texture|null>} 加载成功返回纹理对象，失败返回 null
 */
async function loadExternalBuildingTexture(texturePath) {
    if (!window.THREE) return null;
    var THREE = window.THREE;
    var fullPath = '/static/texture/' + texturePath;
    console.log('[纹理] 开始加载外部贴图: ' + fullPath);

    var loader = new THREE.TextureLoader();
    try {
        var tex = await new Promise(function (resolve, reject) {
            loader.load(fullPath, resolve, undefined, reject);
        });
        // 配置纹理参数
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(12, 12);
        tex.anisotropy = 16;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        console.log('[纹理] ✅ 外部贴图加载成功: ' + texturePath);
        return tex;
    } catch (err) {
        console.warn('[纹理] ⚠️ 外部贴图加载失败，墙体/地面将使用纯色材质: ' + texturePath, err);
        return null;
    }
}
// 导出函数供外部调用
window.loadExternalBuildingTexture = loadExternalBuildingTexture;

/**
 * 创建共用墙体材质
 * metalness: 0.04, roughness: 0.65
 * @param {THREE.Texture|null} tex - 共用纹理贴图
 * @param {number} [colorOverride] - 可选的颜色覆盖
 */
function createWallMaterial(tex, colorOverride) {
    if (!window.THREE) return null;
    var THREE = window.THREE;
    var material = new THREE.MeshStandardMaterial({
        map: tex || null,
        color: colorOverride || 0xffffff,
        metalness: 0.04,
        roughness: 0.65,
        side: THREE.FrontSide
    });
    material.needsUpdate = true;
    return material;
}

/**
 * 创建共用地面材质
 * metalness: 0.04, roughness: 0.65
 * @param {THREE.Texture|null} tex - 共用纹理贴图
 * @param {number} [colorOverride] - 可选的颜色覆盖
 */
function createGroundMaterial(tex, colorOverride) {
    if (!window.THREE) return null;
    var THREE = window.THREE;
    var material = new THREE.MeshStandardMaterial({
        map: tex || null,
        color: colorOverride || 0xffffff,
        metalness: 0.04,
        roughness: 0.65,
        side: THREE.FrontSide
    });
    material.needsUpdate = true;
    return material;
}

/**
 * 判断节点是否为金属外立面构件
 * 通过节点名称关键词匹配
 */
function isMetalFacade(meshName) {
    if (!meshName) return false;
    var name = meshName.toLowerCase();
    var metalKeywords = [
        'metal', 'facade', '窗框', '框架', 'frame',
        '幕墙', 'curtain', 'mullion', '百叶', 'louver',
        '铝', 'aluminum', '钢', 'steel', '不锈钢', 'stainless',
        'muntin', 'transom', 'panel_frame', 'window_frame',
        'glazing_bead', 'spandrel_frame'
    ];
    return metalKeywords.some(function (kw) { return name.indexOf(kw) !== -1; });
}

/**
 * 遍历GLB模型，根据节点名称区分材质类型：
 * - 金属外立面：保留GLB自带高反光材质（metalness 0.9, roughness 0.03）
 * - 墙体/地面：替换为共用贴图材质（metalness 0.04, roughness 0.65）
 * @param {THREE.Object3D} modelRoot - GLB模型根节点
 * @param {THREE.Texture|null} sharedTex - 从GLB提取的共用纹理
 */
function applyMaterialDifferentiation(modelRoot, sharedTex) {
    console.log('[applyMaterialDifferentiation] 赛博朋克镜面霓虹材质模式, modelRoot:', modelRoot ? modelRoot.type : 'null', 'children数量:', modelRoot ? modelRoot.children.length : 0);
    if (!modelRoot || !window.THREE) return;
    var THREE = window.THREE;

    var meshCount = 0;
    modelRoot.traverse(function (child) {
        if (!child.isMesh) return;
        meshCount++;
        var meshName = (child.name || '').toLowerCase();
        console.log('正在分配材质，构件名称：', child.name);

        if (!child.material) return;

        // 移除所有贴图，使用纯色PBR材质
        child.material.map = null;
        child.material.normalMap = null;
        child.material.roughnessMap = null;
        child.material.metalnessMap = null;
        child.material.aoMap = null;
        child.material.emissiveMap = null;

        // 构件类型识别（基于节点名称关键词）
        var isGlass = /\b(glass|玻璃|幕墙|curtain|glazing|glaze|glazed)\b/.test(meshName);
        var isWindowLight = /\b(window|窗户|窗$|win_|window_light|glow|发光窗)\b/.test(meshName) && !/frame|框|mullion|muntin|bead|spandrel/.test(meshName);
        var isMetalFrame = /\b(metal|facade|窗框|框架|frame|mullion|百叶|louver|铝|aluminum|钢|steel|stainless|muntin|transom|panel_frame|window_frame|glazing_bead|spandrel_frame)\b/.test(meshName);
        var isRoofEdge = /\b(roof|屋顶|楼顶|top_|edge|边缘|ledge|parapet|cap|crown|cornice|檐口)\b/.test(meshName);
        var isGround = /\b(ground|地面|floor|road|道路|street|路面|base|platform|plane|terrain|地表)\b/.test(meshName);
        var isRoadLine = /\b(line|线|stripe|marking|lane|dash|虚线|实线|标线)\b/.test(meshName);
        var isWall = /\b(wall|墙体|墙面|building|楼体|tower|塔楼|block|立面)\b/.test(meshName);

        if (isGlass) {
            // 镜面玻璃幕墙 — 强烈反射，深蓝黑底色，微蓝自发光
            child.material.color.set(0x0a1525);
            child.material.metalness = 0.96;
            child.material.roughness = 0.04;
            child.material.emissive.set(0x000a1a);
            child.material.emissiveIntensity = 0.25;
            if (child.material.envMapIntensity !== undefined) {
                child.material.envMapIntensity = 1.5;
            }
        } else if (isWindowLight) {
            // 窗户自发光 — 蓝紫/粉白/暖白/冷白随机分布，模拟楼房灯光
            var rand = Math.random();
            if (rand < 0.3) {
                // 粉白暖光
                child.material.color.set(0xfff0e8);
                child.material.emissive.set(0xffbb99);
                child.material.emissiveIntensity = 1.8;
            } else if (rand < 0.55) {
                // 蓝紫光
                child.material.color.set(0xe8e0ff);
                child.material.emissive.set(0x9977ff);
                child.material.emissiveIntensity = 2.2;
            } else if (rand < 0.75) {
                // 粉紫光
                child.material.color.set(0xffe0f0);
                child.material.emissive.set(0xff77bb);
                child.material.emissiveIntensity = 2.0;
            } else if (rand < 0.9) {
                // 冷白光
                child.material.color.set(0xf0f4ff);
                child.material.emissive.set(0xccddff);
                child.material.emissiveIntensity = 1.6;
            } else {
                // 暗窗（不发光，深色玻璃）
                child.material.color.set(0x141428);
                child.material.emissive.set(0x000000);
                child.material.emissiveIntensity = 0;
            }
            child.material.metalness = 0.05;
            child.material.roughness = 0.35;
        } else if (isMetalFrame) {
            // 金属框架 — 银灰高反光
            child.material.color.set(0x8899aa);
            child.material.metalness = 0.93;
            child.material.roughness = 0.12;
            child.material.emissive.set(0x000000);
            child.material.emissiveIntensity = 0;
        } else if (isRoofEdge) {
            // 楼顶/边缘霓虹光带 — 粉紫色发光
            child.material.color.set(0x1a1025);
            child.material.metalness = 0.88;
            child.material.roughness = 0.08;
            child.material.emissive.set(0xff2288);
            child.material.emissiveIntensity = 2.8;
        } else if (isGround) {
            // 光滑反光路面 — 镜面反射效果（浅灰色）
            child.material.color.set(0xD3D3D3);
            child.material.metalness = 0.85;
            child.material.roughness = 0.12;
            child.material.emissive.set(0x000011);
            child.material.emissiveIntensity = 0.15;
        } else if (isRoadLine) {
            // 道路标线 — 粉紫/白色发光线条
            child.material.color.set(0xffddee);
            child.material.metalness = 0.2;
            child.material.roughness = 0.25;
            child.material.emissive.set(0xff88bb);
            child.material.emissiveIntensity = 1.4;
        } else if (isWall || (!isGlass && !isWindowLight && !isMetalFrame && !isRoofEdge && !isGround && !isRoadLine)) {
            // 楼体主材质 — 高反光镜面金属，深蓝黑/冷灰/银灰随机分布
            var wallRand = Math.random();
            if (wallRand < 0.25) {
                child.material.color.set(0x151a28); // 深蓝黑
            } else if (wallRand < 0.5) {
                child.material.color.set(0x252a38); // 暗蓝灰
            } else if (wallRand < 0.75) {
                child.material.color.set(0x3a3e4e); // 冷灰
            } else {
                child.material.color.set(0x8899aa); // 银灰反光
            }
            child.material.metalness = 0.92;
            child.material.roughness = 0.06;
            child.material.emissive.set(0x000000);
            child.material.emissiveIntensity = 0;
        }

        child.material.needsUpdate = true;
        child.castShadow = true;
        child.receiveShadow = true;
    });
    console.log('[applyMaterialDifferentiation] 赛博朋克材质分配完毕，共处理mesh数量:', meshCount);
}

/**
 * 异步加载GLB城市模型（贴图/未命名.glb）
 * 使用GLTFLoader加载，应用材质区分绑定
 */
function loadCityGLB() {
    return new Promise(function (resolve, reject) {
        if (!window.THREE) return reject(new Error('THREE未加载'));
        // 兼容不同版本的GLTFLoader全局引用
        var GLTFLoaderCtor = window.GLTFLoader || (window.THREE && window.THREE.GLTFLoader);
        if (!GLTFLoaderCtor) return reject(new Error('GLTFLoader未加载'));
        var THREE = window.THREE;
        var loader = new GLTFLoaderCtor();
        var glbPath = '/static/texture/未命名.glb';
        console.log('[城市模型] 开始加载GLB: ' + glbPath);

        loader.load(
            glbPath,
            function (gltf) {
                console.log('[城市模型] GLB解析成功，提取场景根节点');
                // 兼容不同GLTFLoader版本：优先gltf.scene，回退gltf.scenes[0]
                var cityModel = gltf.scene || (gltf.scenes && gltf.scenes[0]) || null;
                if (!cityModel || !cityModel.isObject3D) {
                    console.error('[城市模型] GLB文件中未找到有效的场景对象');
                    return reject(new Error('GLB场景对象无效'));
                }
                console.log('[城市模型] 场景根节点类型: ' + (cityModel.isGroup ? 'Group' : cityModel.type));

                // 从 /static/texture/ 目录加载外部共用贴图 → 应用材质区分 → 缩放居中 → resolve
                console.log('[城市模型] GLB模型加载完成，开始加载外部共用贴图...');
                loadExternalBuildingTexture('wall_ground_shared.jpg').then(function (externalTex) {
                    sharedBuildingTex = externalTex;
                    if (sharedBuildingTex) {
                        console.log('[纹理] 外部共用贴图加载成功，执行材质绑定');
                    } else {
                        console.warn('[纹理] 外部贴图不可用，墙体/地面将使用纯色材质');
                    }
                    // 应用材质区分（墙体/地面绑定外部贴图，金属外立面保留GLB自带材质）
                    applyMaterialDifferentiation(cityModel, sharedBuildingTex);
                    console.log('[城市模型] 纹理材质绑定完成');

                    // 自动缩放居中
                    var box = new THREE.Box3().setFromObject(cityModel);
                    var size = box.getSize(new THREE.Vector3());
                    var maxDim = Math.max(size.x, size.y, size.z);
                    if (maxDim > 0) {
                        var targetSize = 30;
                        var scale = targetSize / maxDim;
                        cityModel.scale.setScalar(scale);
                    }
                    // 重新计算缩放后的包围盒，居中并落在地面上
                    box.setFromObject(cityModel);
                    var scaledCenter = box.getCenter(new THREE.Vector3());
                    cityModel.position.set(-scaledCenter.x, -box.min.y, -scaledCenter.z);
                    cityModel.name = 'cyber-city-buildings';
                    cityModel.castShadow = true;
                    cityModel.receiveShadow = true;

                    console.log('[城市模型] 缩放定位完成，包围盒尺寸: ' +
                        box.getSize(new THREE.Vector3()).x.toFixed(2) + ' x ' +
                        box.getSize(new THREE.Vector3()).y.toFixed(2) + ' x ' +
                        box.getSize(new THREE.Vector3()).z.toFixed(2));
                    resolve(cityModel);
                });
            },
            function (progress) {
                if (progress.total > 0) {
                    var pct = Math.round(progress.loaded / progress.total * 100);
                    console.log('[城市模型] 加载进度: ' + pct + '%');
                }
            },
            function (error) {
                console.error('[城市模型] GLB加载失败:', error);
                reject(error);
            }
        );
    });
}

/** 赛博朋克场景封装（增强版程序化城市，禁用GLB热替换） */
function generateCyberScene() {

    // 直接使用增强版程序化城市
    // 说明：原先此处会异步加载 /static/texture/未命名.glb 并热替换场景，
    // 但该 GLB 是无效占位文件（加载后会变成 30x30x30 大立方体覆盖整个城市），
    // 现已禁用热替换逻辑，统一走 generateCyberCity() 程序化生成。
    var group = generateCyberCity();
    console.log('[场景] 增强版程序化城市已生成（GLB热替换已禁用）');
    return group;
}

/** 草地场景 — 单一完整大地 + 浅深两色分层地坪 + 平缓起伏 + 连贯土路 + 规整点缀（纯色材质，零贴图） */
function generateGrassScene() {
    console.log("✅ 进入草地场景生成函数");
    try {
        if (!window.THREE) return null;
        const THREE = window.THREE;
        const group = new THREE.Group();
        group.name = 'grass-scene';

        const rand = (lo, hi) => lo + Math.random() * (hi - lo);
        const SIZE = 70;            // 场景边长（加大消除边界可见）
        const HALF = SIZE / 2;
        const SEGMENTS = 80;        // 地形网格细分
        const CENTER_CLEAR = 5.5;   // 中心飞机展示区清空半径

        // ========== 1. 单一大地基底（浅深两层通过半边着色实现，零镂空） ==========
        // 使用单张PlaneGeometry作为完整大地，顶点Y=0恒定，配合双材质分层
        // 底层：深色泥土基底材质（下半部）- 覆盖全部区域
        const baseGeo = new THREE.PlaneGeometry(SIZE + 4, SIZE + 4);
        baseGeo.rotateX(-Math.PI / 2);
        const baseMat = new THREE.MeshStandardMaterial({
            color: 0x6b5b3e,       // 深色泥土
            roughness: 0.96,
            metalness: 0.01,
            side: THREE.FrontSide
        });
        const baseLayer = new THREE.Mesh(baseGeo, baseMat);
        baseLayer.position.y = -0.18;
        baseLayer.receiveShadow = true;
        baseLayer.renderOrder = 0;
        group.add(baseLayer);

        // 上层：嫩绿色起伏坡地（单张完整几何体，无缝覆盖基底之上）
        const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
        terrainGeo.rotateX(-Math.PI / 2);
        const positions = terrainGeo.attributes.position;
        const heightMap = new Float32Array(positions.count);
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            // 平缓自然起伏（振幅控制在0.3~0.55，杜绝剧烈落差）
            let y = 0;
            y += 0.28 * Math.sin(x * 0.16 + z * 0.13) * Math.cos(z * 0.15 - x * 0.10);
            y += 0.17 * Math.sin(x * 0.35 - z * 0.28) * Math.cos(z * 0.32 + x * 0.24);
            y += 0.10 * Math.sin(x * 0.60 + z * 0.52) * Math.cos(z * 0.48 - x * 0.40);
            y += 0.06 * Math.sin(x * 1.10) * Math.cos(z * 1.00);
            // 中心缓坡台地（飞机展示区微抬）
            const dist = Math.sqrt(x * x + z * z);
            if (dist < 8) y += (1 - dist / 8) * 0.14;
            // 边缘柔和过渡到基底，无硬切边
            const edgeX = 1 - Math.pow(Math.abs(x) / HALF, 1.8);
            const edgeZ = 1 - Math.pow(Math.abs(z) / HALF, 1.8);
            const edgeFade = Math.max(0.08, Math.min(1, edgeX)) * Math.max(0.08, Math.min(1, edgeZ));
            y *= edgeFade;
            positions.setY(i, y);
            heightMap[i] = y;
        }
        terrainGeo.computeVertexNormals();
        const grassMat = new THREE.MeshStandardMaterial({
            color: 0x7a9a4c,       // 暖橄榄绿色草地（柔和不刺眼）
            roughness: 0.84,
            metalness: 0.02,
            side: THREE.FrontSide
        });
        const terrain = new THREE.Mesh(terrainGeo, grassMat);
        terrain.renderOrder = 1;
        terrain.receiveShadow = true;
        terrain.castShadow = true;
        group.add(terrain);

        // ========== 2. 连贯弯曲土路（灰褐色，贴合地形无缝隙） ==========
        const pathPoints = [
            { x: -HALF + 3, z: HALF * 0.25 },
            { x: -HALF + 10, z: HALF * 0.42 },
            { x: -HALF + 17, z: HALF * 0.18 },
            { x: -HALF + 23, z: -HALF * 0.08 },
            { x: -HALF + 29, z: -HALF * 0.22 },
            { x: -HALF + 35, z: -HALF * 0.06 },
            { x: -HALF + 41, z: HALF * 0.12 },
            { x: -HALF + 49, z: HALF * 0.02 },
            { x: -HALF + 56, z: -HALF * 0.18 }
        ];

        function sampleHeight(px, pz) {
            const gx = (px + HALF) / SIZE * SEGMENTS;
            const gz = (pz + HALF) / SIZE * SEGMENTS;
            const ix = Math.min(SEGMENTS - 1, Math.max(0, Math.floor(gx)));
            const iz = Math.min(SEGMENTS - 1, Math.max(0, Math.floor(gz)));
            const fx = gx - ix, fz = gz - iz;
            const ixn = Math.min(SEGMENTS, ix + 1), izn = Math.min(SEGMENTS, iz + 1);
            const idx = SEGMENTS + 1;
            const h00 = heightMap[iz * idx + ix] || 0;
            const h10 = heightMap[iz * idx + ixn] || 0;
            const h01 = heightMap[izn * idx + ix] || 0;
            const h11 = heightMap[izn * idx + ixn] || 0;
            return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
        }
        function getPathPos(t) {
            const n = pathPoints.length - 1;
            const raw = t * n;
            const idx = Math.min(n - 1, Math.floor(raw));
            const frac = raw - idx;
            const p0 = pathPoints[idx], p1 = pathPoints[idx + 1];
            return { x: p0.x + (p1.x - p0.x) * frac, z: p0.z + (p1.z - p0.z) * frac };
        }
        function getPathDir(t) {
            const dt = 0.0005;
            const pa = getPathPos(Math.max(0, t - dt));
            const pb = getPathPos(Math.min(1, t + dt));
            const dx = pb.x - pa.x, dz = pb.z - pa.z;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            return { dx: dx / len, dz: dz / len };
        }
        // 精确计算路径总长
        let totalLen = 0;
        const SAMPLES = 600;
        let prev = getPathPos(0);
        for (let s = 1; s <= SAMPLES; s++) {
            const cur = getPathPos(s / SAMPLES);
            totalLen += Math.sqrt((cur.x - prev.x) ** 2 + (cur.z - prev.z) ** 2);
            prev = cur;
        }

        const PATH_WIDTH = 1.8;
        const SEG_COUNT = Math.round(totalLen / 0.5);
        const segLen = totalLen / SEG_COUNT;
        const OVERLAP = 1.04; // 段间重叠系数，确保零缝隙

        const pathMat = new THREE.MeshStandardMaterial({
            color: 0x8b7355, roughness: 0.94, metalness: 0.02
        });
        const pathEdgeMat = new THREE.MeshStandardMaterial({
            color: 0x6b5640, roughness: 0.90, metalness: 0.03
        });

        const pathCenterline = [];
        const pathTangents = [];

        for (let i = 0; i < SEG_COUNT; i++) {
            const t = i / SEG_COUNT;
            const pt = getPathPos(t);
            const h = sampleHeight(pt.x, pt.z);
            const dir = getPathDir(t);
            pathCenterline.push({ x: pt.x, z: pt.z });
            pathTangents.push(dir);
            const angle = Math.atan2(dir.dx, dir.dz);
            // 路面
            const geo = new THREE.BoxGeometry(segLen * OVERLAP, 0.07, PATH_WIDTH);
            const seg = new THREE.Mesh(geo, pathMat);
            seg.position.set(pt.x, h + 0.08, pt.z);
            seg.rotation.y = angle;
            seg.renderOrder = 2;
            seg.receiveShadow = true;
            seg.castShadow = true;
            group.add(seg);
            // 路缘
            const edgeGeo = new THREE.BoxGeometry(segLen * OVERLAP, 0.09, 0.18);
            for (let s = -1; s <= 1; s += 2) {
                const edge = new THREE.Mesh(edgeGeo, pathEdgeMat);
                edge.position.set(pt.x, h + 0.09, pt.z + s * (PATH_WIDTH / 2 + 0.03));
                edge.rotation.y = angle;
                edge.receiveShadow = true;
                group.add(edge);
            }
        }

        // ========== 3. 石块 — 沿道路两侧等距排布 ==========
        const stoneMatA = new THREE.MeshStandardMaterial({ color: 0xb0a590, roughness: 0.68, metalness: 0.05 });
        const stoneMatB = new THREE.MeshStandardMaterial({ color: 0x9c9078, roughness: 0.70, metalness: 0.06 });
        const stoneCount = 36;
        for (let i = 0; i < stoneCount; i++) {
            const t = i / stoneCount;
            const idx = Math.floor(t * (pathCenterline.length - 1));
            const pc = pathCenterline[idx];
            const dir = pathTangents[idx];
            const side = i % 2 === 0 ? 1 : -1;
            const off = PATH_WIDTH / 2 + rand(0.4, 2.5);
            const sx = pc.x + dir.dz * side * off;
            const sz = pc.z - dir.dx * side * off;
            if (Math.sqrt(sx * sx + sz * sz) < CENTER_CLEAR) continue;
            const sh = sampleHeight(sx, sz);
            const geo = new THREE.IcosahedronGeometry(rand(0.12, 0.35), 0);
            const stone = new THREE.Mesh(geo, i % 2 === 0 ? stoneMatA : stoneMatB);
            stone.position.set(sx, sh + rand(0.03, 0.08), sz);
            stone.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
            stone.scale.setScalar(rand(0.7, 1.15));
            stone.receiveShadow = true;
            stone.castShadow = true;
            group.add(stone);
        }

        // ========== 4. 木栈道 — 沿道路外侧等距排布 ==========
        const boardGeo = new THREE.BoxGeometry(0.35, 0.04, 1.1);
        const boardMat = new THREE.MeshStandardMaterial({
            color: 0xb8956e, roughness: 0.62, metalness: 0.05
        });
        const boardCount = 28;
        for (let i = 0; i < boardCount; i++) {
            const t = i / boardCount;
            const idx = Math.floor(t * (pathCenterline.length - 1));
            const pc = pathCenterline[idx];
            const dir = pathTangents[idx];
            const side = i % 4 < 2 ? 1 : -1;
            const off = PATH_WIDTH / 2 + rand(0.6, 2.2);
            const bx = pc.x + dir.dz * side * off;
            const bz = pc.z - dir.dx * side * off;
            if (Math.sqrt(bx * bx + bz * bz) < CENTER_CLEAR) continue;
            const bh = sampleHeight(bx, bz);
            const board = new THREE.Mesh(boardGeo, boardMat);
            board.position.set(bx, bh + 0.08, bz);
            board.rotation.y = Math.atan2(dir.dx, dir.dz);
            board.receiveShadow = true;
            board.castShadow = true;
            group.add(board);
        }

        // ========== 5. 灌木丛 — 沿道路两侧集中排布 ==========
        const bushGeo = new THREE.SphereGeometry(0.25, 7, 5);
        const bushCount = 50;
        for (let i = 0; i < bushCount; i++) {
            const t = i / bushCount;
            const idx = Math.floor(t * (pathCenterline.length - 1));
            const pc = pathCenterline[idx];
            const dir = pathTangents[idx];
            const side = i % 2 === 0 ? 1 : -1;
            const off = PATH_WIDTH / 2 + rand(0.5, 3.2);
            const bx = pc.x + dir.dz * side * off;
            const bz = pc.z - dir.dx * side * off;
            if (Math.sqrt(bx * bx + bz * bz) < CENTER_CLEAR) continue;
            const bh = sampleHeight(bx, bz);
            const shade = rand(0.6, 1.0);
            const mat = new THREE.MeshStandardMaterial({
                color: new THREE.Color().setHSL(0.20 + rand(-0.04, 0.04), 0.55, 0.16 + shade * 0.24),
                roughness: 0.82,
                metalness: 0
            });
            const bush = new THREE.Mesh(bushGeo, mat);
            bush.position.set(bx, bh + rand(0.1, 0.24), bz);
            bush.scale.set(rand(0.5, 1.3), rand(0.3, 0.65), rand(0.5, 1.3));
            bush.castShadow = true;
            bush.receiveShadow = true;
            group.add(bush);
        }

        // ========== 6. 多色几何小花 — 沿道路两侧密集点缀 ==========
        const flowerColors = [0xff8855, 0xffc844, 0xff5577, 0xee9955, 0xffaa66, 0xeedd55, 0xff7766, 0xf0bb55, 0xff9966, 0xddcc55];
        const flowerTypes = [
            () => new THREE.ConeGeometry(0.06, 0.18, 5, 1),       // 锥形花
            () => new THREE.SphereGeometry(0.07, 4, 3),            // 球形花
            () => new THREE.DodecahedronGeometry(0.06, 0),          // 五边形花
            () => new THREE.IcosahedronGeometry(0.055, 0),          // 三角面花
        ];
        const flowerCount = 60;
        for (let i = 0; i < flowerCount; i++) {
            const t = i / flowerCount;
            const idx = Math.floor(t * (pathCenterline.length - 1));
            const pc = pathCenterline[idx];
            const dir = pathTangents[idx];
            const side = i % 3 === 0 ? 1 : -1;
            const off = PATH_WIDTH / 2 + rand(0.5, 3.5);
            const fx = pc.x + dir.dz * side * off;
            const fz = pc.z - dir.dx * side * off;
            if (Math.sqrt(fx * fx + fz * fz) < CENTER_CLEAR) continue;
            const fh = sampleHeight(fx, fz);
            const geoFn = flowerTypes[i % flowerTypes.length];
            const geo = geoFn();
            const mat = new THREE.MeshStandardMaterial({
                color: flowerColors[i % flowerColors.length],
                roughness: 0.35,
                metalness: 0.05
            });
            const flower = new THREE.Mesh(geo, mat);
            flower.position.set(fx, fh + rand(0.10, 0.22), fz);
            flower.rotation.set(rand(-0.3, 0.3), rand(0, Math.PI * 2), rand(-0.3, 0.3));
            flower.scale.setScalar(rand(0.7, 1.4));
            flower.castShadow = false;
            flower.receiveShadow = true;
            group.add(flower);
        }

        // ========== 7. 小土坡 — 场景外围环状分布 ==========
        const moundMat = new THREE.MeshStandardMaterial({
            color: 0x6b8a3c, roughness: 0.86, metalness: 0.02
        });
        const moundMatA = new THREE.MeshStandardMaterial({
            color: 0x7a944a, roughness: 0.84, metalness: 0.02
        });
        const moundCount = 10;
        for (let i = 0; i < moundCount; i++) {
            const angle = (i / moundCount) * Math.PI * 2 + rand(-0.15, 0.15);
            const radius = rand(13, HALF - 3);
            const mx = Math.cos(angle) * radius;
            const mz = Math.sin(angle) * radius;
            const mh = sampleHeight(mx, mz);
            const moundR = rand(1.0, 2.5);
            const geo = new THREE.SphereGeometry(moundR, 10, 6, 0, Math.PI * 2, 0, Math.PI / 3);
            const mound = new THREE.Mesh(geo, i % 2 === 0 ? moundMat : moundMatA);
            mound.position.set(mx, mh - moundR * 0.4, mz);
            mound.scale.y = rand(0.3, 0.5);
            mound.receiveShadow = true;
            mound.castShadow = true;
            group.add(mound);
        }

        // ========== 8. 低多边形山脉 — 主峰+次峰结构，深/中/浅米黄三层坡面纯色 ==========
        // 坡面材质：山顶陡坡（深米黄）→ 山腰缓坡（中米黄）→ 山脚坡面（浅米黄）
        const matTopSteep = new THREE.MeshStandardMaterial({ color: 0xBFA67A, roughness: 0.72, metalness: 0.01 });   // 深米黄 — 山顶陡坡
        const matMidModerate = new THREE.MeshStandardMaterial({ color: 0xD4C4A8, roughness: 0.76, metalness: 0.01 }); // 中米黄 — 山腰缓坡
        const matFootGentle = new THREE.MeshStandardMaterial({ color: 0xE8DCC0, roughness: 0.82, metalness: 0.01 });  // 浅米黄 — 山脚坡面
        const matFootBlend = new THREE.MeshStandardMaterial({ color: 0xDDD0B4, roughness: 0.85, metalness: 0.01 });   // 过渡浅米 — 山脚外延

        /**
         * 构建单座低多边形主峰：三层截锥堆叠，模拟山顶陡坡→山腰缓坡→山脚坡面
         * @param {number} totalH - 山峰总高度
         * @param {number} baseR - 山脚底面半径
         * @param {number} facets - 多边形面数（6~8为低多边形）
         * @param {Object} offset - 山峰相对群组原点偏移 {x, z}
         * @returns {THREE.Group} 包含三层截锥的山峰组
         */
        function buildMountainPeak(totalH, baseR, facets, offset) {
            const peakGroup = new THREE.Group();
            // 三层高度比例：山顶陡坡15% / 山腰缓坡35% / 山脚坡面50%
            const hTop = totalH * 0.15;
            const hMid = totalH * 0.35;
            const hFoot = totalH * 0.50;
            // 半径过渡：山顶→山腰→山脚
            const rTop = baseR * 0.08;      // 山顶微小半径
            const rMidTop = baseR * 0.32;   // 山腰顶部半径
            const rFootTop = baseR * 0.68;  // 山脚顶部半径
            // 山顶段（陡峭锥体，深米黄）
            const geoSeg1 = new THREE.CylinderGeometry(rTop, rMidTop, hTop, facets, 1);
            const seg1 = new THREE.Mesh(geoSeg1, matTopSteep);
            seg1.position.y = hFoot + hMid + hTop / 2;
            seg1.castShadow = true;
            seg1.receiveShadow = true;
            peakGroup.add(seg1);
            // 山腰段（缓坡锥台，中米黄）
            const geoSeg2 = new THREE.CylinderGeometry(rMidTop, rFootTop, hMid, facets, 1);
            const seg2 = new THREE.Mesh(geoSeg2, matMidModerate);
            seg2.position.y = hFoot + hMid / 2;
            seg2.castShadow = true;
            seg2.receiveShadow = true;
            peakGroup.add(seg2);
            // 山脚段（宽阔坡面，浅米黄）
            const geoSeg3 = new THREE.CylinderGeometry(rFootTop, baseR, hFoot, facets, 1);
            const seg3 = new THREE.Mesh(geoSeg3, matFootGentle);
            seg3.position.y = hFoot / 2;
            seg3.castShadow = true;
            seg3.receiveShadow = true;
            peakGroup.add(seg3);
            // 应用水平偏移
            if (offset) {
                peakGroup.position.x = offset.x || 0;
                peakGroup.position.z = offset.z || 0;
            }
            return peakGroup;
        }

        /**
         * 构建山脚外延裙边（宽矮锥台，与草地自然融合）
         * @param {number} innerR - 内半径（≈baseR）
         * @param {number} outerR - 外半径
         * @param {number} h - 裙边高度
         * @param {number} facets - 面数
         */
        function buildFootSkirt(innerR, outerR, h, facets) {
            const skirtGeo = new THREE.CylinderGeometry(innerR, outerR, h, facets, 1);
            const skirt = new THREE.Mesh(skirtGeo, matFootBlend);
            skirt.position.y = h / 2;
            skirt.receiveShadow = true;
            skirt.castShadow = true;
            return skirt;
        }

        // ── 山脉定义：4座山，每座含主峰 + 0~2座次峰 ──
        const mountainDefs = [
            {   // 山① — 最西侧大山，主峰高+次峰右后
                pos: { x: -22, z: -22 },
                main: { h: 14, r: 6.5, facets: 6 },
                subs: [
                    { h: 8, r: 3.8, facets: 6, offset: { x: 4.5, z: -3.5 } },
                    { h: 5.5, r: 2.6, facets: 5, offset: { x: -3.0, z: -4.0 } },
                ],
            },
            {   // 山② — 中间偏左，次峰左前
                pos: { x: -8, z: -26 },
                main: { h: 16, r: 7.2, facets: 7 },
                subs: [
                    { h: 9, r: 4.5, facets: 6, offset: { x: -4.5, z: 2.0 } },
                ],
            },
            {   // 山③ — 中间偏右，单峰突起
                pos: { x: 8, z: -26 },
                main: { h: 10, r: 5.0, facets: 6 },
                subs: [
                    { h: 6, r: 3.2, facets: 5, offset: { x: 3.5, z: 2.5 } },
                    { h: 4, r: 2.2, facets: 5, offset: { x: -2.5, z: -3.0 } },
                ],
            },
            {   // 山④ — 最东侧，主峰+次峰左后方
                pos: { x: 22, z: -22 },
                main: { h: 12, r: 6.0, facets: 6 },
                subs: [
                    { h: 7.5, r: 3.5, facets: 6, offset: { x: -4.0, z: -3.0 } },
                ],
            },
        ];

        for (let i = 0; i < mountainDefs.length; i++) {
            const mtn = mountainDefs[i];
            const pos = mtn.pos;
            const mtnGroup = new THREE.Group();

            // 构建主峰
            const mainPeak = buildMountainPeak(mtn.main.h, mtn.main.r, mtn.main.facets, null);
            mtnGroup.add(mainPeak);

            // 构建次峰（每座偏离主峰中心，形成山脉轮廓）
            for (let s = 0; s < mtn.subs.length; s++) {
                const sub = mtn.subs[s];
                const subPeak = buildMountainPeak(sub.h, sub.r, sub.facets, sub.offset);
                // 次峰整体略低于主峰比例，通过调整Y偏移使山脚对齐
                subPeak.position.y = -0.15;
                mtnGroup.add(subPeak);
            }

            // 主峰底部裙边（宽矮锥台，与草地柔顺衔接）
            const skirtOuterR = mtn.main.r * 1.55;
            const skirtH = mtn.main.h * 0.08;
            const mainSkirt = buildFootSkirt(mtn.main.r * 0.92, skirtOuterR, skirtH, mtn.main.facets + 4);
            mtnGroup.add(mainSkirt);

            mtnGroup.position.set(pos.x, -0.35, pos.z);
            group.add(mtnGroup);

            // 山脚点缀石块与草丛（保留原逻辑，适配新的主峰半径）
            const footR = mtn.main.r * 1.3;
            const footCount = 10 + i * 2;
            for (let r = 0; r < footCount; r++) {
                const angle = (r / footCount) * Math.PI * 2 + Math.random() * 0.3;
                const rad = footR + Math.random() * mtn.main.r * 0.8;
                const rx = pos.x + Math.cos(angle) * rad;
                const rz = pos.z + Math.sin(angle) * rad;
                const rh = sampleHeight(rx, rz);
                if (r % 3 === 0) {
                    // 山脚落石（深米灰色调）
                    const rockGeo = new THREE.IcosahedronGeometry(rand(0.22, 0.60), 0);
                    const rockMat = new THREE.MeshStandardMaterial({
                        color: r % 2 === 0 ? 0xB0A090 : 0x9C8C7C,
                        roughness: 0.72, metalness: 0.04
                    });
                    const rock = new THREE.Mesh(rockGeo, rockMat);
                    rock.position.set(rx, rh + rand(0.05, 0.20), rz);
                    rock.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
                    rock.scale.setScalar(rand(0.55, 1.15));
                    rock.castShadow = true;
                    rock.receiveShadow = true;
                    group.add(rock);
                } else {
                    // 山脚草簇（浅米绿色锥体）
                    const grassGeo = new THREE.ConeGeometry(rand(0.12, 0.28), rand(0.22, 0.55), 5, 1);
                    const grassClump = new THREE.Mesh(grassGeo, matFootGentle);
                    grassClump.position.set(rx, rh + rand(0.02, 0.12), rz);
                    grassClump.rotation.set(rand(-0.12, 0.12), rand(0, Math.PI * 2), rand(-0.12, 0.12));
                    grassClump.castShadow = true;
                    grassClump.receiveShadow = true;
                    group.add(grassClump);
                }
            }
        }

        console.log("✅ 草地场景生成完成（单一完整大地+浅深分层+平缓起伏+连贯土路+规整点缀）");
        return group;
    } catch (e) {
        console.error("❌ generateGrassScene 执行异常:", e.message, e.stack);
        return null;
    }
}

/** 湖面场景（反光水面、湖岸绿植、水上浮台） */
function generateLakeScene() {
    console.log("✅ 进入湖面场景生成函数");
    try {
        if (!window.THREE) return null;
        const THREE = window.THREE;
        const group = new THREE.Group();
        group.name = 'lake-scene';

        const rand = (lo, hi) => lo + Math.random() * (hi - lo);

        // 湖岸草地（环形地面）
        const shoreGeo = new THREE.RingGeometry(4, 30, 64);
        const shoreMat = new THREE.MeshStandardMaterial({
            color: 0x5a8f4a,
            roughness: 0.85,
            metalness: 0.02,
            side: THREE.DoubleSide
        });
        const shore = new THREE.Mesh(shoreGeo, shoreMat);
        shore.rotation.x = -Math.PI / 2;
        shore.position.y = -0.02;
        shore.receiveShadow = true;
        group.add(shore);

        // 反射水面（中心镜面湖泊）
        const waterGeo = new THREE.CircleGeometry(8, 64);
        const waterMat = new THREE.MeshStandardMaterial({
            color: 0x4488cc,
            roughness: 0.08,
            metalness: 0.95,
            transparent: true,
            opacity: 0.75
        });
        const water = new THREE.Mesh(waterGeo, waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.0;
        water.receiveShadow = true;
        group.add(water);

        // 水下暗底（增加深度感）
        const deepGeo = new THREE.CircleGeometry(7, 64);
        const deepMat = new THREE.MeshStandardMaterial({
            color: 0x0a2a4a,
            roughness: 0.5,
            metalness: 0.3,
            transparent: true,
            opacity: 0.6
        });
        const deep = new THREE.Mesh(deepGeo, deepMat);
        deep.rotation.x = -Math.PI / 2;
        deep.position.y = -0.4;
        group.add(deep);

        // 湖岸绿植（灌木丛 + 小树）
        const bushGeo = new THREE.SphereGeometry(0.25, 8, 6);
        for (let i = 0; i < 50; i++) {
            const angle = rand(0, Math.PI * 2);
            const radius = rand(10, 28);
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const shade = rand(0.5, 1.0);
            const bushMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color().setHSL(0.2 + rand(-0.08, 0.08), 0.65, 0.18 + shade * 0.3),
                roughness: 0.85,
                metalness: 0
            });
            const bush = new THREE.Mesh(bushGeo, bushMat);
            bush.position.set(x, rand(0.1, 0.25), z);
            bush.scale.set(rand(0.6, 2.0), rand(0.3, 1.0), rand(0.6, 2.0));
            bush.castShadow = true;
            bush.receiveShadow = true;
            group.add(bush);
        }

        // 岸边小型树木
        const trunkGeo = new THREE.CylinderGeometry(0.08, 0.12, 1.5, 8);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.7, metalness: 0.05 });
        const foliageGeo = new THREE.ConeGeometry(0.5, 1.2, 8, 4);
        const foliageMat = new THREE.MeshStandardMaterial({ color: 0x3d7a28, roughness: 0.8, metalness: 0 });
        for (let i = 0; i < 20; i++) {
            const angle = rand(0, Math.PI * 2);
            const radius = rand(13, 26);
            const treeGroup = new THREE.Group();
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.y = 0.75;
            trunk.castShadow = true;
            treeGroup.add(trunk);
            const foliage = new THREE.Mesh(foliageGeo, foliageMat);
            foliage.position.y = 1.7;
            foliage.castShadow = true;
            treeGroup.add(foliage);
            treeGroup.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
            treeGroup.scale.setScalar(rand(0.7, 1.4));
            group.add(treeGroup);
        }

        // 水上浮台（中心木质平台）
        const platformGeo = new THREE.BoxGeometry(3, 0.2, 3);
        const platformMat = new THREE.MeshStandardMaterial({
            color: 0x8b6914,
            roughness: 0.6,
            metalness: 0.1
        });
        const platform = new THREE.Mesh(platformGeo, platformMat);
        platform.position.y = 0.3;
        platform.castShadow = true;
        platform.receiveShadow = true;
        group.add(platform);

        // 浮台围栏柱
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8);
            const post = new THREE.Mesh(postGeo, trunkMat);
            post.position.set(Math.cos(angle) * 1.4, 1.1, Math.sin(angle) * 1.4);
            post.castShadow = true;
            group.add(post);
        }

        // 湖面波光浮动粒子
        const particleGeo = new THREE.SphereGeometry(0.05, 4, 2);
        const particleMat = new THREE.MeshStandardMaterial({
            color: 0x88ddff,
            roughness: 0.1,
            metalness: 0.9,
            emissive: 0x224466,
            emissiveIntensity: 0.4
        });
        for (let i = 0; i < 80; i++) {
            const p = new THREE.Mesh(particleGeo, particleMat);
            p.position.set(rand(-7, 7), 0.03, rand(-7, 7));
            group.add(p);
        }

        console.log("✅ 湖面场景生成完成");
        return group;
    } catch (e) {
        console.error("❌ generateLakeScene 执行异常:", e.message, e.stack);
        return null;
    }
}

/**
 * window.forceBuildCity()
 * 全局强制生成函数：手动调用 generateCyberCity 并弹窗提示结果
 * 用法：在浏览器控制台输入 forceBuildCity()
 */
window.forceBuildCity = function () {
    if (!window.THREE) {
        alert('❌ Three.js 未加载，请等待页面完全加载后再试');
        return null;
    }
    var viewer = window._3dViewer;
    if (!viewer || !viewer.scene) {
        alert('❌ 3D场景未初始化，请先打开3D查看器');
        return null;
    }
    var result = generateCyberCity();
    if (result) {
        viewer.scene.add(result);
        alert('✅ 已强制生成12栋赛博朋克楼房！\n查看场景右侧（X轴正方向）');
    } else {
        alert('❌ 生成失败，请查看控制台错误信息');
    }
    return result;
};

// ═══════════════════════════════════════════════════════════
// 跨模块联动函数 - 3D模型↔知识库↔竞答
// ═══════════════════════════════════════════════════════════

/**
 * knowledgeId → 3D模型名称映射表
 * 将知识库知识点ID映射到对应的3D模型关键词
 */
var KB_TO_MODEL_MAP = {
    // 民航机型 aircraft_types
    'kb001': 'boeing 737',      // 波音737系列发展概述
    'kb002': 'a320',            // 数字电传操纵（Fly-by-Wire）→ AirBus A320相关
    'kb003': 'c919',            // C919大型客机
    'kb004': 'boeing 787',      // 波音787 Dreamliner
    'kb005': 'arj',             // ARJ21新支线飞机
    'kb006': 'c929',            // C929宽体远程客机
    'kb007': 'arj',             // ARJ21衍生型号
    'kb008': 'ccar',            // CCAR-25部结构适航要求
    // 飞行器结构 aircraft_structure
    'kb009': 'airframe',        // 飞行器结构
    'kb010': 'wing',            // 机翼
    'kb011': 'fuselage',        // 机身
    'kb012': 'landing gear',    // 起落架
    'kb013': 'tail',            // 尾翼
    'kb014': 'composite',       // 复合材料
    // 航发知识 engine
    'kb015': 'engine',          // 涡扇发动机
    'kb016': 'engine',          // 涡喷发动机
    'kb017': 'engine',          // 涡桨发动机
    'kb018': 'engine',          // 活塞发动机
    'kb019': 'engine',          // 冲压发动机
    'kb020': 'apu',             // APU
    // 适航标准 airworthiness
    'kb021': 'airworthiness',   // 适航标准
    'kb022': 'fatigue',         // 疲劳与损伤容限
    'kb023': 'flight test',     // 飞行试验
    'kb024': 'certification',   // 型号合格审定
    'kb025': 'maintenance',     // 持续适航
    // 航空法规 regulations
    'kb026': 'regulation',      // ICAO
    'kb027': 'regulation',      // CAAC
    'kb028': 'regulation',      // FAA EASA
    'kb029': 'regulation',      // SARPs
    'kb030': 'regulation'       // 适航指令
};

/**
 * 根据knowledgeId导航到3D模型查看器
 * 先加载knowledgeId对应的知识点详细信息，匹配最接近的3D模型
 */
window.navigateTo3DModel = function (knowledgeId) {
    var searchKeyword = KB_TO_MODEL_MAP[knowledgeId] || knowledgeId;
    // 切换到3D查看器tab
    if (window.switchToTab) {
        window.switchToTab('gallery');
    }
    // 尝试在3D模型列表中查找匹配的模型
    setTimeout(function () {
        if (window._3dModels && window._3dModels.length > 0) {
            var found = findModelByKeyword(searchKeyword, window._3dModels);
            if (found) {
                // 加载并高亮该模型
                if (window.loadModel && typeof window.loadModel === 'function') {
                    window.loadModel(found.path || found.name);
                }
                if (window.highlightModelCard && typeof window.highlightModelCard === 'function') {
                    window.highlightModelCard(found.name);
                }
            } else {
                console.log('[3D Nav] 未找到匹配模型: ' + searchKeyword + '，尝试模糊匹配...');
                var fuzzyFound = fuzzyMatchModel(searchKeyword, window._3dModels);
                if (fuzzyFound && window.loadModel) {
                    window.loadModel(fuzzyFound.path || fuzzyFound.name);
                }
            }
        }
    }, 500);

    // 如果知识点数据可用，显示悬浮知识卡片
    if (window.showModelKBPopup && typeof window.showModelKBPopup === 'function') {
        window.showModelKBPopup(knowledgeId);
    }
};

/**
 * 从quiz模块导航到quiz并筛选分类
 */
window.navigateToQuizWithCategory = function (category) {
    if (window.switchToTab) {
        window.switchToTab('quiz');
    }
    setTimeout(function () {
        if (window.quizFilterByCategory && typeof window.quizFilterByCategory === 'function') {
            window.quizFilterByCategory(category);
        }
        if (window.quizSwitchCategory && typeof window.quizSwitchCategory === 'function') {
            window.quizSwitchCategory(category);
        }
    }, 300);
};

/** 在模型列表中按关键词查找模型 */
function findModelByKeyword(keyword, models) {
    if (!keyword || !models) return null;
    var kw = keyword.toLowerCase();
    // 精确匹配名称
    for (var i = 0; i < models.length; i++) {
        var name = (models[i].name || '').toLowerCase();
        var path = (models[i].path || '').toLowerCase();
        if (name.indexOf(kw) >= 0 || path.indexOf(kw) >= 0) {
            return models[i];
        }
    }
    return null;
}

/** 模糊匹配模型名称（拆分关键词逐步匹配） */
function fuzzyMatchModel(keyword, models) {
    if (!keyword || !models || models.length === 0) return null;
    var kw = keyword.toLowerCase();
    // 拆分为单词数组
    var words = kw.split(/[\s\-_]+/).filter(function (w) { return w.length > 1; });
    // 尝试匹配包含最多关键词的模型
    var bestMatch = null;
    var bestScore = 0;
    for (var i = 0; i < models.length; i++) {
        var name = (models[i].name || '').toLowerCase();
        var score = 0;
        for (var j = 0; j < words.length; j++) {
            if (name.indexOf(words[j]) >= 0) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = models[i];
        }
    }
    return bestMatch;
}

/**
 * 显示3D模型上的知识点悬浮卡片（点击模型后弹出）
 */
window.show3DModelKBCard = function (knowledgeId) {
    if (!knowledgeId) return;
    // 先加载知识点数据
    fetch('/api/quiz/knowledge')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data || !data.knowledge_items) return;
            var item = data.knowledge_items.find(function (k) { return k.id === knowledgeId; });
            if (!item) return;
            // 创建或获取悬浮卡片
            var card = document.getElementById('model-kb-floating-card');
            if (!card) {
                card = document.createElement('div');
                card.id = 'model-kb-floating-card';
                card.className = 'model-kb-floating-card';
                document.body.appendChild(card);
            }
            var catMap = { 'aircraft_types': '民航机型', 'aircraft_structure': '飞行器结构', 'airworthiness': '航空适航标准', 'engine': '航发知识', 'regulations': '航空行业法规' };
            var catDisplay = catMap[item.category] || item.category;
            card.innerHTML =
                '<div class="mkb-header">' +
                '<span class="mkb-cat">' + catDisplay + '</span>' +
                '<span class="mkb-title">' + (item.title || '') + '</span>' +
                '<button class="mkb-close" onclick="window.closeModelKBCard()">✕</button>' +
                '</div>' +
                '<div class="mkb-body">' + (item.content || '').substring(0, 300) + (item.content && item.content.length > 300 ? '...' : '') + '</div>' +
                '<div class="mkb-source">来源: ' + (item.source || '') + '</div>' +
                '<div class="mkb-actions">' +
                '<button class="mkb-btn quiz-btn" onclick="window.navigateToQuizWithCategory(\'' + (item.category || '') + '\')">🏆 前往刷题</button>' +
                '</div>';
            card.style.display = 'block';
        })
        .catch(function (err) {
            console.error('[3D KB Card] 加载知识点失败:', err);
        });
};

window.closeModelKBCard = function () {
    var card = document.getElementById('model-kb-floating-card');
    if (card) card.style.display = 'none';
};

