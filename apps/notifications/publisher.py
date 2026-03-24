import json

from django.conf import settings

import redis

_redis_client = None


def get_redis_client():
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=0,
            decode_responses=True,
        )
    return _redis_client


def publish_social_event(user_id: str, event_type: str, payload: dict):
    """Publish an event to the social:events Redis channel.
    The Rust gateway subscribes to this and forwards to the user's WebSocket.
    """
    client = get_redis_client()
    message = json.dumps(
        {
            "type": event_type,
            "user_id": str(user_id),
            "payload": payload,
        }
    )
    client.publish("social:events", message)
