# -*- coding: utf-8 -*-
"""计算引擎单元测试（unittest，无需第三方依赖）
运行：python -m unittest discover -s engineering -p "test_*.py" -v
或：python engineering/test_aero_calculator.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from aero_calculator import (
    rho_at_altitude, aspect_ratio, wing_loading, lift_coefficient,
    stall_speed, lift_drag_ratio, breguet_range_km,
    speed_kmh_to_ms, speed_ms_to_kmh, analyze,
    drag_polar, drag_polar_curve, best_ld_point,
    flight_envelope, service_ceiling,
    takeoff_distance, landing_distance,
    rate_of_climb, climb_profile,
)


class TestUnits(unittest.TestCase):
    def test_speed_kmh_to_ms(self):
        self.assertAlmostEqual(speed_kmh_to_ms(3600), 1000.0, places=5)

    def test_speed_ms_to_kmh(self):
        self.assertAlmostEqual(speed_ms_to_kmh(100), 360.0, places=5)

    def test_roundtrip(self):
        self.assertAlmostEqual(speed_kmh_to_ms(speed_ms_to_kmh(123.4)), 123.4, places=5)


class TestAtmosphere(unittest.TestCase):
    def test_sea_level_rho(self):
        self.assertAlmostEqual(rho_at_altitude(0), 1.225, places=3)

    def test_altitude_rho_smaller(self):
        self.assertLess(rho_at_altitude(11000), rho_at_altitude(0))

    def test_altitude_clamped(self):
        self.assertEqual(rho_at_altitude(20000), rho_at_altitude(11000))


class TestGeometry(unittest.TestCase):
    def test_aspect_ratio_c919(self):
        # C919: b=35.8, S=145.4 → AR ≈ 8.8
        self.assertAlmostEqual(aspect_ratio(35.8, 145.4), 8.81, places=1)

    def test_aspect_ratio_f22(self):
        # F-22: b=13.56, S=78.04 → AR ≈ 2.36
        self.assertAlmostEqual(aspect_ratio(13.56, 78.04), 2.36, places=1)

    def test_aspect_ratio_zero_area(self):
        with self.assertRaises(ValueError):
            aspect_ratio(10, 0)

    def test_wing_loading_c919(self):
        # 72.5t / 145.4 → ≈ 498.6 kg/m²（公开翼载 500 量级）
        self.assertAlmostEqual(wing_loading(72500, 145.4), 498.6, places=0)


class TestAero(unittest.TestCase):
    def test_lift_coefficient_cruise_sane(self):
        # A320 巡航：V≈230m/s, H=11000m, ρ≈0.36 → CL≈0.87（与真实巡航量级一致）
        cl = lift_coefficient(79000, 230, 123, alt_m=11000)
        self.assertGreater(cl, 0.5)
        self.assertLess(cl, 1.1)

    def test_stall_speed_positive(self):
        vs = stall_speed(72500, 145.4, cl_max=2.0)
        self.assertGreater(vs, 30)
        self.assertLess(vs, 100)

    def test_stall_flap_slower(self):
        clean = stall_speed(72500, 145.4, cl_max=1.5)
        flap = stall_speed(72500, 145.4, cl_max=2.5)
        self.assertLess(flap, clean)

    def test_lift_drag_sane(self):
        # CL=0.5, AR=8.8 时诱导阻力小，L/D 偏高属正常（真实巡航 L/D≈18 需更高 CD0）
        ld = lift_drag_ratio(0.5, 8.8, cd0=0.02, e=0.75)
        self.assertGreater(ld, 20)
        self.assertLess(ld, 40)

    def test_lift_drag_zero_ar(self):
        with self.assertRaises(ValueError):
            lift_drag_ratio(0.5, 0)


class TestRange(unittest.TestCase):
    def test_breguet_sane(self):
        # 近似 A320：V=230m/s, L/D≈15, TSFC=1.6e-5, ln(1.25)=0.223
        r = breguet_range_km(230, 15, tsfc_kg_N_s=1.6e-5, w0_kg=79000, w1_kg=63200)
        self.assertGreater(r, 3000)
        self.assertLess(r, 7000)

    def test_breguet_zero_tsfc(self):
        with self.assertRaises(ValueError):
            breguet_range_km(100, 10, tsfc_kg_N_s=0)

    def test_breguet_bad_ratio(self):
        with self.assertRaises(ValueError):
            breguet_range_km(100, 10, w0_kg=100, w1_kg=200)


class TestAnalyze(unittest.TestCase):
    def setUp(self):
        self.c919 = {
            "wingspan_m": 35.8, "wing_area_m2": 145.4, "mtow_kg": 72500,
            "cruise_speed_kmh": 920,
        }

    def test_analyze_all_keys(self):
        r = analyze(self.c919)
        for key in ["aspect_ratio", "wing_loading_kg_m2", "cl_cruise",
                    "ld_cruise", "stall_speed_clean_kmh",
                    "stall_speed_flap_kmh", "range_est_km"]:
            self.assertIn(key, r)

    def test_analyze_c919_values_sane(self):
        r = analyze(self.c919)
        self.assertAlmostEqual(r["aspect_ratio"], 8.8, delta=0.2)
        self.assertAlmostEqual(r["wing_loading_kg_m2"], 498, delta=5)
        self.assertGreater(r["range_est_km"], 2000)


class TestDragPolar(unittest.TestCase):
    def test_drag_polar_positive(self):
        cd = drag_polar(0.5, 8.8, cd0=0.05, e=0.75)
        self.assertGreater(cd, 0.05)  # CD > CD0

    def test_drag_polar_zero_cl(self):
        cd = drag_polar(0, 8.8, cd0=0.05, e=0.75)
        self.assertAlmostEqual(cd, 0.05, places=5)

    def test_polar_curve_data_length(self):
        data = drag_polar_curve(8.8, cd0=0.05, e=0.75)
        self.assertGreater(len(data), 20)

    def test_polar_curve_stall_decrease(self):
        """失速后 CL 应下降"""
        data = drag_polar_curve(8.8, cd0=0.05, e=0.75)
        cl_at_stall = data[19][0]   # alpha=15
        cl_post_stall = data[21][0]  # alpha=17
        self.assertLess(cl_post_stall, cl_at_stall)

    def test_best_ld_analytical(self):
        bp = best_ld_point(8.8, cd0=0.05, e=0.75)
        self.assertGreater(bp["ld_max"], 8)
        self.assertLess(bp["ld_max"], 40)


class TestFlightEnvelope(unittest.TestCase):
    def test_envelope_data_length(self):
        env = flight_envelope(72500, 145.4, cl_max=1.5, vmo_kmh=920)
        self.assertGreater(len(env), 20)

    def test_stall_increases_with_altitude(self):
        env = flight_envelope(72500, 145.4, cl_max=1.5, vmo_kmh=920)
        self.assertGreater(env[-1][0], env[0][0])

    def test_vmo_positive(self):
        env = flight_envelope(72500, 145.4, cl_max=1.5, vmo_kmh=920)
        for vs, vmax, h in env:
            self.assertGreater(vmax, 0)

    def test_service_ceiling_positive(self):
        sc = service_ceiling(72500, 145.4, cl_max=1.5, vmo_kmh=920)
        self.assertGreater(sc, 5000)


class TestTakeoffLanding(unittest.TestCase):
    def test_takeoff_distance_positive(self):
        r = takeoff_distance(72500, 145.4, 268000, ar=8.8)
        self.assertGreater(r["total_m"], 500)
        self.assertLess(r["total_m"], 5000)
        self.assertGreater(r["v_rotate_kmh"], 100)

    def test_takeoff_zero_thrust(self):
        r = takeoff_distance(72500, 145.4, 0, ar=8.8)
        self.assertEqual(r["total_m"], 0)

    def test_landing_distance_positive(self):
        r = landing_distance(72500, 145.4, ar=8.8, mu_brake=0.3)
        self.assertGreater(r["total_m"], 200)
        self.assertLess(r["total_m"], 5000)
        self.assertGreater(r["v_touchdown_kmh"], 80)

    def test_landing_wet_longer_than_dry(self):
        dry = landing_distance(72500, 145.4, ar=8.8, mu_brake=0.4)
        wet = landing_distance(72500, 145.4, ar=8.8, mu_brake=0.2)
        self.assertGreater(wet["total_m"], dry["total_m"])


class TestClimb(unittest.TestCase):
    def test_roc_positive_at_sea_level(self):
        roc = rate_of_climb(72500, 145.4, 268000, 80, alt_m=0, ar=8.8)
        self.assertGreater(roc, 0)

    def test_roc_decreases_with_altitude(self):
        roc0 = rate_of_climb(72500, 145.4, 268000, 80, alt_m=0, ar=8.8)
        roc10k = rate_of_climb(72500, 145.4, 268000, 80, alt_m=10000, ar=8.8)
        self.assertGreater(roc0, roc10k)

    def test_climb_profile_data_length(self):
        profile = climb_profile(72500, 145.4, 268000, 300, ar=8.8)
        self.assertGreater(len(profile), 20)

    def test_climb_profile_decreases(self):
        profile = climb_profile(72500, 145.4, 268000, 300, ar=8.8)
        self.assertGreater(profile[0][0], profile[-1][0])


if __name__ == "__main__":
    unittest.main(verbosity=2)