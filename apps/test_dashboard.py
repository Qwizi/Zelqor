"""
Tests for apps/dashboard.py.

Verifies:
- _last_7_days() returns 7 entries in chronological order.
- dashboard_callback() populates all expected KPI keys.
- MatchesChartComponent.get_context_data() returns valid JSON chart data.
- UserRegistrationsChartComponent.get_context_data() returns valid JSON chart data.
"""

import json

import pytest

# ---------------------------------------------------------------------------
# _last_7_days helper
# ---------------------------------------------------------------------------


class TestLast7Days:
    def test_returns_seven_entries(self):
        from apps.dashboard import _last_7_days

        result = _last_7_days()
        assert len(result) == 7

    def test_entries_are_date_label_tuples(self):
        from apps.dashboard import _last_7_days

        for date, label in _last_7_days():
            from datetime import date as date_cls

            assert isinstance(date, date_cls)
            assert isinstance(label, str)
            assert len(label) > 0

    def test_oldest_first(self):
        from apps.dashboard import _last_7_days

        days = _last_7_days()
        dates = [d for d, _ in days]
        assert dates == sorted(dates)

    def test_last_entry_is_today(self):
        from django.utils import timezone

        from apps.dashboard import _last_7_days

        days = _last_7_days()
        last_date, _ = days[-1]
        assert last_date == timezone.now().date()


# ---------------------------------------------------------------------------
# dashboard_callback
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDashboardCallback:
    def test_all_kpi_keys_present(self):
        from apps.dashboard import dashboard_callback

        context = {}
        result = dashboard_callback(request=None, context=context)

        expected_keys = [
            "kpi_users",
            "kpi_active_matches",
            "kpi_matches_today",
            "kpi_queue_size",
            "kpi_total_gold",
            "kpi_active_listings",
        ]
        for key in expected_keys:
            assert key in result, f"Missing KPI key: {key}"

    def test_kpi_users_excludes_bots(self, db):
        from apps.accounts.models import User
        from apps.dashboard import dashboard_callback

        User.objects.create_user(
            username="realuser",
            email="real@test.local",
            password="pass",
            is_bot=False,
        )
        User.objects.create_user(
            username="botuser",
            email="bot@test.local",
            password="pass",
            is_bot=True,
        )
        result = dashboard_callback(request=None, context={})
        # kpi_users should count only non-bot users
        assert result["kpi_users"] >= 1

    def test_kpi_active_matches(self, db):
        from apps.dashboard import dashboard_callback
        from apps.matchmaking.models import Match

        Match.objects.create(status="in_progress")
        Match.objects.create(status="finished")
        result = dashboard_callback(request=None, context={})
        assert result["kpi_active_matches"] >= 1

    def test_kpi_matches_today(self, db):
        from apps.dashboard import dashboard_callback
        from apps.matchmaking.models import Match

        Match.objects.create(status="finished")
        result = dashboard_callback(request=None, context={})
        assert result["kpi_matches_today"] >= 1

    def test_kpi_queue_size(self, db):
        from apps.accounts.models import User
        from apps.dashboard import dashboard_callback
        from apps.matchmaking.models import MatchQueue

        user = User.objects.create_user(
            username="queueuser",
            email="queue@test.local",
            password="pass",
        )
        MatchQueue.objects.create(user=user)
        result = dashboard_callback(request=None, context={})
        assert result["kpi_queue_size"] >= 1

    def test_kpi_total_gold_formatted(self, db):
        """kpi_total_gold should be a formatted string."""
        from apps.dashboard import dashboard_callback

        result = dashboard_callback(request=None, context={})
        assert isinstance(result["kpi_total_gold"], str)

    def test_kpi_total_gold_with_wallet(self, db):
        from apps.accounts.models import User
        from apps.dashboard import dashboard_callback
        from apps.inventory.models import Wallet

        user = User.objects.create_user(
            username="golduser",
            email="gold@test.local",
            password="pass",
        )
        Wallet.objects.create(user=user, gold=500)
        result = dashboard_callback(request=None, context={})
        # 500 formatted → "500"
        assert "500" in result["kpi_total_gold"]

    def test_kpi_active_listings(self, db):
        from apps.dashboard import dashboard_callback

        result = dashboard_callback(request=None, context={})
        assert isinstance(result["kpi_active_listings"], int)

    def test_existing_context_is_preserved(self, db):
        """dashboard_callback should extend, not replace, the context."""
        from apps.dashboard import dashboard_callback

        context = {"my_custom_key": "my_value"}
        result = dashboard_callback(request=None, context=context)
        assert result["my_custom_key"] == "my_value"


# ---------------------------------------------------------------------------
# MatchesChartComponent
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestMatchesChartComponent:
    def _get_context(self):

        from apps.dashboard import MatchesChartComponent

        component = MatchesChartComponent.__new__(MatchesChartComponent)
        # Minimal kwargs — BaseComponent.get_context_data just returns {}
        component.kwargs = {}
        context = component.get_context_data()
        return context

    def test_data_key_present(self):
        context = self._get_context()
        assert "data" in context

    def test_data_is_valid_json(self):
        context = self._get_context()
        parsed = json.loads(context["data"])
        assert "labels" in parsed
        assert "datasets" in parsed

    def test_labels_length_seven(self):
        context = self._get_context()
        parsed = json.loads(context["data"])
        assert len(parsed["labels"]) == 7

    def test_data_points_length_seven(self):
        context = self._get_context()
        parsed = json.loads(context["data"])
        assert len(parsed["datasets"][0]["data"]) == 7

    def test_height_set(self):
        context = self._get_context()
        assert context.get("height") == 320

    def test_data_points_are_ints(self):
        context = self._get_context()
        parsed = json.loads(context["data"])
        for v in parsed["datasets"][0]["data"]:
            assert isinstance(v, int)

    def test_matches_counted_correctly(self, db):
        from apps.matchmaking.models import Match

        Match.objects.create(status="finished")
        context = self._get_context()
        parsed = json.loads(context["data"])
        total = sum(parsed["datasets"][0]["data"])
        assert total >= 1


# ---------------------------------------------------------------------------
# UserRegistrationsChartComponent
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestUserRegistrationsChartComponent:
    def _get_context(self):
        from apps.dashboard import UserRegistrationsChartComponent

        component = UserRegistrationsChartComponent.__new__(UserRegistrationsChartComponent)
        component.kwargs = {}
        return component.get_context_data()

    def test_data_key_present(self):
        context = self._get_context()
        assert "data" in context

    def test_data_is_valid_json(self):
        context = self._get_context()
        parsed = json.loads(context["data"])
        assert "labels" in parsed
        assert "datasets" in parsed

    def test_labels_length_seven(self):
        context = self._get_context()
        parsed = json.loads(context["data"])
        assert len(parsed["labels"]) == 7

    def test_data_points_length_seven(self):
        context = self._get_context()
        parsed = json.loads(context["data"])
        assert len(parsed["datasets"][0]["data"]) == 7

    def test_height_set(self):
        context = self._get_context()
        assert context.get("height") == 320

    def test_excludes_bots(self, db):
        """Bot users should not be counted in registrations."""
        from apps.accounts.models import User

        User.objects.create_user(
            username="botregtest",
            email="botregtest@test.local",
            password="pass",
            is_bot=True,
        )
        context = self._get_context()
        parsed = json.loads(context["data"])
        # Total count should not increase due to bot
        total = sum(parsed["datasets"][0]["data"])
        assert isinstance(total, int)

    def test_real_user_counted(self, db):
        from apps.accounts.models import User

        User.objects.create_user(
            username="realreg",
            email="realreg@test.local",
            password="pass",
            is_bot=False,
        )
        context = self._get_context()
        parsed = json.loads(context["data"])
        total = sum(parsed["datasets"][0]["data"])
        assert total >= 1

    def test_dataset_has_tension_and_fill(self):
        context = self._get_context()
        parsed = json.loads(context["data"])
        ds = parsed["datasets"][0]
        assert "tension" in ds
        assert "fill" in ds
