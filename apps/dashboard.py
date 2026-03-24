import json
from datetime import timedelta

from django.db.models import Count, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from unfold.components import BaseComponent, register_component

# ---------------------------------------------------------------------------
# Helper: last-7-days date range + label list
# ---------------------------------------------------------------------------


def _last_7_days():
    """Return a list of (date, label) tuples for the last 7 days (oldest first)."""
    today = timezone.now().date()
    return [(today - timedelta(days=i), (today - timedelta(days=i)).strftime("%a")) for i in range(6, -1, -1)]


# ---------------------------------------------------------------------------
# Dashboard callback — injects KPI values into the admin index context
# ---------------------------------------------------------------------------


def dashboard_callback(request, context):
    from apps.accounts.models import User
    from apps.inventory.models import Wallet
    from apps.marketplace.models import MarketListing
    from apps.matchmaking.models import Match, MatchQueue

    today = timezone.now().date()
    today + timedelta(days=1)

    # KPI: total users (exclude bots so the number is meaningful)
    kpi_users = User.objects.filter(is_bot=False).count()

    # KPI: active matches
    kpi_active_matches = Match.objects.filter(status=Match.Status.IN_PROGRESS).count()

    # KPI: matches started today
    kpi_matches_today = Match.objects.filter(
        created_at__date=today,
    ).count()

    # KPI: players currently in queue
    kpi_queue_size = MatchQueue.objects.count()

    # KPI: total gold in circulation across all wallets
    kpi_total_gold = Wallet.objects.aggregate(total=Sum("gold"))["total"] or 0

    # KPI: active marketplace listings
    kpi_active_listings = MarketListing.objects.filter(status=MarketListing.Status.ACTIVE).count()

    context.update(
        {
            "kpi_users": kpi_users,
            "kpi_active_matches": kpi_active_matches,
            "kpi_matches_today": kpi_matches_today,
            "kpi_queue_size": kpi_queue_size,
            "kpi_total_gold": f"{kpi_total_gold:,}",
            "kpi_active_listings": kpi_active_listings,
        }
    )

    return context


# ---------------------------------------------------------------------------
# Chart components
# ---------------------------------------------------------------------------


@register_component
class MatchesChartComponent(BaseComponent):
    """Bar chart: matches created per day for the last 7 days."""

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        from apps.matchmaking.models import Match

        days = _last_7_days()
        labels = [label for _, label in days]

        # Aggregate match counts grouped by date
        counts_qs = (
            Match.objects.filter(
                created_at__date__gte=days[0][0],
                created_at__date__lte=days[-1][0],
            )
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(count=Count("id"))
        )
        counts_by_day = {str(row["day"]): row["count"] for row in counts_qs}

        data_points = [counts_by_day.get(str(d), 0) for d, _ in days]

        context["data"] = json.dumps(
            {
                "labels": labels,
                "datasets": [
                    {
                        "label": "Matches",
                        "data": data_points,
                        "backgroundColor": "oklch(62.7% 0.265 303.9)",
                        "borderRadius": 4,
                    }
                ],
            }
        )
        context["height"] = 320
        return context


@register_component
class UserRegistrationsChartComponent(BaseComponent):
    """Line chart: new user registrations per day for the last 7 days."""

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        from apps.accounts.models import User

        days = _last_7_days()
        labels = [label for _, label in days]

        counts_qs = (
            User.objects.filter(
                is_bot=False,
                date_joined__date__gte=days[0][0],
                date_joined__date__lte=days[-1][0],
            )
            .annotate(day=TruncDate("date_joined"))
            .values("day")
            .annotate(count=Count("id"))
        )
        counts_by_day = {str(row["day"]): row["count"] for row in counts_qs}

        data_points = [counts_by_day.get(str(d), 0) for d, _ in days]

        context["data"] = json.dumps(
            {
                "labels": labels,
                "datasets": [
                    {
                        "label": "Registrations",
                        "data": data_points,
                        "borderColor": "oklch(62.7% 0.265 303.9)",
                        "backgroundColor": "oklch(62.7% 0.265 303.9 / 15%)",
                        "tension": 0.4,
                        "fill": True,
                        "pointBackgroundColor": "oklch(62.7% 0.265 303.9)",
                    }
                ],
            }
        )
        context["height"] = 320
        return context
