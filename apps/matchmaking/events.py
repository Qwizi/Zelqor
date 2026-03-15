"""Publish lobby events to Redis pub/sub for the Rust gateway to consume."""
import json
import logging
import redis
from django.conf import settings

logger = logging.getLogger(__name__)

LOBBY_EVENTS_CHANNEL = 'lobby:events'


def _get_redis():
    return redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=settings.REDIS_GAME_DB,
    )


def publish_lobby_event(event_type: str, lobby_id: str, **kwargs):
    """Publish an event to the lobby:events Redis channel.

    The Rust gateway subscribes to this channel and reacts accordingly
    (e.g., broadcasting WS messages, closing connections).
    """
    payload = {
        'type': event_type,
        'lobby_id': lobby_id,
        **kwargs,
    }
    try:
        r = _get_redis()
        r.publish(LOBBY_EVENTS_CHANNEL, json.dumps(payload))
    except Exception as e:
        logger.warning(f"Failed to publish lobby event: {e}")
