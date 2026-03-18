"""Helper functions for the game module system."""
from apps.game_config.models import GameModule


def get_modules_snapshot(source):
    """
    Build a modules dict for the settings_snapshot.

    For each active GameModule:
    1. Check if source (GameSettings or GameMode) has an override
    2. Merge: module defaults ← override config
    3. Apply enabled state and config to flat snapshot fields via field_mapping

    Args:
        source: GameSettings or GameMode instance (must have .module_overrides relation)

    Returns:
        tuple: (modules_dict, flat_overrides_dict)
            - modules_dict: {"weather": {"enabled": true, "config": {...}}, ...}
            - flat_overrides: {"weather_enabled": true, "storm_randomness_modifier": 1.4, ...}
    """
    overrides_by_module = {}
    for override in source.module_overrides.select_related('module').all():
        overrides_by_module[override.module.slug] = override

    modules_dict = {}
    flat_overrides = {}

    for module in GameModule.objects.filter(is_active=True).order_by('order'):
        override = overrides_by_module.get(module.slug)

        if override is not None:
            enabled = override.enabled
            config = {**module.default_config, **override.config}
        else:
            enabled = module.default_enabled
            config = dict(module.default_config)

        modules_dict[module.slug] = {
            'enabled': enabled,
            'config': config,
        }

        # Apply to flat fields via field_mapping
        mapping = module.field_mapping or {}
        enabled_field = mapping.get('enabled_field')
        if enabled_field:
            flat_overrides[enabled_field] = enabled

        config_fields = mapping.get('config_fields', {})
        for config_key, snapshot_field in config_fields.items():
            if config_key in config:
                flat_overrides[snapshot_field] = config[config_key]

    return modules_dict, flat_overrides
