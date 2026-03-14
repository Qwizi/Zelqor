import logging
import random

from celery import shared_task
from django.db import transaction

logger = logging.getLogger(__name__)

# Drop weights by rarity (higher = more common)
RARITY_WEIGHTS = {
    'common': 50,
    'uncommon': 25,
    'rare': 15,
    'epic': 8,
    'legendary': 2,
}

# Placement bonuses: placement -> (min_drops, max_drops, gold_reward, crate_chance, key_chance)
PLACEMENT_REWARDS = {
    1: (3, 5, 100, 0.20, 0.10),  # Winner
    2: (2, 3, 60, 0.12, 0.06),
    3: (1, 2, 40, 0.08, 0.04),
    4: (1, 2, 30, 0.05, 0.03),
}
DEFAULT_REWARD = (1, 1, 20, 0.03, 0.02)


def generate_match_drops(match_id: str):
    """Generate item drops for all players after a match finishes.

    Called from finalize_match_results_sync.
    """
    from apps.game.models import PlayerResult
    from apps.inventory.models import Item, ItemDrop, Wallet
    from apps.inventory.views import add_item_to_inventory

    player_results = (
        PlayerResult.objects
        .filter(match_result__match_id=match_id)
        .select_related('user', 'match_result__match')
    )

    if not player_results.exists():
        return

    # Get droppable materials
    materials = list(
        Item.objects.filter(
            item_type=Item.ItemType.MATERIAL,
            is_active=True,
        )
    )
    crates = list(
        Item.objects.filter(
            item_type=Item.ItemType.CRATE,
            is_active=True,
        )
    )
    keys = list(
        Item.objects.filter(
            item_type=Item.ItemType.KEY,
            is_active=True,
        )
    )

    if not materials:
        logger.warning("No materials defined, skipping drops for match %s", match_id)
        return

    # Group materials by rarity
    materials_by_rarity = {}
    for mat in materials:
        materials_by_rarity.setdefault(mat.rarity, []).append(mat)

    match_obj = player_results.first().match_result.match

    for pr in player_results:
        if pr.user.is_bot:
            continue

        rewards = PLACEMENT_REWARDS.get(pr.placement, DEFAULT_REWARD)
        min_drops, max_drops, gold_reward, crate_chance, key_chance = rewards

        with transaction.atomic():
            # Gold reward
            wallet, _ = Wallet.objects.get_or_create(user=pr.user)
            wallet.gold += gold_reward
            wallet.total_earned += gold_reward
            wallet.save(update_fields=['gold', 'total_earned'])

            # Material drops
            num_drops = random.randint(min_drops, max_drops)
            for _ in range(num_drops):
                rarity = _weighted_rarity_roll(pr.placement)
                pool = materials_by_rarity.get(rarity, materials_by_rarity.get('common', []))
                if not pool:
                    continue
                drop_item = random.choice(pool)
                qty = 1 if rarity in ('epic', 'legendary') else random.randint(1, 3)
                add_item_to_inventory(pr.user, drop_item, qty)
                ItemDrop.objects.create(
                    user=pr.user, item=drop_item, quantity=qty,
                    source=ItemDrop.DropSource.MATCH_REWARD,
                    match=match_obj,
                )

            # Crate drop
            if crates and random.random() < crate_chance:
                crate = random.choice(crates)
                add_item_to_inventory(pr.user, crate, 1)
                ItemDrop.objects.create(
                    user=pr.user, item=crate, quantity=1,
                    source=ItemDrop.DropSource.MATCH_REWARD,
                    match=match_obj,
                )

            # Key drop
            if keys and random.random() < key_chance:
                key = random.choice(keys)
                add_item_to_inventory(pr.user, key, 1)
                ItemDrop.objects.create(
                    user=pr.user, item=key, quantity=1,
                    source=ItemDrop.DropSource.MATCH_REWARD,
                    match=match_obj,
                )

    logger.info("Generated drops for %d players in match %s", player_results.count(), match_id)


def _weighted_rarity_roll(placement: int) -> str:
    """Roll a rarity with placement-based bonus to rare+ drops."""
    weights = dict(RARITY_WEIGHTS)
    # Better placement = slightly better odds for rarer items
    if placement == 1:
        weights['rare'] += 5
        weights['epic'] += 3
        weights['legendary'] += 1
    elif placement == 2:
        weights['rare'] += 3
        weights['epic'] += 1

    rarities = list(weights.keys())
    rarity_weights = list(weights.values())
    return random.choices(rarities, weights=rarity_weights, k=1)[0]


@shared_task
def generate_match_drops_task(match_id: str):
    """Celery wrapper for post-match drop generation."""
    generate_match_drops(match_id)
