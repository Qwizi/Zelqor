import json
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone


class MatchmakingConsumer(AsyncJsonWebsocketConsumer):
    """WebSocket consumer for matchmaking queue."""

    queue_group_prefix = 'matchmaking_queue'

    async def connect(self):
        self.user = self.scope.get('user')
        self.joined_queue = False
        self.game_mode_slug = self.scope['url_route']['kwargs'].get('game_mode', None)
        self.queue_group = f'{self.queue_group_prefix}_{self.game_mode_slug}' if self.game_mode_slug else self.queue_group_prefix

        if not self.user or self.user.is_anonymous:
            await self.close(code=4001)
            return

        await self.channel_layer.group_add(self.queue_group, self.channel_name)
        await self.accept()
        active_match_id = await self.get_active_match_id()
        if active_match_id:
            await self.remove_from_queue()
            await self.send_json({
                'type': 'active_match_exists',
                'match_id': active_match_id,
            })
            await self.close()
            return
        await self.add_to_queue()
        self.joined_queue = True
        await self.broadcast_queue_count()

        # Check if we have enough players
        await self.try_match()

    async def disconnect(self, close_code):
        if getattr(self, 'joined_queue', False) and hasattr(self, 'user') and self.user and not self.user.is_anonymous:
            await self.remove_from_queue()
            await self.broadcast_queue_count()
        await self.channel_layer.group_discard(self.queue_group, self.channel_name)

    async def receive_json(self, content):
        action = content.get('action')
        if action == 'cancel':
            await self.remove_from_queue()
            self.joined_queue = False
            await self.broadcast_queue_count()
            await self.send_json({'type': 'queue_left'})
            await self.close()
        elif action == 'status':
            count = await self.get_queue_count()
            await self.send_json({'type': 'queue_status', 'players_in_queue': count})

    @database_sync_to_async
    def _get_game_mode(self):
        from apps.game_config.models import GameMode
        if self.game_mode_slug:
            return GameMode.objects.filter(slug=self.game_mode_slug, is_active=True).first()
        return GameMode.objects.filter(is_default=True, is_active=True).first()

    @database_sync_to_async
    def add_to_queue(self):
        from apps.matchmaking.models import MatchQueue
        from apps.game_config.models import GameMode
        game_mode = None
        if self.game_mode_slug:
            game_mode = GameMode.objects.filter(slug=self.game_mode_slug, is_active=True).first()
        else:
            game_mode = GameMode.objects.filter(is_default=True, is_active=True).first()
        MatchQueue.objects.update_or_create(
            user=self.user,
            defaults={'game_mode': game_mode},
        )

    @database_sync_to_async
    def remove_from_queue(self):
        from apps.matchmaking.models import MatchQueue
        MatchQueue.objects.filter(user=self.user).delete()

    @database_sync_to_async
    def get_queue_count(self):
        from apps.matchmaking.models import MatchQueue
        from apps.game_config.models import GameMode
        game_mode = None
        if self.game_mode_slug:
            game_mode = GameMode.objects.filter(slug=self.game_mode_slug, is_active=True).first()
        else:
            game_mode = GameMode.objects.filter(is_default=True, is_active=True).first()
        if game_mode:
            return MatchQueue.objects.filter(game_mode=game_mode).count()
        return MatchQueue.objects.count()

    @database_sync_to_async
    def get_active_match_id(self):
        from apps.matchmaking.models import Match

        return (
            Match.objects.filter(
                players__user=self.user,
                players__is_alive=True,
                status__in=[Match.Status.SELECTING, Match.Status.IN_PROGRESS],
            )
            .order_by('-created_at')
            .values_list('id', flat=True)
            .first()
        )

    @database_sync_to_async
    def try_create_match(self):
        """Try to create a match if enough players in queue for the game mode."""
        from apps.matchmaking.models import MatchQueue, Match, MatchPlayer
        from apps.game_config.models import GameSettings, GameMode, MapConfig, BuildingType, UnitType

        # Resolve game mode
        if self.game_mode_slug:
            game_mode = GameMode.objects.filter(slug=self.game_mode_slug, is_active=True).first()
        else:
            game_mode = GameMode.objects.filter(is_default=True, is_active=True).first()

        if not game_mode:
            # Fallback to legacy GameSettings singleton
            settings = GameSettings.get()
            min_players = settings.min_players
            max_players = settings.max_players
        else:
            min_players = game_mode.min_players
            max_players = game_mode.max_players

        # Get queue entries for this game mode
        queue_qs = MatchQueue.objects.select_related('user').order_by('joined_at')
        if game_mode:
            queue_qs = queue_qs.filter(game_mode=game_mode)

        queue_entries = list(queue_qs[:min_players])

        if len(queue_entries) < min_players:
            return None

        # Get map config from game mode or fallback
        if game_mode and game_mode.map_config:
            map_config = game_mode.map_config
        else:
            map_config = MapConfig.objects.filter(is_active=True).first()

        # Snapshot building types for the engine
        building_types = {
            bt.slug: {
                'cost': bt.cost,
                'currency_cost': bt.currency_cost,
                'build_time_ticks': bt.build_time_ticks,
                'max_per_region': bt.max_per_region,
                'defense_bonus': bt.defense_bonus,
                'vision_range': bt.vision_range,
                'unit_generation_bonus': bt.unit_generation_bonus,
                'currency_generation_bonus': bt.currency_generation_bonus,
                'requires_coastal': bt.requires_coastal,
                'icon': bt.icon,
                'name': bt.name,
                'asset_key': bt.asset_key,
                'order': bt.order,
                'produced_unit_slug': (
                    bt.unit_types.filter(is_active=True).order_by('order').values_list('slug', flat=True).first()
                ),
            }
            for bt in BuildingType.objects.filter(is_active=True)
        }

        unit_types = {
            ut.slug: {
                'name': ut.name,
                'asset_key': ut.asset_key,
                'attack': float(ut.attack),
                'defense': float(ut.defense),
                'speed': int(ut.speed),
                'attack_range': int(ut.attack_range),
                'sea_range': int(ut.sea_range),
                'sea_hop_distance_km': int(ut.sea_hop_distance_km),
                'movement_type': ut.movement_type,
                'produced_by_slug': ut.produced_by.slug if ut.produced_by_id else None,
                'production_cost': int(ut.production_cost),
                'production_time_ticks': int(ut.production_time_ticks),
                'manpower_cost': int(ut.manpower_cost),
            }
            for ut in UnitType.objects.select_related('produced_by').filter(is_active=True)
        }

        default_unit_type_slug = (
            UnitType.objects.filter(is_active=True, produced_by__isnull=True)
            .order_by('order')
            .values_list('slug', flat=True)
            .first()
            or 'infantry'
        )

        # Build settings snapshot from game mode or legacy settings
        if game_mode:
            src = game_mode
        else:
            src = GameSettings.get()

        match = Match.objects.create(
            status=Match.Status.SELECTING,
            game_mode=game_mode,
            map_config=map_config,
            max_players=max_players,
            started_at=timezone.now(),
            settings_snapshot={
                'tick_interval_ms': src.tick_interval_ms,
                'capital_selection_time_seconds': src.capital_selection_time_seconds,
                'base_unit_generation_rate': src.base_unit_generation_rate,
                'capital_generation_bonus': src.capital_generation_bonus,
                'starting_currency': src.starting_currency,
                'base_currency_per_tick': src.base_currency_per_tick,
                'region_currency_per_tick': src.region_currency_per_tick,
                'attacker_advantage': src.attacker_advantage,
                'defender_advantage': src.defender_advantage,
                'combat_randomness': src.combat_randomness,
                'starting_units': src.starting_units,
                'neutral_region_units': src.neutral_region_units,
                'building_types': building_types,
                'unit_types': unit_types,
                'default_unit_type_slug': default_unit_type_slug,
                'min_capital_distance': map_config.min_capital_distance if map_config else 3,
                'elo_k_factor': src.elo_k_factor,
            },
        )

        colors = ['#FF4444', '#4444FF', '#44FF44', '#FFFF44', '#FF44FF', '#44FFFF', '#FF8844', '#8844FF']

        users = []
        for i, entry in enumerate(queue_entries):
            MatchPlayer.objects.create(
                match=match,
                user=entry.user,
                color=colors[i % len(colors)],
            )
            users.append(str(entry.user.id))
            entry.delete()

        return {
            'match_id': str(match.id),
            'user_ids': users,
        }

    async def try_match(self):
        result = await self.try_create_match()
        if result:
            # Notify all players in the queue group about the match
            await self.channel_layer.group_send(
                self.queue_group,
                {
                    'type': 'match_found',
                    'match_id': result['match_id'],
                    'user_ids': result['user_ids'],
                }
            )

    async def match_found(self, event):
        """Handle match_found message from channel layer."""
        user_id = str(self.user.id) if hasattr(self, 'user') else None
        if user_id in event.get('user_ids', []):
            await self.send_json({
                'type': 'match_found',
                'match_id': event['match_id'],
            })
            await self.close()
        else:
            # Not in this match, update queue count
            count = await self.get_queue_count()
            await self.send_json({
                'type': 'queue_status',
                'players_in_queue': count,
            })

    async def queue_update(self, event):
        """Broadcast queue size updates."""
        await self.send_json({
            'type': 'queue_status',
            'players_in_queue': event.get('count', 0),
        })

    async def broadcast_queue_count(self):
        count = await self.get_queue_count()
        await self.channel_layer.group_send(
            self.queue_group,
            {
                'type': 'queue_update',
                'count': count,
            }
        )
