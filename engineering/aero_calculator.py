# -*- coding: utf-8 -*-
"""航空工程计算引擎（aerodynamic / performance 估算）
用途：CyberWing Aviation Hub 工程分析模块后端计算核心
说明：全部为经典理论的工程估算公式，含单位换算与假设说明；
      输入 SI 单位（m, kg, m/s），输出统一换算为常用单位。

主要公式：
  1. 展弦比          AR = b^2 / S
  2. 翼载荷          W/S (kg/m²)
  3. 巡航升力系数    CL = 2·W/(ρ·V²·S)
  4. 失速速度估算    Vs = sqrt(2·W/(ρ·CL_max·S))
  5. 巡航升阻比估算  L/D = 1/(CD0 + CL²/(π·e·AR))
  6. Breguet 航程    R = (V/(TSFC·g))·(L/D)·ln(W0/W1)

假设（文档化）：
  - ISA 大气模型；ρ 随高度按指数近似（h≤11000m）
  - 巡航 CL_max：光洁构型约 1.5，襟翼放下约 2.5（输入参数）
  - CD0（零升阻力系数）：干线客机约 0.02，军用机约 0.025（输入参数）
  - 展弦效率因子 e：客机约 0.75，战斗机约 0.65（输入参数）
  - TSFC（单位推力耗油率）：涡扇约 1.6e-5 kg/(N·s)，涡喷约 2.0e-5（输入）
"""
import math

G = 9.80665            # 重力加速度 m/s²
RHO0 = 1.225           # 海平面空气密度 kg/m³
LAPSE = 0.0065         # ISA 温度直减率 K/m
T0 = 288.15            # ISA 海平面温度 K
GAS_R = 287.05         # 干空气比气体常数 J/(kg·K)

# ---------- 单位换算 ----------
KMH_TO_MS = 1000.0 / 3600.0


def rho_at_altitude(h_m):
    """ISA 大气密度估算（h≤11000m 对流层）"""
    h = max(0.0, float(h_m))
    if h > 11000:
        h = 11000.0
    ratio = (1.0 - (LAPSE * h) / T0) ** (G / (LAPSE * GAS_R))
    return RHO0 * ratio


def aspect_ratio(wingspan_m, wing_area_m2):
    """展弦比 AR = b²/S"""
    if wing_area_m2 <= 0:
        raise ValueError("wing_area_m2 必须 > 0")
    return (float(wingspan_m) ** 2) / float(wing_area_m2)


def wing_loading(mtow_kg, wing_area_m2):
    """翼载荷 kg/m²"""
    if wing_area_m2 <= 0:
        raise ValueError("wing_area_m2 必须 > 0")
    return float(mtow_kg) / float(wing_area_m2)


def lift_coefficient(mtow_kg, speed_m_s, wing_area_m2, alt_m=0.0, rho=None):
    """巡航升力系数 CL = 2·W/(ρ·V²·S)"""
    if speed_m_s <= 0:
        raise ValueError("速度必须 > 0")
    r = rho if rho is not None else rho_at_altitude(alt_m)
    w = float(mtow_kg) * G
    return 2.0 * w / (r * speed_m_s ** 2 * float(wing_area_m2))


def stall_speed(mtow_kg, wing_area_m2, cl_max=1.5, alt_m=0.0, rho=None):
    """失速速度估算 (m/s)  Vs = sqrt(2W/(ρ·CLmax·S))"""
    r = rho if rho is not None else rho_at_altitude(alt_m)
    W = float(mtow_kg) * G
    return math.sqrt(2.0 * W / (r * cl_max * float(wing_area_m2)))


def lift_drag_ratio(cl, ar, cd0=0.02, e=0.75):
    """巡航升阻比 L/D = 1/(CD0 + CL²/(π·e·AR))"""
    if ar <= 0 or e <= 0:
        raise ValueError("展弦比与展弦效率必须 > 0")
    cd_induced = (cl ** 2) / (math.pi * e * ar)
    return 1.0 / (cd0 + cd_induced)


def breguet_range_km(cruise_speed_m_s, ld_ratio, tsfc_kg_N_s=1.6e-5, w0_kg=None, w1_kg=None):
    """Breguet 航程估算：R = (V/(tsfc·g))·(L/D)·ln(W0/W1)（km）
    说明：喷气式 Breguet 公式；W0 起飞重量，W1 落地重量（默认 W1=0.8·W0）"""
    if tsfc_kg_N_s <= 0:
        raise ValueError("TSFC 必须 > 0")
    w0 = 1000.0 if w0_kg is None else float(w0_kg)
    w1 = 0.8 * w0 if w1_kg is None else float(w1_kg)
    ratio = w0 / w1
    if ratio <= 1:
        raise ValueError("w0/w1 必须 > 1")
    meters = (cruise_speed_m_s / (tsfc_kg_N_s * G)) * ld_ratio * math.log(ratio)
    return meters / 1000.0


def speed_kmh_to_ms(kmh):
    return float(kmh) * KMH_TO_MS


def speed_ms_to_kmh(ms):
    return ms / KMH_TO_MS


def analyze(aircraft):
    """一键分析：输入 aircraft 参数 dict（SI），返回常用指标 dict
    aircraft 至少含：wingspan_m, wing_area_m2, mtow_kg,
                   cruise_speed_kmh, range_km（有则用于对照）"""
    b = float(aircraft["wingspan_m"])
    s = float(aircraft["wing_area_m2"])
    w = float(aircraft["mtow_kg"])
    v_ms = speed_kmh_to_ms(aircraft.get("cruise_speed_kmh", 850))
    ar = aspect_ratio(b, s)
    wl = wing_loading(w, s)
    rho_cruise = rho_at_altitude(aircraft.get("cruise_alt_m", 11000.0))
    cl = lift_coefficient(w, v_ms, s, rho=rho_cruise)
    ld = lift_drag_ratio(cl, ar, cd0=aircraft.get("cd0", 0.05), e=aircraft.get("e", 0.75))
    vs_clean = stall_speed(w, s, cl_max=1.5, alt_m=0.0)
    vs_flap = stall_speed(w, s, cl_max=2.5, alt_m=0.0)
    r_est = breguet_range_km(v_ms, ld, tsfc_kg_N_s=aircraft.get("tsfc", 1.6e-5), w0_kg=w)
    return {
        "aspect_ratio": round(ar, 2),
        "wing_loading_kg_m2": round(wl, 1),
        "cl_cruise": round(cl, 3),
        "ld_cruise": round(ld, 2),
        "stall_speed_clean_kmh": round(speed_ms_to_kmh(vs_clean), 0),
        "stall_speed_flap_kmh": round(speed_ms_to_kmh(vs_flap), 0),
        "range_est_km": round(r_est, 0),
    }


def drag_polar(cl, ar, cd0=0.05, e=0.75):
    """极曲线单点：CD = CD₀ + CL²/(π·e·AR)，返回 CD"""
    return cd0 + (cl ** 2) / (math.pi * e * ar)


def drag_polar_curve(ar, cd0=0.05, e=0.75, cl_max=None, alpha0=-2.0, alpha_stall=15.0):
    """极曲线数据序列：返回 [(CL, CD, alpha)] 列表
    失速前线性升力，失速后缓降"""
    a_per_rad = 2 * math.pi * ar / (ar + 2)
    a_per_deg = a_per_rad * math.pi / 180
    if cl_max is None:
        cl_max = a_per_deg * (alpha_stall - alpha0)
    data = []
    for al_deg in range(-4, 23):
        if al_deg <= alpha_stall:
            cl = a_per_deg * (al_deg - alpha0)
        else:
            cl = cl_max * max(0, 1 - (al_deg - alpha_stall) * 0.12)
        cd = drag_polar(cl, ar, cd0, e)
        if al_deg > alpha_stall:
            cd += (al_deg - alpha_stall) * 0.02
        data.append((round(cl, 3), round(cd, 4), al_deg))
    return data


def best_ld_point(ar, cd0=0.05, e=0.75):
    """最佳升阻比点（解析解）：CL_opt = sqrt(π·e·AR·CD₀)，L/D_max = 0.5/sqrt(CD₀·k)"""
    k = 1.0 / (math.pi * e * ar)
    cl_opt = math.sqrt(math.pi * e * ar * cd0)
    cd_opt = 2 * cd0
    ld_max = cl_opt / cd_opt
    return {"cl_opt": round(cl_opt, 3), "cd_opt": round(cd_opt, 4), "ld_max": round(ld_max, 2)}


def flight_envelope(mtow_kg, wing_area_m2, cl_max=1.5, vmo_kmh=920, mach_limit=0.82,
                     h_min=0, h_max=14000, h_step=500):
    """飞行包线：返回 [(stall_kmh, vmo_kmh, altitude_m)] 列表
    失速边界：Vs = sqrt(2W/(ρ·CLmax·S))；速度上限取 VMO 与马赫限制的较小值"""
    data = []
    for h in range(h_min, h_max + h_step, h_step):
        rho = rho_at_altitude(h)
        vs = math.sqrt(2 * float(mtow_kg) * G / (rho * cl_max * float(wing_area_m2)))
        vs_kmh = vs * 3.6
        # 声速随高度
        t = max(288.15 - 0.0065 * h, 216.65)  # 对流层/同温层
        c_sound = 20.05 * math.sqrt(t)
        v_mach_kmh = mach_limit * c_sound * 3.6
        v_max = min(float(vmo_kmh), v_mach_kmh)
        data.append((round(vs_kmh, 0), round(v_max, 0), h))
    return data


def service_ceiling(mtow_kg, wing_area_m2, cl_max=1.5, vmo_kmh=920, mach_limit=0.82,
                     h_step=100):
    """实用升限：失速速度 = 最大速度时的高度（搜索法）"""
    env = flight_envelope(mtow_kg, wing_area_m2, cl_max, vmo_kmh, mach_limit, 0, 15000, h_step)
    for vs, vmax, h in env:
        if vs >= vmax:
            return h
    return 15000  # 未收敛返回上限


# ---------- 起飞着陆性能 ----------

def takeoff_distance(mtow_kg, wing_area_m2, thrust_n, cd0=0.05, e=0.75,
                     ar=8.8, mu=0.02, cl_takeoff=1.2, rho=RHO0, v_rotate_frac=1.2):
    """起飞距离估算（地面滑跑+抬轮+爬升到15m）
    参考：CCAR-25.105 / Anderson《Aircraft Performance & Design》
    假设：匀加速滑跑、无风、平直跑道、推力恒定（简化）

    mtow_kg      最大起飞重量 kg
    thrust_n     总推力 N（可用 max_thrust_kn*1000）
    cd0, e, ar   阻力参数
    mu           地面摩擦系数（干沥青约 0.02，湿 0.05）
    cl_takeoff   起飞构型升力系数（襟翼放下约 1.2-2.0）
    v_rotate_frac  抬轮速度 = 失速速度 × 此倍数（典型 1.1-1.2）
    """
    W = float(mtow_kg) * G
    T = float(thrust_n)
    if T <= 0:
        return {"ground_roll_m": 0, "total_m": 0, "v_rotate_kmh": 0, "note": "推力为零"}
    S = float(wing_area_m2)
    rho = float(rho)

    # 失速速度（起飞构型）
    vs_takeoff = math.sqrt(2 * W / (rho * cl_takeoff * S))
    v_rotate = vs_takeoff * v_rotate_frac  # 抬轮速度
    v_50ft = vs_takeoff * 1.15  # 爬升到 15m (50ft) 时速度

    # 地面滑跑距离：s = V² / (2a), a = (T - μW) / (W/g)
    # 简化：平均阻力 = μW + D_avg（取 V_rotate/2 时的阻力）
    v_avg = v_rotate * 0.5
    cl_ground = cl_takeoff * 0.5  # 地面滑跑时升力约为起飞构型的 50%
    q_avg = 0.5 * rho * v_avg ** 2
    d_avg = q_avg * S * (cd0 + cl_ground ** 2 / (math.pi * e * ar))
    a_accel = (T - d_avg - mu * W) / (W / G)
    if a_accel <= 0:
        return {"ground_roll_m": 0, "total_m": 0, "v_rotate_kmh": 0, "note": "推力不足无法加速"}
    ground_roll = v_rotate ** 2 / (2 * a_accel)

    # 爬升到 15m 距离：能量法 Δh = (V₂² - V₁²)/(2g) + 15m
    # 简化：假设从 V_rotate 爬升到 V_50ft，爬升角 γ = arcsin((T-D)/W)
    q_climb = 0.5 * rho * v_50ft ** 2
    d_climb = q_climb * S * (cd0 + cl_takeoff ** 2 / (math.pi * e * ar))
    sin_gamma = max(0, (T - d_climb) / W)
    gamma = math.asin(sin_gamma) if sin_gamma <= 1 else math.pi / 2
    climb_dist = 15.0 / math.tan(gamma) if math.tan(gamma) > 0 else 9999

    total = ground_roll + climb_dist
    return {
        "ground_roll_m": round(ground_roll, 0),
        "climb_dist_m": round(climb_dist, 0),
        "total_m": round(total, 0),
        "v_rotate_kmh": round(v_rotate * 3.6, 0),
        "v_50ft_kmh": round(v_50ft * 3.6, 0),
        "note": "参考 CCAR-25.105 / Anderson《Aircraft Performance & Design》"
    }


def landing_distance(mtow_kg, wing_area_m2, cd0=0.05, e=0.75, ar=8.8,
                     mu_brake=0.3, cl_landing=2.0, rho=RHO0, v_touchdown_frac=1.3):
    """着陆距离估算（进近接地+地面制动）
    参考：CCAR-25.125 / Anderson《Aircraft Performance & Design》
    假设：无反推（简化）、匀减速、干跑道

    mu_brake        制动摩擦系数（干沥青 0.3-0.5，湿 0.2）
    cl_landing      着陆构型升力系数（全襟翼约 2.0-2.5）
    v_touchdown_frac  接地速度 = 失速速度 × 此倍数（典型 1.2-1.3）
    """
    W = float(mtow_kg) * G
    S = float(wing_area_m2)
    rho = float(rho)
    vs_landing = math.sqrt(2 * W / (rho * cl_landing * S))
    v_touch = vs_landing * v_touchdown_frac

    # 地面制动距离：s = V² / (2a), a = (μW + D) / (W/g)
    v_avg = v_touch * 0.5
    q_avg = 0.5 * rho * v_avg ** 2
    d_avg = q_avg * S * (cd0 + cl_landing ** 2 / (math.pi * e * ar))
    a_decel = (mu_brake * W + d_avg) / (W / G)
    ground_dist = v_touch ** 2 / (2 * a_decel)

    # 进近段（从 15m 到接地）：假设 3° 下滑角
    approach_dist = 15.0 / math.tan(math.radians(3))

    total = approach_dist + ground_dist
    return {
        "approach_dist_m": round(approach_dist, 0),
        "ground_dist_m": round(ground_dist, 0),
        "total_m": round(total, 0),
        "v_touchdown_kmh": round(v_touch * 3.6, 0),
        "note": "参考 CCAR-25.125 / Anderson《Aircraft Performance & Design》"
    }


# ---------- 爬升性能 ----------

def rate_of_climb(mtow_kg, wing_area_m2, thrust_n, speed_ms, alt_m=0.0,
                  cd0=0.05, e=0.75, ar=8.8, rho=None):
    """爬升率（ROC）估算：剩余功率法
    ROC = (T - D) × V / W  (m/s)

    thrust_n  总推力 N
    speed_ms  爬升速度 m/s
    alt_m     高度 m（影响空气密度与推力衰减）
    """
    r = rho if rho is not None else rho_at_altitude(alt_m)
    W = float(mtow_kg) * G
    T = float(thrust_n)
    S = float(wing_area_m2)
    # 推力衰减（高度越高推力越小，简化为密度比）
    T_alt = T * (r / RHO0)
    # 巡航升力系数
    cl = 2 * W / (r * speed_ms ** 2 * S)
    cd = cd0 + cl ** 2 / (math.pi * e * ar)
    D = 0.5 * r * speed_ms ** 2 * S * cd
    roc = (T_alt - D) * speed_ms / W  # m/s
    return max(0, roc)


def climb_profile(mtow_kg, wing_area_m2, thrust_n, climb_speed_kmh,
                  cd0=0.05, e=0.75, ar=8.8, h_max=14000, h_step=500):
    """爬升率随高度变化曲线：返回 [(roc_ms, roc_kmh, altitude_m)] 列表"""
    v_ms = float(climb_speed_kmh) * KMH_TO_MS
    data = []
    for h in range(0, h_max + h_step, h_step):
        roc = rate_of_climb(mtow_kg, wing_area_m2, thrust_n, v_ms, alt_m=h,
                           cd0=cd0, e=e, ar=ar)
        data.append((round(roc, 2), round(roc * 3.6, 0), h))
    return data