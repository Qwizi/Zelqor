"""Decorator to gate API controllers/endpoints behind system modules."""
from functools import wraps

from django.http import JsonResponse

from apps.game_config.models import SystemModule


def require_module(slug: str):
    """
    Decorator for ninja_extra route methods.
    Returns 503 with module info if the system module is disabled.

    Usage:
        @route.get('/')
        @require_module('shop')
        def list_items(self):
            ...
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            if not SystemModule.is_enabled(slug):
                return JsonResponse(
                    {
                        'detail': f'Module "{slug}" is currently disabled.',
                        'module': slug,
                        'enabled': False,
                    },
                    status=503,
                )
            return func(*args, **kwargs)
        return wrapper
    return decorator


def require_module_controller(slug: str):
    """
    Class decorator for ninja_extra controllers.
    Wraps all route methods with the module check.

    Usage:
        @api_controller('/shop', tags=['Shop'])
        @require_module_controller('shop')
        class ShopController:
            ...
    """
    def decorator(cls):
        cls._system_module_slug = slug
        for attr_name in dir(cls):
            attr = getattr(cls, attr_name, None)
            if callable(attr) and hasattr(attr, '_ninja_operation'):
                setattr(cls, attr_name, require_module(slug)(attr))
        return cls
    return decorator
