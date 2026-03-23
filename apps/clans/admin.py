from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.clans.models import (
    Clan,
    ClanActivityLog,
    ClanChatMessage,
    ClanInvitation,
    ClanJoinRequest,
    ClanLevel,
    ClanMembership,
    ClanWar,
    ClanWarParticipant,
)


@admin.register(Clan)
class ClanAdmin(ModelAdmin):
    list_display = ('tag', 'name', 'leader', 'level', 'elo_rating', 'member_count', 'is_recruiting', 'created_at')
    list_select_related = ('leader',)
    list_filter = ('level', 'is_recruiting', 'is_public')
    search_fields = ('name', 'tag')
    list_fullwidth = True
    readonly_fields = ('id', 'created_at')
    ordering = ('-created_at',)


@admin.register(ClanMembership)
class ClanMembershipAdmin(ModelAdmin):
    list_display = ('user', 'clan', 'role', 'joined_at', 'contributions_gold')
    list_select_related = ('user', 'clan')
    list_filter = ('role',)
    list_fullwidth = True
    readonly_fields = ('id', 'joined_at')


@admin.register(ClanInvitation)
class ClanInvitationAdmin(ModelAdmin):
    list_display = ('clan', 'invited_user', 'invited_by', 'status', 'created_at', 'expires_at')
    list_select_related = ('clan', 'invited_user', 'invited_by')
    list_filter = ('status',)
    list_fullwidth = True
    readonly_fields = ('id', 'created_at')
    ordering = ('-created_at',)


@admin.register(ClanJoinRequest)
class ClanJoinRequestAdmin(ModelAdmin):
    list_display = ('user', 'clan', 'status', 'created_at')
    list_select_related = ('user', 'clan')
    list_filter = ('status',)
    list_fullwidth = True
    readonly_fields = ('id', 'created_at')
    ordering = ('-created_at',)


@admin.register(ClanActivityLog)
class ClanActivityLogAdmin(ModelAdmin):
    list_display = ('clan', 'actor', 'action', 'created_at')
    list_select_related = ('clan', 'actor')
    list_filter = ('action',)
    list_fullwidth = True
    readonly_fields = ('id', 'created_at')
    ordering = ('-created_at',)


@admin.register(ClanLevel)
class ClanLevelAdmin(ModelAdmin):
    list_display = ('level', 'experience_required', 'max_members', 'treasury_cap')
    list_fullwidth = True
    ordering = ('level',)


@admin.register(ClanChatMessage)
class ClanChatMessageAdmin(ModelAdmin):
    list_display = ('clan', 'user', 'content', 'created_at')
    list_select_related = ('clan', 'user')
    list_fullwidth = True
    readonly_fields = ('id', 'created_at')
    ordering = ('-created_at',)


@admin.register(ClanWar)
class ClanWarAdmin(ModelAdmin):
    list_display = ('challenger', 'defender', 'status', 'winner', 'players_per_side', 'wager_gold', 'created_at')
    list_select_related = ('challenger', 'defender', 'winner')
    list_filter = ('status',)
    list_fullwidth = True
    readonly_fields = ('id', 'created_at')
    ordering = ('-created_at',)


@admin.register(ClanWarParticipant)
class ClanWarParticipantAdmin(ModelAdmin):
    list_display = ('war', 'clan', 'user')
    list_select_related = ('war', 'clan', 'user')
    list_fullwidth = True
    readonly_fields = ('id',)
