from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.db import models
from django.shortcuts import redirect
from django.utils.html import format_html
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import action, display
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm
from unfold.contrib.filters.admin import RangeNumericFilter
from apps.accounts.models import DirectMessage, Friendship, SocialAccount, User
from apps.inventory.admin import UserInventoryInline, EquippedCosmeticInline, DeckInline, ItemInstanceInline


class SocialAccountInline(TabularInline):
    model = SocialAccount
    extra = 0
    fields = ('provider', 'provider_user_id', 'email', 'display_name', 'created_at')
    readonly_fields = ('created_at',)


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm
    list_display = ('email', 'username', 'display_role', 'display_elo', 'display_social', 'is_staff', 'is_active', 'is_banned')
    list_filter = (
        'role',
        'is_staff',
        'is_active',
        'is_banned',
        'banned_reason',
        ('elo_rating', RangeNumericFilter),
    )
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ('email', 'username')
    ordering = ('email',)
    warn_unsaved_form = True
    actions_detail = ['merge_into_user']
    inlines = [SocialAccountInline, EquippedCosmeticInline, DeckInline]
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Game', {'fields': ('role', 'elo_rating', 'avatar', 'tutorial_completed', 'is_banned', 'banned_reason')}),
    )

    @display(description="Role", label={"USER": "info", "ADMIN": "danger"})
    def display_role(self, obj):
        return obj.role

    @display(description="ELO", ordering="elo_rating")
    def display_elo(self, obj):
        return obj.elo_rating

    @display(description="Social")
    def display_social(self, obj):
        providers = list(obj.social_accounts.values_list('provider', flat=True))
        if not providers:
            return '-'
        return ', '.join(p.capitalize() for p in providers)

    @action(description="Scal konto do innego użytkownika", url_path="merge-into-user")
    def merge_into_user(self, request, object_id):
        """Admin detail action: merge this user's data into another user.

        Expects a query-string parameter ``target_user_id``. All related
        objects that reference the source user (via FK) are re-pointed to
        the target, social accounts are moved, and the source user is
        deactivated.
        """
        source = User.objects.get(pk=object_id)
        target_id = request.GET.get('target_user_id') or request.POST.get('target_user_id')

        if not target_id:
            from django.contrib import messages
            messages.error(request, 'Podaj target_user_id jako parametr query-string, np. ?target_user_id=UUID')
            return redirect(request.META.get('HTTP_REFERER', f'/admin/accounts/user/{object_id}/change/'))

        target = User.objects.filter(pk=target_id).first()
        if not target:
            from django.contrib import messages
            messages.error(request, f'Nie znaleziono użytkownika o ID: {target_id}')
            return redirect(request.META.get('HTTP_REFERER', f'/admin/accounts/user/{object_id}/change/'))

        if str(source.pk) == str(target.pk):
            from django.contrib import messages
            messages.error(request, 'Nie można scalić użytkownika z samym sobą.')
            return redirect(request.META.get('HTTP_REFERER', f'/admin/accounts/user/{object_id}/change/'))

        # Move social accounts
        source.social_accounts.update(user=target)

        # Move all FK-related objects: iterate over reverse relations
        for rel in User._meta.get_fields():
            if not rel.one_to_many and not rel.one_to_one:
                continue
            if rel.related_model is SocialAccount:
                continue  # already handled
            accessor = rel.get_accessor_name()
            related_qs = getattr(source, accessor)
            if hasattr(related_qs, 'all'):
                related_qs.all().update(**{rel.field.name: target})

        # Merge ELO: keep the higher rating
        if source.elo_rating > target.elo_rating:
            target.elo_rating = source.elo_rating
            target.save(update_fields=['elo_rating'])

        # Deactivate source
        source.is_active = False
        source.save(update_fields=['is_active'])

        from django.contrib import messages
        messages.success(
            request,
            f'Scalono użytkownika {source.username} → {target.username}. '
            f'Konto źródłowe zostało dezaktywowane.'
        )
        return redirect(f'/admin/accounts/user/{target.pk}/change/')


@admin.register(SocialAccount)
class SocialAccountAdmin(ModelAdmin):
    list_display = ('user', 'provider', 'display_name', 'email', 'created_at')
    list_filter = ('provider',)
    search_fields = ('user__email', 'user__username', 'display_name', 'email', 'provider_user_id')
    raw_id_fields = ('user',)
    readonly_fields = ('created_at', 'updated_at')


@admin.register(DirectMessage)
class DirectMessageAdmin(ModelAdmin):
    list_display = ('sender', 'receiver', 'content', 'is_read', 'created_at')
    list_filter = ('is_read',)
    search_fields = ('sender__username', 'receiver__username', 'content')
    raw_id_fields = ('sender', 'receiver')


@admin.register(Friendship)
class FriendshipAdmin(ModelAdmin):
    list_display = ('from_user', 'to_user', 'status', 'created_at', 'updated_at')
    list_filter = ('status',)
    search_fields = ('from_user__email', 'from_user__username', 'to_user__email', 'to_user__username')
    raw_id_fields = ('from_user', 'to_user')
    readonly_fields = ('created_at', 'updated_at')
