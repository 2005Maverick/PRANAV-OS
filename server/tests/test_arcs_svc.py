"""Unit tests for Arcs progress logic (pure, no DB)."""
import datetime as dt

import pytest

from app.services import arcs_svc


def _do(est, done):
    return {"kind": "do", "est_minutes": est, "done": done}


@pytest.mark.unit
def test_project_progress_weights_by_time():
    steps = [_do(120, True), _do(60, False), _do(120, False)]
    # 120 done of 300 planned -> 40%
    assert arcs_svc._project_progress(steps) == 40


@pytest.mark.unit
def test_project_progress_all_done():
    assert arcs_svc._project_progress([_do(30, True), _do(90, True)]) == 100


@pytest.mark.unit
def test_project_progress_none_without_do_steps():
    assert arcs_svc._project_progress([{"kind": "checkpoint", "done": True}]) is None


@pytest.mark.unit
def test_project_progress_zero_est_still_counts():
    # est floored to 1 so a plain checklist (no times) still measures by count
    assert arcs_svc._project_progress([_do(0, True), _do(0, False)]) == 50


@pytest.mark.unit
def test_target_state_pct_and_pace():
    arc = {
        "target_amount": 100000, "target_unit": "₹", "deadline": dt.date(2026, 11, 20),
        "created_at": dt.datetime(2026, 8, 20, tzinfo=arcs_svc.config.TZ),
    }
    st = arcs_svc._target_state(arc, 25000)
    assert st["pct"] == 25
    assert st["target"] == 100000
    assert st["need_per_week"] is not None and st["need_per_week"] > 0


@pytest.mark.unit
def test_keep_state_counts_on_rhythm():
    today = arcs_svc._today()
    steps = [
        {"kind": "keep", "cadence": "weekly", "last_done": today},
        {"kind": "keep", "cadence": "daily", "last_done": today - dt.timedelta(days=5)},
        {"kind": "keep", "cadence": "weekly", "last_done": None},
    ]
    st = arcs_svc._keep_state(steps)
    assert st["total"] == 3
    assert st["on_rhythm"] == 1  # only the weekly-done-today is fresh
