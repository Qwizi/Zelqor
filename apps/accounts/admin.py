from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from unfold.admin import ModelAdmin
from unfold.decorators import display
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm
from unfold.contrib.filters.admin import RangeNumericFilter
from apps.accounts.models import User
from apps.inventory.admin import UserInventoryInline, EquippedCosmeticInline, DeckInline, ItemInstanceInline


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm
    list_display = ('email', 'username', 'display_role', 'display_elo', 'is_staff', 'is_active', 'is_banned')
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
    inlines = [ItemInstanceInline, UserInventoryInline, EquippedCosmeticInline, DeckInline]
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Game', {'fields': ('role', 'elo_rating', 'avatar', 'tutorial_completed', 'is_banned', 'banned_reason')}),
    )

    @display(description="Role", label={"USER": "info", "ADMIN": "danger"})
    def display_role(self, obj):
        return obj.role

    @display(description="ELO", ordering="elo_rating")
    def display_elo(self, obj):
        return obj.elo_rating
