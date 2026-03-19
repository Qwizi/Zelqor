from datetime import datetime
from ninja import Schema


class PlayerProfileOut(Schema):
    xp: int
    level: int
    xp_for_next_level: int
    xp_progress: float
    login_streak: int
    best_streak: int
    last_daily_claimed_at: datetime | None
    total_matches: int
    total_wins: int
    total_playtime_seconds: int


class DailyRewardOut(Schema):
    day: int
    gold_reward: int
    xp_reward: int
    bonus_description: str
    is_today: bool


class DailyStatusOut(Schema):
    can_claim: bool
    current_streak: int
    next_reward: DailyRewardOut | None
    rewards: list[DailyRewardOut]
    last_claimed_at: datetime | None


class ClaimDailyOut(Schema):
    gold_earned: int
    xp_earned: int
    new_streak: int
    levels_gained: int
    new_level: int


class QuestOut(Schema):
    id: str
    title: str
    description: str
    objective_type: str
    objective_count: int
    progress: int
    gold_reward: int
    xp_reward: int
    is_completed: bool
    is_claimed: bool
    quest_type: str
    expires_at: datetime | None


class ClaimQuestOut(Schema):
    gold_earned: int
    xp_earned: int
    levels_gained: int
    new_level: int


class AchievementOut(Schema):
    id: str
    slug: str
    title: str
    description: str
    icon: str
    objective_type: str
    objective_count: int
    gold_reward: int
    xp_reward: int
    rarity: str
    is_unlocked: bool
    unlocked_at: datetime | None


class EngagementSummaryOut(Schema):
    profile: PlayerProfileOut
    daily: DailyStatusOut
    active_quests: list[QuestOut]
    recent_achievements: list[AchievementOut]
