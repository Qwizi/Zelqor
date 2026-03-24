import logging
import random

from celery import shared_task
from django.db import transaction

logger = logging.getLogger(__name__)

# Rarity weights by placement role
# Winner gets better odds for rarer items; loser gets heavier common weighting
WINNER_RARITY_WEIGHTS = {
    'common': 40,
    'uncommon': 35,
    'rare': 18,
    'epic': 5,
    'legendary': 2,
}

LOSER_RARITY_WEIGHTS = {
    'common': 55,
    'uncommon': 28,
    'rare': 12,
    'epic': 4,
    'legendary': 1,
}

# Excluded item types from random drops (crates, keys, and cosmetics are not rewarded this way)
_EXCLUDED_TYPES = {
    'crate',
    'key',
    'cosmetic',
}

# Gold and drop count constants
WINNER_GOLD = 80
LOSER_GOLD = 35
WINNER_DROPS = (4, 7)
LOSER_DROPS = (2, 4)

# Drop category weights (out of 100)
MATERIAL_DROP_WEIGHT = 70
EQUIPMENT_DROP_WEIGHT = 20  # blueprints, tactical packages, boosts
OTHER_DROP_WEIGHT = 10

_MATERIAL_TYPE = 'material'
_EQUIPMENT_TYPES = {'blueprint_building', 'blueprint_unit', 'tactical_package', 'boost'}


def generate_match_drops(match_id: str):
    """Generate item drops for all players after a match finishes.

    Called from finalize_match_results_sync inside apps/game/tasks.py.

    Winner (placement=1): 80 gold + 4-7 random item drops (winner rarity weights).
    Loser (placement>1): 35 gold + 2-4 random item drops (loser rarity weights).

    Drop pool is split into weighted categories:
      - 70% materials (2-4 quantity per drop to ensure Tier 0/1 raw materials flow)
      - 20% equipment (blueprints, tactical packages, boosts) — qty 1
      - 10% any item from full pool — qty 1

    Creates ItemDrop records with source='match_reward' and match FK.
    Adds items to UserInventory and gold to Wallet.
    """
    from apps.game.models import PlayerResult
    from apps.inventory.models import Item, ItemDrop, UserInventory, Wallet
    from apps.inventory.views import add_item_to_inventory

    player_results = list(
        PlayerResult.objects
        .filter(match_result__match_id=match_id)
        .select_related('user', 'match_result__match')
    )

    if not player_results:
        logger.warning("No player results found for match %s, skipping drops", match_id)
        return

    # Fetch all droppable items (exclude crate, key, cosmetic)
    droppable_items = list(
        Item.objects.filter(is_active=True)
        .exclude(item_type__in=list(_EXCLUDED_TYPES))
    )

    if not droppable_items:
        logger.warning("No droppable items defined, skipping drops for match %s", match_id)
        return

    # Group full pool by rarity for weighted selection (fallback / other pool)
    items_by_rarity: dict[str, list] = {}
    for item in droppable_items:
        items_by_rarity.setdefault(item.rarity, []).append(item)

    # All rarities available in the full pool (for fallback)
    all_rarities = list(items_by_rarity.keys())

    # Separate pools by drop category
    material_items = [i for i in droppable_items if i.item_type == _MATERIAL_TYPE]
    equipment_items = [i for i in droppable_items if i.item_type in _EQUIPMENT_TYPES]

    # Group each category pool by rarity
    materials_by_rarity: dict[str, list] = {}
    for item in material_items:
        materials_by_rarity.setdefault(item.rarity, []).append(item)

    equipment_by_rarity: dict[str, list] = {}
    for item in equipment_items:
        equipment_by_rarity.setdefault(item.rarity, []).append(item)

    match_obj = player_results[0].match_result.match

    for pr in player_results:
        if pr.user.is_bot:
            continue

        is_winner = pr.placement == 1
        gold_reward = WINNER_GOLD if is_winner else LOSER_GOLD
        min_drops, max_drops = WINNER_DROPS if is_winner else LOSER_DROPS
        rarity_weights = WINNER_RARITY_WEIGHTS if is_winner else LOSER_RARITY_WEIGHTS

        with transaction.atomic():
            # Add gold to wallet
            wallet, _ = Wallet.objects.get_or_create(user=pr.user)
            wallet.gold += gold_reward
            wallet.total_earned += gold_reward
            wallet.save(update_fields=['gold', 'total_earned'])

            # Roll item drops
            num_drops = random.randint(min_drops, max_drops)
            for _ in range(num_drops):
                # Decide drop category based on weighted roll
                category_roll = random.randint(1, 100)
                if category_roll <= MATERIAL_DROP_WEIGHT and material_items:
                    # Material drop — use material pool, give 2-4 quantity
                    pool_by_rarity = materials_by_rarity
                    pool_all = material_items
                    drop_qty = random.randint(2, 4)
                elif category_roll <= MATERIAL_DROP_WEIGHT + EQUIPMENT_DROP_WEIGHT and equipment_items:
                    # Equipment drop — blueprints, tactical packages, boosts
                    pool_by_rarity = equipment_by_rarity
                    pool_all = equipment_items
                    drop_qty = 1
                else:
                    # Any item from the full droppable pool
                    pool_by_rarity = items_by_rarity
                    pool_all = droppable_items
                    drop_qty = 1

                rarity = _roll_rarity(rarity_weights, list(pool_by_rarity.keys()) or all_rarities)
                pool = pool_by_rarity.get(rarity, pool_all)
                drop_item = random.choice(pool)

                # Add to inventory (handles both stackable and non-stackable)
                result = add_item_to_inventory(
                    pr.user,
                    drop_item,
                    drop_qty,
                    dropped_from_match=match_obj,
                )
                instance = result if hasattr(result, 'pattern_seed') else None

                # Record the drop
                ItemDrop.objects.create(
                    user=pr.user,
                    item=drop_item,
                    quantity=drop_qty,
                    source=ItemDrop.DropSource.MATCH_REWARD,
                    match=match_obj,
                    instance=instance,
                )

                try:
                    from apps.game.metrics import item_drops_total
                    item_drops_total.labels(rarity=drop_item.rarity).inc()
                except Exception:
                    pass

    # Prometheus metrics
    try:
        from apps.game.metrics import gold_awarded_total, item_drops_total
        for pr in player_results:
            if pr.user.is_bot:
                continue
            source = "match_win" if pr.placement == 1 else "match_loss"
            gold = WINNER_GOLD if pr.placement == 1 else LOSER_GOLD
            gold_awarded_total.labels(source=source).inc(gold)
        # Item drop rarity counts are recorded per drop inside the loop above
        # but we can aggregate from DB if needed; for now just track gold flow
    except Exception:
        pass

    logger.info(
        "Generated drops for %d human players in match %s",
        sum(1 for pr in player_results if not pr.user.is_bot),
        match_id,
    )


def _roll_rarity(weights: dict[str, int], available_rarities: list[str]) -> str:
    """Roll a rarity string from the given weight table, restricted to available rarities."""
    # Filter weights to only rarities that have items in the pool
    filtered = {r: w for r, w in weights.items() if r in available_rarities}
    if not filtered:
        # Last resort: pick any available rarity uniformly
        return random.choice(available_rarities)
    rarities = list(filtered.keys())
    rarity_weights = list(filtered.values())
    return random.choices(rarities, weights=rarity_weights, k=1)[0]


@shared_task
def generate_match_drops_task(match_id: str):
    """Celery wrapper for post-match drop generation."""
    generate_match_drops(match_id)
