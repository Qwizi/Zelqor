import json
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone


class MatchmakingConsumer(AsyncJsonWebsocketConsumer):
    """WebSocket consumer for matchmaking queue."""
    
    queue_group = 'matchmaking_queue'

    async def connect(self):
        self.user = self.scope.get('user')
        if not self.user or self.user.is_anonymous:
            await self.close(code=4001)
            return

        await self.channel_layer.group_add(self.queue_group, self.channel_name)
        await self.accept()
        await self.add_to_queue()
        
        # Check if we have enough players
        await self.try_match()

    async def disconnect(self, close_code):
        if hasattr(self, 'user') and self.user and not self.user.is_anonymous:
            await self.remove_from_queue()
        await self.channel_layer.group_discard(self.queue_group, self.channel_name)

    async def receive_json(self, content):
        action = content.get('action')
        if action == 'cancel':
            await self.remove_from_queue()
            await self.send_json({'type': 'queue_left'})
            await self.close()
        elif action == 'status':
            count = await self.get_queue_count()
            await self.send_json({'type': 'queue_status', 'players_in_queue': count})

    @database_sync_to_async
    def add_to_queue(self):
        from apps.matchmaking.models import MatchQueue
        MatchQueue.objects.get_or_create(user=self.user)

    @database_sync_to_async
    def remove_from_queue(self):
        from apps.matchmaking.models import MatchQueue
        MatchQueue.objects.filter(user=self.user).delete()

    @database_sync_to_async
    def get_queue_count(self):
        from apps.matchmaking.models import MatchQueue
        return MatchQueue.objects.count()

    @database_sync_to_async
    def try_create_match(self):
        """Try to create a match if enough players in queue."""
        from apps.matchmaking.models import MatchQueue, Match, MatchPlayer
        from apps.game_config.models import GameSettings, MapConfig, BuildingType
        
        settings = GameSettings.get()
        min_players = settings.min_players
        
        queue_entries = list(
            MatchQueue.objects.select_related('user')
            .order_by('joined_at')[:min_players]
        )
        
        if len(queue_entries) < min_players:
            return None
        
        # Get active map config
        map_config = MapConfig.objects.filter(is_active=True).first()
        
        # Snapshot building types for the engine
        building_types = {
            bt.slug: {
                'cost': bt.cost,
                'build_time_ticks': bt.build_time_ticks,
                'defense_bonus': bt.defense_bonus,
                'vision_range': bt.vision_range,
                'unit_generation_bonus': bt.unit_generation_bonus,
                'icon': bt.icon,
                'name': bt.name,
            }
            for bt in BuildingType.objects.filter(is_active=True)
        }
        
        # Create match
        match = Match.objects.create(
            status=Match.Status.SELECTING,
            map_config=map_config,
            max_players=settings.max_players,
            started_at=timezone.now(),
            settings_snapshot={
                'tick_interval_ms': settings.tick_interval_ms,
                'capital_selection_time_seconds': settings.capital_selection_time_seconds,
                'base_unit_generation_rate': settings.base_unit_generation_rate,
                'capital_generation_bonus': settings.capital_generation_bonus,
                'attacker_advantage': settings.attacker_advantage,
                'defender_advantage': settings.defender_advantage,
                'combat_randomness': settings.combat_randomness,
                'starting_units': settings.starting_units,
                'neutral_region_units': settings.neutral_region_units,
                'building_types': building_types,
                'min_capital_distance': map_config.min_capital_distance if map_config else 3,
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
