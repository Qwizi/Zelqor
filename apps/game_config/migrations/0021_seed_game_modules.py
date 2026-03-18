from django.db import migrations


MODULES = [
    {
        'slug': 'weather',
        'name': 'Weather Effects',
        'description': 'Rain, fog, and storm effects that impact combat, energy, and unit generation.',
        'icon': '🌦️',
        'default_enabled': True,
        'order': 1,
        'default_config': {
            'storm_randomness_modifier': 1.4,
            'fog_randomness_modifier': 1.25,
            'rain_randomness_modifier': 1.1,
            'storm_energy_modifier': 0.85,
            'rain_energy_modifier': 0.95,
            'storm_unit_gen_modifier': 0.90,
            'rain_unit_gen_modifier': 0.95,
        },
        'config_schema': [
            {'key': 'storm_randomness_modifier', 'label': 'Storm combat chaos', 'type': 'float', 'default': 1.4, 'min': 1.0, 'max': 3.0},
            {'key': 'fog_randomness_modifier', 'label': 'Fog combat chaos', 'type': 'float', 'default': 1.25, 'min': 1.0, 'max': 3.0},
            {'key': 'rain_randomness_modifier', 'label': 'Rain combat chaos', 'type': 'float', 'default': 1.1, 'min': 1.0, 'max': 3.0},
            {'key': 'storm_energy_modifier', 'label': 'Storm energy modifier', 'type': 'float', 'default': 0.85, 'min': 0.0, 'max': 2.0},
            {'key': 'rain_energy_modifier', 'label': 'Rain energy modifier', 'type': 'float', 'default': 0.95, 'min': 0.0, 'max': 2.0},
            {'key': 'storm_unit_gen_modifier', 'label': 'Storm unit gen modifier', 'type': 'float', 'default': 0.90, 'min': 0.0, 'max': 2.0},
            {'key': 'rain_unit_gen_modifier', 'label': 'Rain unit gen modifier', 'type': 'float', 'default': 0.95, 'min': 0.0, 'max': 2.0},
        ],
        'field_mapping': {
            'enabled_field': 'weather_enabled',
            'config_fields': {
                'storm_randomness_modifier': 'storm_randomness_modifier',
                'fog_randomness_modifier': 'fog_randomness_modifier',
                'rain_randomness_modifier': 'rain_randomness_modifier',
                'storm_energy_modifier': 'storm_energy_modifier',
                'rain_energy_modifier': 'rain_energy_modifier',
                'storm_unit_gen_modifier': 'storm_unit_gen_modifier',
                'rain_unit_gen_modifier': 'rain_unit_gen_modifier',
            },
        },
    },
    {
        'slug': 'day-night',
        'name': 'Day/Night Cycle',
        'description': 'Day/night cycle with defense bonuses at night and reduced visibility.',
        'icon': '🌙',
        'default_enabled': True,
        'order': 2,
        'default_config': {
            'night_defense_modifier': 1.15,
            'dawn_dusk_defense_modifier': 1.05,
        },
        'config_schema': [
            {'key': 'night_defense_modifier', 'label': 'Night defense bonus', 'type': 'float', 'default': 1.15, 'min': 1.0, 'max': 3.0},
            {'key': 'dawn_dusk_defense_modifier', 'label': 'Dawn/dusk defense bonus', 'type': 'float', 'default': 1.05, 'min': 1.0, 'max': 3.0},
        ],
        'field_mapping': {
            'enabled_field': 'day_night_enabled',
            'config_fields': {
                'night_defense_modifier': 'night_defense_modifier',
                'dawn_dusk_defense_modifier': 'dawn_dusk_defense_modifier',
            },
        },
    },
    {
        'slug': 'combat',
        'name': 'Combat System',
        'description': 'Combat mechanics: attacker/defender advantages, randomness, and casualty calculation.',
        'icon': '⚔️',
        'default_enabled': True,
        'order': 3,
        'default_config': {
            'attacker_advantage': 0.0,
            'defender_advantage': 0.1,
            'combat_randomness': 0.2,
            'casualty_factor': 0.5,
        },
        'config_schema': [
            {'key': 'attacker_advantage', 'label': 'Attacker advantage', 'type': 'float', 'default': 0.0, 'min': 0.0, 'max': 1.0},
            {'key': 'defender_advantage', 'label': 'Defender advantage', 'type': 'float', 'default': 0.1, 'min': 0.0, 'max': 1.0},
            {'key': 'combat_randomness', 'label': 'Combat randomness', 'type': 'float', 'default': 0.2, 'min': 0.0, 'max': 1.0},
            {'key': 'casualty_factor', 'label': 'Casualty factor', 'type': 'float', 'default': 0.5, 'min': 0.0, 'max': 1.0},
        ],
        'field_mapping': {
            'config_fields': {
                'attacker_advantage': 'attacker_advantage',
                'defender_advantage': 'defender_advantage',
                'combat_randomness': 'combat_randomness',
                'casualty_factor': 'casualty_factor',
            },
        },
    },
    {
        'slug': 'economy',
        'name': 'Economy',
        'description': 'Energy generation, unit production rates, and starting resources.',
        'icon': '💰',
        'default_enabled': True,
        'order': 4,
        'default_config': {
            'starting_energy': 120,
            'base_energy_per_tick': 2.0,
            'region_energy_per_tick': 0.35,
            'base_unit_generation_rate': 1.0,
            'capital_generation_bonus': 2.0,
        },
        'config_schema': [
            {'key': 'starting_energy', 'label': 'Starting energy', 'type': 'int', 'default': 120, 'min': 0, 'max': 10000},
            {'key': 'base_energy_per_tick', 'label': 'Base energy/tick', 'type': 'float', 'default': 2.0, 'min': 0.0, 'max': 100.0},
            {'key': 'region_energy_per_tick', 'label': 'Energy per region/tick', 'type': 'float', 'default': 0.35, 'min': 0.0, 'max': 10.0},
            {'key': 'base_unit_generation_rate', 'label': 'Base unit gen rate', 'type': 'float', 'default': 1.0, 'min': 0.0, 'max': 100.0},
            {'key': 'capital_generation_bonus', 'label': 'Capital gen bonus', 'type': 'float', 'default': 2.0, 'min': 0.0, 'max': 100.0},
        ],
        'field_mapping': {
            'config_fields': {
                'starting_energy': 'starting_energy',
                'base_energy_per_tick': 'base_energy_per_tick',
                'region_energy_per_tick': 'region_energy_per_tick',
                'base_unit_generation_rate': 'base_unit_generation_rate',
                'capital_generation_bonus': 'capital_generation_bonus',
            },
        },
    },
    {
        'slug': 'queue-limits',
        'name': 'Queue Limits',
        'description': 'Maximum build and unit production queue sizes per region.',
        'icon': '📋',
        'default_enabled': True,
        'order': 5,
        'default_config': {
            'max_build_queue_per_region': 3,
            'max_unit_queue_per_region': 4,
        },
        'config_schema': [
            {'key': 'max_build_queue_per_region', 'label': 'Max build queue/region', 'type': 'int', 'default': 3, 'min': 1, 'max': 20},
            {'key': 'max_unit_queue_per_region', 'label': 'Max unit queue/region', 'type': 'int', 'default': 4, 'min': 1, 'max': 20},
        ],
        'field_mapping': {
            'config_fields': {
                'max_build_queue_per_region': 'max_build_queue_per_region',
                'max_unit_queue_per_region': 'max_unit_queue_per_region',
            },
        },
    },
    {
        'slug': 'disconnect',
        'name': 'Disconnect Handling',
        'description': 'Grace period before disconnected players are eliminated.',
        'icon': '🔌',
        'default_enabled': True,
        'order': 6,
        'default_config': {
            'disconnect_grace_seconds': 180,
        },
        'config_schema': [
            {'key': 'disconnect_grace_seconds', 'label': 'Grace period (seconds)', 'type': 'int', 'default': 180, 'min': 10, 'max': 600},
        ],
        'field_mapping': {
            'config_fields': {
                'disconnect_grace_seconds': 'disconnect_grace_seconds',
            },
        },
    },
    {
        'slug': 'snapshots',
        'name': 'State Snapshots',
        'description': 'Periodic game state snapshots for replay and recovery.',
        'icon': '💾',
        'default_enabled': True,
        'order': 7,
        'default_config': {
            'snapshot_interval_ticks': 30,
        },
        'config_schema': [
            {'key': 'snapshot_interval_ticks', 'label': 'Snapshot interval (ticks)', 'type': 'int', 'default': 30, 'min': 5, 'max': 300},
        ],
        'field_mapping': {
            'config_fields': {
                'snapshot_interval_ticks': 'snapshot_interval_ticks',
            },
        },
    },
]


def seed_modules(apps, schema_editor):
    GameModule = apps.get_model('game_config', 'GameModule')
    for data in MODULES:
        GameModule.objects.update_or_create(
            slug=data['slug'],
            defaults={
                'name': data['name'],
                'description': data['description'],
                'icon': data['icon'],
                'default_enabled': data['default_enabled'],
                'default_config': data['default_config'],
                'config_schema': data['config_schema'],
                'field_mapping': data['field_mapping'],
                'is_active': True,
                'order': data['order'],
            },
        )


def unseed_modules(apps, schema_editor):
    GameModule = apps.get_model('game_config', 'GameModule')
    GameModule.objects.filter(slug__in=[m['slug'] for m in MODULES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('game_config', '0020_game_modules'),
    ]

    operations = [
        migrations.RunPython(seed_modules, unseed_modules),
    ]
