import uuid
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated
from apps.accounts.auth import ActiveUserJWTAuth
from apps.notifications.models import Notification
from apps.notifications.schemas import NotificationOutSchema
from apps.pagination import paginate_qs


@api_controller('/notifications', tags=['Notifications'], auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
class NotificationController:

    @route.get('/')
    def list_notifications(self, request, limit: int = 20, offset: int = 0):
        qs = Notification.objects.filter(user=request.auth)
        return paginate_qs(qs, limit, offset, schema=NotificationOutSchema)

    @route.get('/unread-count')
    def unread_count(self, request):
        count = Notification.objects.filter(user=request.auth, is_read=False).count()
        return {'count': count}

    @route.post('/{notification_id}/read/')
    def mark_read(self, request, notification_id: uuid.UUID):
        Notification.objects.filter(pk=notification_id, user=request.auth).update(is_read=True)
        return {'ok': True}

    @route.post('/read-all/')
    def mark_all_read(self, request):
        Notification.objects.filter(user=request.auth, is_read=False).update(is_read=True)
        return {'ok': True}
