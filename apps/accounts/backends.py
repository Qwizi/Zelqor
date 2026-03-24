from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q

User = get_user_model()


class UsernameOrEmailBackend(ModelBackend):
    """Allow login with either username or email."""

    def authenticate(self, request, email=None, password=None, **kwargs):
        # ninja-jwt sends the USERNAME_FIELD value as 'email' kwarg
        identifier = email or kwargs.get("username", "")
        if not identifier:
            return None

        try:
            user = User.objects.get(Q(email=identifier) | Q(username=identifier))
        except User.DoesNotExist:
            return None
        except User.MultipleObjectsReturned:
            # Shouldn't happen since both fields are unique, but safety net
            user = User.objects.filter(Q(email=identifier) | Q(username=identifier)).first()

        if user and user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
