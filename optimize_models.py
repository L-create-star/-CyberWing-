"""
批量优化 static/models/ 目录下的 .glb 文件
使用 trimesh 库：
- 合并重复面
- 修复法线
- 应用所有变换（位置/旋转/缩放）
- 导出为优化后的 .glb 文件
"""

import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "static" / "models"


def optimize_glb(filepath: Path) -> bool:
    """
    优化单个 .glb 文件，原地覆盖
    返回 True 表示成功，False 表示失败/跳过
    """
    try:
        import trimesh

        # 1. 加载场景
        scene = trimesh.load(str(filepath), force="scene")

        # 2. 如果返回的是场景，合并所有几何体
        if isinstance(scene, trimesh.Scene):
            meshes = []
            for name, geom in scene.geometry.items():
                if isinstance(geom, trimesh.Trimesh):
                    # 应用该节点的变换矩阵（如果场景中有变换信息）
                    if hasattr(scene, "graph") and name in scene.graph:
                        node_data = scene.graph[name]
                        # trimesh 4.x 返回 tuple (matrix, geometry_name) 或 dict
                        if isinstance(node_data, (tuple, list)):
                            transform = node_data[0]
                        elif isinstance(node_data, dict):
                            transform = node_data.get("matrix", None)
                        else:
                            transform = node_data
                        if transform is not None:
                            import numpy as np
                            transform = np.asarray(transform)
                            is_identity = np.allclose(transform, np.eye(4))
                            if not is_identity:
                                geom = geom.copy()
                                geom.apply_transform(transform)
                    meshes.append(geom)
                elif isinstance(geom, trimesh.PointCloud):
                    # 点云也尝试合并（可选）
                    pass

            if not meshes:
                print(f"  [SKIP] {filepath.name}: 场景中无可合并的网格")
                return False

            # 合并所有网格为一个
            merged = trimesh.util.concatenate(meshes)
        elif isinstance(scene, trimesh.Trimesh):
            merged = scene
        else:
            print(f"  [SKIP] {filepath.name}: 不支持的类型 {type(scene)}")
            return False

        # 3. 合并重复顶点
        if merged.vertices.shape[0] > 0:
            merged.merge_vertices()
            # 删除退化面（面积为0的面）
            merged.update_faces(merged.nondegenerate_faces())
            # 删除重复面
            merged.update_faces(merged.unique_faces())

        # 4. 修复法线
        if merged.vertices.shape[0] > 0:
            # 修复不一致的法线方向
            merged.fix_normals()
            # 重新计算顶点法线
            merged.vertex_normals = None  # 强制重新计算
            _ = merged.vertex_normals  # 触发计算
            # 修复面法线
            merged.face_normals = None
            _ = merged.face_normals

        # 5. 应用所有剩余的变换（确保几何体在世界坐标系中）
        # trimesh.util.concatenate 已将变换应用到顶点，此处确保单位矩阵
        # 单位矩阵意味着没有额外变换

        # 6. 导出为 .glb（二进制 glTF 2.0）
        # 将合并后的单个网格包装成场景导出
        export_scene = trimesh.Scene(merged)
        export_scene.export(filepath, file_type="glb")

        return True

    except Exception as e:
        print(f"  [ERROR] {filepath.name}: {e}")
        return False


def main():
    # 检查目录
    if not MODELS_DIR.is_dir():
        print(f"[ERROR] 模型目录不存在: {MODELS_DIR}")
        print("       请先运行 sync_models.py 或确保 static/models/ 中有 .glb 文件")
        sys.exit(1)

    # 收集所有 .glb 文件
    glb_files = sorted(MODELS_DIR.glob("*.glb"))
    if not glb_files:
        print(f"[WARN] 在 {MODELS_DIR} 中未找到 .glb 文件")
        return

    print(f"[INFO] 找到 {len(glb_files)} 个 .glb 文件，开始优化...")
    print()

    success_count = 0
    skip_count = 0
    fail_count = 0

    for glb_path in glb_files:
        print(f"[{glb_files.index(glb_path)+1}/{len(glb_files)}] 处理: {glb_path.name}")
        result = optimize_glb(glb_path)
        if result:
            success_count += 1
            print(f"       -> 优化成功")
        elif "跳过" in str(result) or "SKIP" in str(result):
            skip_count += 1
        else:
            fail_count += 1
            print(f"       -> 优化失败")

    print()
    print("=" * 60)
    print(f"[DONE] 完成！成功: {success_count}  跳过: {skip_count}  失败: {fail_count}")
    print("=" * 60)


if __name__ == "__main__":
    main()