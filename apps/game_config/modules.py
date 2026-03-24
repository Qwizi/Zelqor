"""Helper functions for the unified module system."""

from __future__ import annotations

from typing import Any, TypeVar, overload

from apps.game_config.models import SystemModule

T = TypeVar("T")


# ---------------------------------------------------------------------------
# System module helpers
# ---------------------------------------------------------------------------


def is_module_enabled(slug: str) -> bool:
    """Check if a system module is enabled. Shortcut for SystemModule.is_enabled()."""
    return SystemModule.is_enabled(slug)


@overload
def get_module_config[T](slug: str, key: str, default: T) -> T: ...
@overload
def get_module_config(slug: str, key: str) -> Any: ...


def get_module_config(slug: str, key: str, default: Any = None) -> Any:
    """
    Get a config value from a system module.

    Usage:
        auto_ban = get_module_config('anticheat', 'auto_ban_enabled', False)
        max_violations = get_module_config('anticheat', 'max_violations_before_flag', 5)
    """
    from django.core.cache import cache

    cache_key = f"sysmodule_cfg:{slug}"
    config = cache.get(cache_key)
    if config is None:
        try:
            module = SystemModule.objects.get(slug=slug)
            config = module.config or {}
        except SystemModule.DoesNotExist:
            config = {}
        cache.set(cache_key, config, 60)
    return config.get(key, default)


def get_all_module_configs() -> dict[str, dict]:
    """
    Get all system module states and configs in one call.
    Returns: {slug: {'enabled': bool, 'config': dict}}
    """
    from django.core.cache import cache

    cache_key = "sysmodules:full"
    result = cache.get(cache_key)
    if result is None:
        result = {}
        for m in SystemModule.objects.all():
            result[m.slug] = {
                "enabled": m.enabled,
                "config": m.config or {},
            }
        cache.set(cache_key, result, 60)
    return result


# ---------------------------------------------------------------------------
# Game module (match settings) helpers
# ---------------------------------------------------------------------------


def get_modules_snapshot(source):
    """
    Build a modules dict for the settings_snapshot.

    For each active game-type SystemModule:
    1. Check if source (GameSettings or GameMode) has an override
    2. Merge: module defaults <- override config
    3. Apply enabled state and config to flat snapshot fields via field_mapping

    Args:
        source: GameSettings or GameMode instance (must have .module_overrides relation)

    Returns:
        tuple: (modules_dict, flat_overrides_dict)
            - modules_dict: {"weather": {"enabled": true, "config": {...}}, ...}
            - flat_overrides: {"weather_enabled": true, "storm_randomness_modifier": 1.4, ...}
    """
    overrides_by_module = {}
    for override in source.module_overrides.select_related("module").all():
        overrides_by_module[override.module.slug] = override

    modules_dict = {}
    flat_overrides = {}

    for module in SystemModule.objects.filter(module_type="game", enabled=True).order_by("order"):
        override = overrides_by_module.get(module.slug)

        if override is not None:
            enabled = override.enabled
            config = {**module.default_config, **override.config}
        else:
            enabled = module.default_enabled
            config = dict(module.default_config)

        modules_dict[module.slug] = {
            "enabled": enabled,
            "config": config,
        }

        # Apply to flat fields via field_mapping
        mapping = module.field_mapping or {}
        enabled_field = mapping.get("enabled_field")
        if enabled_field:
            flat_overrides[enabled_field] = enabled

        config_fields = mapping.get("config_fields", {})
        for config_key, snapshot_field in config_fields.items():
            if config_key in config:
                flat_overrides[snapshot_field] = config[config_key]

    return modules_dict, flat_overrides
