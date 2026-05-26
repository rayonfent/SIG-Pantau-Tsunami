"""
SIG-PANTAU TSUNAMI - Anomaly Detection Engine
Implementasi rule deteksi threshold + z-score + multi-sensor confirmation
"""
import math
from typing import Optional
from dataclasses import dataclass, field


@dataclass
class ThresholdConfig:
    suspect_delta3m: float = 15.0
    suspect_zscore: float = 2.0
    waspada_delta3m: float = 25.0
    waspada_rate: float = 8.0
    waspada_zscore: float = 2.5
    siaga_delta3m: float = 40.0
    siaga_rate: float = 13.0
    siaga_zscore: float = 3.0
    awas_delta3m: float = 60.0
    awas_rate: float = 20.0
    awas_zscore: float = 3.5
    min_sensors_confirm: int = 2
    confirm_window_sec: int = 60


@dataclass
class SensorReading:
    sensor_id: str
    water_level_cm: float
    quality: str  # good/suspect/bad/offline
    delta_1m: Optional[float] = None
    delta_3m: Optional[float] = None
    delta_5m: Optional[float] = None
    rate_cm_per_min: Optional[float] = None
    z_score: Optional[float] = None
    smoothed_level: Optional[float] = None
    baseline_median: Optional[float] = None


@dataclass
class DetectionResult:
    level: str  # normal/suspect/waspada/siaga/awas
    confidence_score: float  # 0-100
    confidence_label: str   # low/medium/high
    triggered_by: list = field(default_factory=list)
    max_delta_cm: float = 0
    max_rate: float = 0
    max_zscore: float = 0
    sensor_count: int = 0


def moving_median(values: list[float]) -> float:
    if not values:
        return 0.0
    sorted_v = sorted(values)
    n = len(sorted_v)
    mid = n // 2
    return sorted_v[mid] if n % 2 else (sorted_v[mid-1] + sorted_v[mid]) / 2


def compute_z_score(value: float, baseline: float, std_dev: float = 5.0) -> float:
    if std_dev == 0:
        return 0.0
    return abs(value - baseline) / std_dev


def detect_level_single(reading: SensorReading, cfg: ThresholdConfig) -> tuple[str, list[str]]:
    """Determine alert level for a single sensor reading."""
    if reading.quality in ('bad', 'offline'):
        return 'normal', []

    level = 'normal'
    triggers = []

    d3 = abs(reading.delta_3m or 0)
    rate = abs(reading.rate_cm_per_min or 0)
    z = abs(reading.z_score or 0)

    # Check awas
    if d3 >= cfg.awas_delta3m or rate >= cfg.awas_rate or z >= cfg.awas_zscore:
        level = 'awas'
        if d3 >= cfg.awas_delta3m:
            triggers.append(f"delta_3m={d3:.1f}cm >= {cfg.awas_delta3m}cm")
        if rate >= cfg.awas_rate:
            triggers.append(f"rate={rate:.1f}cm/min >= {cfg.awas_rate}")
        if z >= cfg.awas_zscore:
            triggers.append(f"z_score={z:.2f} >= {cfg.awas_zscore}")
        return level, triggers

    # Check siaga
    if d3 >= cfg.siaga_delta3m or rate >= cfg.siaga_rate or z >= cfg.siaga_zscore:
        level = 'siaga'
        if d3 >= cfg.siaga_delta3m:
            triggers.append(f"delta_3m={d3:.1f}cm >= {cfg.siaga_delta3m}cm")
        if rate >= cfg.siaga_rate:
            triggers.append(f"rate={rate:.1f}cm/min >= {cfg.siaga_rate}")
        if z >= cfg.siaga_zscore:
            triggers.append(f"z_score={z:.2f} >= {cfg.siaga_zscore}")
        return level, triggers

    # Check waspada
    if d3 >= cfg.waspada_delta3m or rate >= cfg.waspada_rate or z >= cfg.waspada_zscore:
        level = 'waspada'
        triggers.append(f"delta_3m={d3:.1f}cm")
        return level, triggers

    # Check suspect
    if d3 >= cfg.suspect_delta3m or z >= cfg.suspect_zscore:
        level = 'suspect'
        triggers.append(f"delta_3m={d3:.1f}cm")
        return level, triggers

    return 'normal', []


LEVEL_ORDER = ['normal', 'suspect', 'waspada', 'siaga', 'awas']

def level_index(level: str) -> int:
    try:
        return LEVEL_ORDER.index(level)
    except ValueError:
        return 0


def compute_confidence(
    readings: list[SensorReading],
    detected_level: str,
    sensor_confirmations: int,
    cfg: ThresholdConfig
) -> float:
    """
    0-100 confidence:
    - Base score from level
    - Bonus from sensor count confirmation
    - Bonus from magnitude
    """
    level_base = {
        'normal': 0,
        'suspect': 30,
        'waspada': 50,
        'siaga': 65,
        'awas': 75,
    }
    score = level_base.get(detected_level, 0)

    # Multi-sensor confirmation bonus
    if sensor_confirmations >= cfg.min_sensors_confirm:
        score += 20
    elif sensor_confirmations == 1:
        score += 5

    # Magnitude bonus
    max_delta = max((abs(r.delta_3m or 0) for r in readings), default=0)
    if detected_level == 'awas' and max_delta >= 80:
        score += 5

    return min(score, 100.0)


def detect_multi_sensor(
    readings: list[SensorReading],
    cfg: ThresholdConfig
) -> DetectionResult:
    """
    Main detection function.
    Returns consolidated DetectionResult across all sensors.
    """
    if not readings:
        return DetectionResult(level='normal', confidence_score=0, confidence_label='low')

    sensor_levels = []
    all_triggers = []
    max_delta = 0.0
    max_rate = 0.0
    max_z = 0.0

    for r in readings:
        lv, trig = detect_level_single(r, cfg)
        sensor_levels.append((r.sensor_id, lv, trig))
        all_triggers.extend(trig)
        max_delta = max(max_delta, abs(r.delta_3m or 0))
        max_rate = max(max_rate, abs(r.rate_cm_per_min or 0))
        max_z = max(max_z, abs(r.z_score or 0))

    # Highest level wins
    highest = max(sensor_levels, key=lambda x: level_index(x[1]))
    detected_level = highest[1]

    # Count sensors confirming this level or higher
    confirmations = sum(
        1 for _, lv, _ in sensor_levels
        if level_index(lv) >= level_index(detected_level) and detected_level != 'normal'
    )

    confidence = compute_confidence(readings, detected_level, confirmations, cfg)

    if confidence < 40:
        confidence_label = 'low'
    elif confidence < 70:
        confidence_label = 'medium'
    else:
        confidence_label = 'high'

    return DetectionResult(
        level=detected_level,
        confidence_score=round(confidence, 1),
        confidence_label=confidence_label,
        triggered_by=list(set(all_triggers)),
        max_delta_cm=round(max_delta, 2),
        max_rate=round(max_rate, 2),
        max_zscore=round(max_z, 2),
        sensor_count=confirmations,
    )


def simulate_water_level(
    base_level: float,
    scenario: str,
    tick: int
) -> float:
    """
    Generate simulated water level for different scenarios.
    tick = seconds elapsed since simulation start
    """
    t = tick / 60.0  # convert to minutes

    if scenario == 'naik_cepat':
        # Rapid rise: +5cm/min
        return base_level + min(t * 5, 120)
    elif scenario == 'surut_mendadak':
        # Sudden drop
        return base_level - min(t * 8, 180)
    elif scenario == 'normal':
        import math
        return base_level + math.sin(t * 0.5) * 3
    elif scenario == 'sensor_offline':
        return base_level  # sensor returns nothing
    else:
        return base_level + (tick % 20 - 10) * 0.5
