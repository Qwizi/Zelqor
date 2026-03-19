from django.core.management.base import BaseCommand

from apps.engagement.models import Achievement, DailyReward, Quest


DAILY_REWARDS = [
    {'day': 1, 'gold_reward': 10,  'xp_reward': 25,  'bonus_description': ''},
    {'day': 2, 'gold_reward': 15,  'xp_reward': 30,  'bonus_description': ''},
    {'day': 3, 'gold_reward': 20,  'xp_reward': 40,  'bonus_description': ''},
    {'day': 4, 'gold_reward': 25,  'xp_reward': 50,  'bonus_description': ''},
    {'day': 5, 'gold_reward': 30,  'xp_reward': 60,  'bonus_description': ''},
    {'day': 6, 'gold_reward': 40,  'xp_reward': 75,  'bonus_description': ''},
    {'day': 7, 'gold_reward': 75,  'xp_reward': 150, 'bonus_description': 'Tygodniowa nagroda!'},
]

DAILY_QUESTS = [
    {
        'quest_type': 'daily',
        'title': 'Rozegraj 2 mecze',
        'description': 'Rozegraj 2 mecze w trybie multiplayer.',
        'objective_type': 'play_matches',
        'objective_count': 2,
        'gold_reward': 30,
        'xp_reward': 50,
    },
    {
        'quest_type': 'daily',
        'title': 'Wygraj mecz',
        'description': 'Wygraj 1 mecz w trybie multiplayer.',
        'objective_type': 'win_matches',
        'objective_count': 1,
        'gold_reward': 50,
        'xp_reward': 75,
    },
    {
        'quest_type': 'daily',
        'title': 'Zdobądź 5 regionów',
        'description': 'Podbij łącznie 5 regionów w jednym lub kilku meczach.',
        'objective_type': 'conquer_regions',
        'objective_count': 5,
        'gold_reward': 40,
        'xp_reward': 60,
    },
]

WEEKLY_QUESTS = [
    {
        'quest_type': 'weekly',
        'title': 'Rozegraj 10 meczy',
        'description': 'Rozegraj 10 meczy w ciągu tygodnia.',
        'objective_type': 'play_matches',
        'objective_count': 10,
        'gold_reward': 150,
        'xp_reward': 200,
    },
    {
        'quest_type': 'weekly',
        'title': 'Wygraj 5 meczy',
        'description': 'Wygraj 5 meczy w ciągu tygodnia.',
        'objective_type': 'win_matches',
        'objective_count': 5,
        'gold_reward': 250,
        'xp_reward': 350,
    },
]

ACHIEVEMENTS = [
    {
        'slug': 'first_match',
        'title': 'Pierwszy mecz',
        'description': 'Zagraj swój pierwszy mecz.',
        'icon': 'sports_esports',
        'objective_type': 'play_matches',
        'objective_count': 1,
        'gold_reward': 50,
        'xp_reward': 100,
        'rarity': 'common',
        'order': 10,
    },
    {
        'slug': 'first_win',
        'title': 'Pierwsze zwycięstwo',
        'description': 'Wygraj swój pierwszy mecz.',
        'icon': 'emoji_events',
        'objective_type': 'win_matches',
        'objective_count': 1,
        'gold_reward': 100,
        'xp_reward': 150,
        'rarity': 'common',
        'order': 20,
    },
    {
        'slug': 'conquer_50',
        'title': 'Zdobywca',
        'description': 'Podbij łącznie 50 regionów.',
        'icon': 'flag',
        'objective_type': 'conquer_regions',
        'objective_count': 50,
        'gold_reward': 200,
        'xp_reward': 300,
        'rarity': 'uncommon',
        'order': 30,
    },
    {
        'slug': 'win_10',
        'title': 'Doświadczony gracz',
        'description': 'Wygraj 10 meczy.',
        'icon': 'military_tech',
        'objective_type': 'win_matches',
        'objective_count': 10,
        'gold_reward': 500,
        'xp_reward': 750,
        'rarity': 'rare',
        'order': 40,
    },
    {
        'slug': 'streak_7',
        'title': 'Tygodniowy gracz',
        'description': 'Utrzymaj passę logowania przez 7 dni z rzędu.',
        'icon': 'local_fire_department',
        'objective_type': 'login_streak',
        'objective_count': 7,
        'gold_reward': 300,
        'xp_reward': 400,
        'rarity': 'uncommon',
        'order': 50,
    },
]


class Command(BaseCommand):
    help = 'Seed initial engagement data: daily rewards, quests, and achievements.'

    def handle(self, *args, **options):
        self._seed_daily_rewards()
        self._seed_quests()
        self._seed_achievements()
        self.stdout.write(self.style.SUCCESS('Engagement data seeded successfully.'))

    def _seed_daily_rewards(self):
        created_count = 0
        for data in DAILY_REWARDS:
            _, created = DailyReward.objects.update_or_create(
                day=data['day'],
                defaults={
                    'gold_reward': data['gold_reward'],
                    'xp_reward': data['xp_reward'],
                    'bonus_description': data['bonus_description'],
                    'is_active': True,
                },
            )
            if created:
                created_count += 1
        self.stdout.write(f'  Daily rewards: {created_count} created / {len(DAILY_REWARDS) - created_count} updated.')

    def _seed_quests(self):
        all_quests = DAILY_QUESTS + WEEKLY_QUESTS
        created_count = 0
        for data in all_quests:
            _, created = Quest.objects.update_or_create(
                title=data['title'],
                quest_type=data['quest_type'],
                defaults={
                    'description': data['description'],
                    'objective_type': data['objective_type'],
                    'objective_count': data['objective_count'],
                    'gold_reward': data['gold_reward'],
                    'xp_reward': data['xp_reward'],
                    'is_active': True,
                },
            )
            if created:
                created_count += 1
        self.stdout.write(f'  Quests: {created_count} created / {len(all_quests) - created_count} updated.')

    def _seed_achievements(self):
        created_count = 0
        for data in ACHIEVEMENTS:
            _, created = Achievement.objects.update_or_create(
                slug=data['slug'],
                defaults={
                    'title': data['title'],
                    'description': data['description'],
                    'icon': data['icon'],
                    'objective_type': data['objective_type'],
                    'objective_count': data['objective_count'],
                    'gold_reward': data['gold_reward'],
                    'xp_reward': data['xp_reward'],
                    'rarity': data['rarity'],
                    'order': data['order'],
                    'is_active': True,
                },
            )
            if created:
                created_count += 1
        self.stdout.write(
            f'  Achievements: {created_count} created / {len(ACHIEVEMENTS) - created_count} updated.'
        )
