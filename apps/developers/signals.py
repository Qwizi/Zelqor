import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(post_save, sender='matchmaking.Match')
def match_status_changed(sender, instance, created, **kwargs):
    """Dispatch webhook events when match status changes."""
    from apps.developers.tasks import dispatch_webhook_event

    update_fields = kwargs.get('update_fields')

    if instance.status == 'in_progress':
        dispatch_webhook_event('match.started', {
            'match_id': str(instance.id),
            'max_players': instance.max_players,
            'created_at': str(instance.created_at),
        })
