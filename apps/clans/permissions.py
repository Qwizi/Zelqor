from ninja.errors import HttpError

from apps.clans.models import ClanMembership


def get_membership(user, clan_id=None, clan=None):
    """Get user's clan membership or None."""
    try:
        m = ClanMembership.objects.select_related('clan').get(user=user)
        if clan_id and str(m.clan_id) != str(clan_id):
            return None
        if clan and m.clan_id != clan.pk:
            return None
        return m
    except ClanMembership.DoesNotExist:
        return None


def require_membership(user, clan_id):
    """Get membership or raise 403."""
    m = get_membership(user, clan_id=clan_id)
    if not m:
        raise HttpError(403, 'Nie jesteś członkiem tego klanu.')
    return m


def require_role(user, clan_id, min_role):
    """Require at least min_role rank. Returns membership."""
    m = require_membership(user, clan_id)
    min_rank = ClanMembership.ROLE_HIERARCHY.get(min_role, 0)
    if m.rank < min_rank:
        raise HttpError(403, 'Nie masz wystarczających uprawnień.')
    return m


def require_leader(user, clan_id):
    """Require leader role."""
    return require_role(user, clan_id, ClanMembership.Role.LEADER)


def require_officer(user, clan_id):
    """Require officer or higher role."""
    return require_role(user, clan_id, ClanMembership.Role.OFFICER)
