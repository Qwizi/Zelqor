"""
Custom test runner that skips the system check phase so we can run tests
without GDAL/PostGIS installed (the geo app FK to Region causes admin check failures).
"""
from django.test.runner import DiscoverRunner


class NoCheckTestRunner(DiscoverRunner):
    """DiscoverRunner variant that skips Django system checks."""

    def run_checks(self, databases):
        # Skip system checks — they fail when geo app is excluded but
        # some FK still references geo.Region via MatchPlayer.capital_region.
        pass
