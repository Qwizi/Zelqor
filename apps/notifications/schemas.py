import uuid
from datetime import datetime
from ninja import Schema


class NotificationOutSchema(Schema):
    id: uuid.UUID
    type: str
    title: str
    body: str
    data: dict
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True
