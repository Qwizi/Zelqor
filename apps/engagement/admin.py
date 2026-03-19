from django.contrib import admin

from apps.engagement.models import (
    Achievement,
    DailyReward,
    DailyRewardClaim,
    PlayerAchievement,
    PlayerProfile,
    PlayerQuest,
    Quest,
)


@admin.register(PlayerProfile)
class PlayerProfileAdmin(admin.ModelAdmin):
    list_display = (
        'user',
        'level',
        'xp',
        'login_streak',
        'best_streak',
        'total_matches',
        'total_wins',
        'last_daily_claimed_at',
        'created_at',
    )
    list_filter = ('level',)
    search_fields = ('user__username', 'user__email')
    readonly_fields = ('id', 'created_at', 'last_daily_claimed_at')
    raw_id_fields = ('user',)


@admin.register(DailyReward)
class DailyRewardAdmin(admin.ModelAdmin):
    list_display = ('day', 'gold_reward', 'xp_reward', 'bonus_description', 'is_active')
    list_editable = ('gold_reward', 'xp_reward', 'is_active')
    ordering = ('day',)


@admin.register(DailyRewardClaim)
class DailyRewardClaimAdmin(admin.ModelAdmin):
    list_display = ('user', 'reward', 'streak_day', 'gold_earned', 'xp_earned', 'claimed_at')
    list_filter = ('claimed_at',)
    search_fields = ('user__username',)
    raw_id_fields = ('user', 'reward')
    readonly_fields = ('id', 'claimed_at')


@admin.register(Quest)
class QuestAdmin(admin.ModelAdmin):
    list_display = (
        'title',
        'quest_type',
        'objective_type',
        'objective_count',
        'gold_reward',
        'xp_reward',
        'is_active',
        'created_at',
    )
    list_filter = ('quest_type', 'objective_type', 'is_active')
    search_fields = ('title', 'description')
    list_editable = ('is_active',)
    readonly_fields = ('id', 'created_at')


@admin.register(PlayerQuest)
class PlayerQuestAdmin(admin.ModelAdmin):
    list_display = (
        'user',
        'quest',
        'progress',
        'is_completed',
        'is_claimed',
        'assigned_at',
        'expires_at',
    )
    list_filter = ('is_completed', 'is_claimed', 'quest__quest_type')
    search_fields = ('user__username', 'quest__title')
    raw_id_fields = ('user', 'quest')
    readonly_fields = ('id', 'assigned_at', 'completed_at')


@admin.register(Achievement)
class AchievementAdmin(admin.ModelAdmin):
    list_display = (
        'slug',
        'title',
        'rarity',
        'objective_type',
        'objective_count',
        'gold_reward',
        'xp_reward',
        'order',
        'is_active',
    )
    list_filter = ('rarity', 'objective_type', 'is_active')
    search_fields = ('slug', 'title', 'description')
    list_editable = ('order', 'is_active')
    prepopulated_fields = {'slug': ('title',)}
    readonly_fields = ('id',)


@admin.register(PlayerAchievement)
class PlayerAchievementAdmin(admin.ModelAdmin):
    list_display = ('user', 'achievement', 'unlocked_at')
    list_filter = ('achievement__rarity',)
    search_fields = ('user__username', 'achievement__slug', 'achievement__title')
    raw_id_fields = ('user', 'achievement')
    readonly_fields = ('id', 'unlocked_at')
