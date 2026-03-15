import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        USER = 'user', 'User'
        ADMIN = 'admin', 'Admin'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.USER)
    elo_rating = models.IntegerField(default=1000)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    is_bot = models.BooleanField(default=False)
    tutorial_completed = models.BooleanField(default=False)
    is_banned = models.BooleanField(default=False)
    banned_reason = models.TextField(blank=True, default='')

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    def __str__(self):
        return self.email

    @property
    def is_admin(self):
        return self.role == self.Role.ADMIN
