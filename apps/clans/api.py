import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from ninja.errors import HttpError
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated

from apps.accounts.auth import ActiveUserJWTAuth
from apps.clans.models import (
    Clan,
    ClanActivityLog,
    ClanChatMessage,
    ClanInvitation,
    ClanJoinRequest,
    ClanMembership,
    ClanWar,
    ClanWarParticipant,
)
from apps.clans.permissions import (
    get_membership,
    require_leader,
    require_membership,
    require_officer,
)
from apps.clans.schemas import (
    ClanActivityLogOutSchema,
    ClanChatCreateSchema,
    ClanChatMessageOutSchema,
    ClanCreateSchema,
    ClanDetailSchema,
    ClanInvitationOutSchema,
    ClanJoinRequestOutSchema,
    JoinRequestSchema,
    ClanLeaderboardEntrySchema,
    ClanMembershipOutSchema,
    ClanOutSchema,
    ClanUpdateSchema,
    ClanWarOutSchema,
    ClanWarParticipantOutSchema,
    DeclareWarSchema,
    DonateSchema,
    WithdrawSchema,
)
from apps.pagination import paginate_qs

User = get_user_model()

INVITATION_EXPIRY_HOURS = 72
CLAN_CREATION_COST = 2000


@api_controller('/clans', tags=['Clans'], auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
class ClanGlobalController:
    """Routes without {clan_id} — registered first to avoid UUID path collision."""

    @route.get('/my/', )
    def my_clan(self, request):
        m = get_membership(request.auth)
        if not m:
            return {'clan': None, 'membership': None}
        clan = Clan.objects.select_related('leader').get(pk=m.clan_id)
        return {
            'clan': ClanOutSchema.from_orm(clan).dict(),
            'membership': ClanMembershipOutSchema.from_orm(m).dict(),
        }

    @route.get('/my-invitations/', )
    def my_invitations(self, request, limit: int = 50, offset: int = 0):
        qs = ClanInvitation.objects.select_related(
            'clan', 'clan__leader', 'invited_user', 'invited_by',
        ).filter(
            invited_user=request.auth,
            status=ClanInvitation.Status.PENDING,
            expires_at__gt=timezone.now(),
        )
        return paginate_qs(qs, limit, offset, schema=ClanInvitationOutSchema)

    @route.get('/leaderboard/', )
    def leaderboard(self, request, sort: str = 'elo', limit: int = 50, offset: int = 0):
        qs = Clan.objects.filter(dissolved_at__isnull=True)
        sort_map = {
            'elo': '-elo_rating',
            'level': '-level',
            'members': None,
        }
        order = sort_map.get(sort, '-elo_rating')
        if order:
            qs = qs.order_by(order, '-created_at')
        else:
            qs = qs.order_by('-created_at')
        return paginate_qs(qs, limit, offset, schema=ClanLeaderboardEntrySchema)

    @route.post('/invitations/{invitation_id}/accept/')
    def accept_invitation(self, request, invitation_id: uuid.UUID):
        inv = ClanInvitation.objects.select_related('clan').filter(
            pk=invitation_id, invited_user=request.auth, status=ClanInvitation.Status.PENDING,
        ).first()
        if not inv:
            raise HttpError(404, 'Zaproszenie nie znalezione.')
        if inv.expires_at < timezone.now():
            inv.status = ClanInvitation.Status.EXPIRED
            inv.save(update_fields=['status'])
            raise HttpError(400, 'Zaproszenie wygasło.')

        if get_membership(request.auth):
            raise HttpError(400, 'Musisz opuścić obecny klan przed dołączeniem do innego.')

        clan = inv.clan
        if clan.member_count >= clan.max_members:
            raise HttpError(400, 'Klan jest pełny.')

        with transaction.atomic():
            inv.status = ClanInvitation.Status.ACCEPTED
            inv.save(update_fields=['status'])
            ClanMembership.objects.create(
                clan=clan, user=request.auth, role=ClanMembership.Role.RECRUIT,
            )
            ClanActivityLog.objects.create(
                clan=clan, actor=request.auth,
                action=ClanActivityLog.Action.MEMBER_JOINED,
                detail={'username': request.auth.username, 'via': 'invitation'},
            )

        return {'ok': True, 'clan_id': str(clan.pk)}

    @route.post('/invitations/{invitation_id}/decline/')
    def decline_invitation(self, request, invitation_id: uuid.UUID):
        inv = ClanInvitation.objects.filter(
            pk=invitation_id, invited_user=request.auth, status=ClanInvitation.Status.PENDING,
        ).first()
        if not inv:
            raise HttpError(404, 'Zaproszenie nie znalezione.')
        inv.status = ClanInvitation.Status.DECLINED
        inv.save(update_fields=['status'])
        return {'ok': True}

    @route.post('/join-requests/{request_id}/accept/')
    def accept_join_request(self, request, request_id: uuid.UUID):
        jr = ClanJoinRequest.objects.select_related('clan', 'user').filter(
            pk=request_id, status=ClanJoinRequest.Status.PENDING,
        ).first()
        if not jr:
            raise HttpError(404, 'Prośba nie znaleziona.')

        require_officer(request.auth, jr.clan_id)
        clan = jr.clan

        if clan.member_count >= clan.max_members:
            raise HttpError(400, 'Klan jest pełny.')

        if get_membership(jr.user):
            jr.status = ClanJoinRequest.Status.DECLINED
            jr.save(update_fields=['status'])
            raise HttpError(400, 'Gracz jest już w innym klanie.')

        with transaction.atomic():
            jr.status = ClanJoinRequest.Status.ACCEPTED
            jr.reviewed_by = request.auth
            jr.save(update_fields=['status', 'reviewed_by'])
            ClanMembership.objects.create(
                clan=clan, user=jr.user, role=ClanMembership.Role.RECRUIT,
            )
            ClanActivityLog.objects.create(
                clan=clan, actor=request.auth,
                action=ClanActivityLog.Action.MEMBER_JOINED,
                detail={'username': jr.user.username, 'via': 'join_request', 'accepted_by': request.auth.username},
            )

        from apps.notifications.services import create_notification
        from apps.notifications.models import Notification
        create_notification(
            user=jr.user,
            type=Notification.Type.CLAN_JOIN_REQUEST_ACCEPTED,
            title=f'Przyjęto Cię do klanu [{clan.tag}]',
            data={'clan_id': str(clan.pk), 'clan_tag': clan.tag},
        )

        return {'ok': True}

    @route.post('/join-requests/{request_id}/decline/')
    def decline_join_request(self, request, request_id: uuid.UUID):
        jr = ClanJoinRequest.objects.select_related('clan').filter(
            pk=request_id, status=ClanJoinRequest.Status.PENDING,
        ).first()
        if not jr:
            raise HttpError(404, 'Prośba nie znaleziona.')
        require_officer(request.auth, jr.clan_id)

        jr.status = ClanJoinRequest.Status.DECLINED
        jr.reviewed_by = request.auth
        jr.save(update_fields=['status', 'reviewed_by'])
        return {'ok': True}

    @route.post('/wars/{war_id}/accept/')
    def accept_war(self, request, war_id: uuid.UUID):
        war = ClanWar.objects.select_related('challenger', 'defender').filter(
            pk=war_id, status=ClanWar.Status.PENDING,
        ).first()
        if not war:
            raise HttpError(404, 'Wojna nie znaleziona.')

        require_officer(request.auth, war.defender_id)

        if war.wager_gold > 0 and war.defender.treasury_gold < war.wager_gold:
            raise HttpError(
                400,
                f'Skarbiec Twojego klanu nie ma wystarczających środków na zakład (potrzebujesz {war.wager_gold} złota, masz {war.defender.treasury_gold}).',
            )

        with transaction.atomic():
            if war.wager_gold > 0:
                locked_defender = Clan.objects.select_for_update().get(pk=war.defender_id)
                if locked_defender.treasury_gold < war.wager_gold:
                    raise HttpError(
                        400,
                        f'Skarbiec Twojego klanu nie ma wystarczających środków na zakład (potrzebujesz {war.wager_gold} złota, masz {locked_defender.treasury_gold}).',
                    )
                locked_defender.treasury_gold -= war.wager_gold
                locked_defender.save(update_fields=['treasury_gold'])

            war.status = ClanWar.Status.ACCEPTED
            war.save(update_fields=['status'])

        # Decide whether to start now or wait for scheduled time
        from apps.clans.tasks import start_clan_war
        if war.scheduled_at is None or war.scheduled_at <= timezone.now():
            start_clan_war.delay(str(war.pk))
        else:
            start_clan_war.apply_async(args=[str(war.pk)], eta=war.scheduled_at)

        return {'ok': True, 'status': 'accepted'}

    @route.post('/wars/{war_id}/decline/')
    def decline_war(self, request, war_id: uuid.UUID):
        war = ClanWar.objects.filter(pk=war_id, status=ClanWar.Status.PENDING).first()
        if not war:
            raise HttpError(404, 'Wojna nie znaleziona.')
        require_officer(request.auth, war.defender_id)

        with transaction.atomic():
            war.status = ClanWar.Status.DECLINED
            war.save(update_fields=['status'])

            # Refund wager to challenger — it was deducted at declaration time
            if war.wager_gold > 0:
                challenger = Clan.objects.select_for_update().get(pk=war.challenger_id)
                challenger.treasury_gold += war.wager_gold
                challenger.save(update_fields=['treasury_gold'])

        return {'ok': True}

    @route.post('/wars/{war_id}/join/', response=ClanWarParticipantOutSchema)
    def join_war(self, request, war_id: uuid.UUID):
        war = ClanWar.objects.filter(
            pk=war_id, status=ClanWar.Status.ACCEPTED,
        ).first()
        if not war:
            raise HttpError(404, 'Wojna nie znaleziona lub nie zaakceptowana.')

        m = get_membership(request.auth)
        if not m or m.clan_id not in (war.challenger_id, war.defender_id):
            raise HttpError(403, 'Nie jesteś członkiem żadnego z walczących klanów.')

        existing = ClanWarParticipant.objects.filter(war=war, user=request.auth).first()
        if existing:
            raise HttpError(400, 'Już dołączyłeś do tej wojny.')

        side_count = ClanWarParticipant.objects.filter(war=war, clan=m.clan).count()
        if side_count >= war.players_per_side:
            raise HttpError(400, 'Twoja strona jest już pełna.')

        p = ClanWarParticipant.objects.create(war=war, clan=m.clan, user=request.auth)
        return ClanWarParticipant.objects.select_related('user').get(pk=p.pk)

    @route.get('/wars/{war_id}/', response=ClanWarOutSchema)
    def get_war(self, request, war_id: uuid.UUID):
        """Get a single clan war by ID."""
        war = ClanWar.objects.select_related(
            'challenger', 'defender', 'winner',
        ).filter(pk=war_id).first()
        if not war:
            raise HttpError(404, 'Nie znaleziono wojny.')
        return war

    @route.get('/wars/{war_id}/participants/', )
    def list_war_participants(self, request, war_id: uuid.UUID):
        participants = ClanWarParticipant.objects.select_related('user').filter(war_id=war_id)
        return [ClanWarParticipantOutSchema.from_orm(p).dict() for p in participants]

    @route.post('/wars/{war_id}/leave/')
    def leave_war(self, request, war_id: uuid.UUID):
        """Leave a war before it starts (only when status is accepted)."""
        war = ClanWar.objects.filter(pk=war_id).first()
        if not war:
            raise HttpError(404, 'Nie znaleziono wojny.')

        if war.status != ClanWar.Status.ACCEPTED:
            raise HttpError(
                400,
                'Można opuścić wojnę tylko gdy jest zaakceptowana i jeszcze się nie rozpoczęła.',
            )

        participant = ClanWarParticipant.objects.filter(war=war, user=request.auth).first()
        if not participant:
            raise HttpError(404, 'Nie jesteś uczestnikiem tej wojny.')

        participant.delete()
        return {'ok': True, 'message': 'Opuszczono wojnę.'}

    @route.post('/wars/{war_id}/cancel/')
    def cancel_war(self, request, war_id: uuid.UUID):
        """Cancel a war (pending or accepted, officer/leader of either clan)."""
        war = ClanWar.objects.select_related('challenger', 'defender').filter(pk=war_id).first()
        if not war:
            raise HttpError(404, 'Nie znaleziono wojny.')

        if war.status not in (ClanWar.Status.PENDING, ClanWar.Status.ACCEPTED):
            raise HttpError(
                400,
                'Można anulować wojnę tylko gdy jest oczekująca lub zaakceptowana (nie w trakcie ani zakończona).',
            )

        # Either side's officer/leader can cancel
        user_membership = get_membership(request.auth)
        if not user_membership or user_membership.clan_id not in (war.challenger_id, war.defender_id):
            raise HttpError(403, 'Nie jesteś oficerem żadnego z klanów w tej wojnie.')
        if user_membership.role not in ('officer', 'leader'):
            raise HttpError(403, 'Tylko oficer lub lider może anulować wojnę.')

        with transaction.atomic():
            refunded = 0
            # Refund challenger wager (always deducted at declaration)
            if war.wager_gold > 0:
                challenger = Clan.objects.select_for_update().get(pk=war.challenger_id)
                challenger.treasury_gold += war.wager_gold
                challenger.save(update_fields=['treasury_gold'])
                refunded += war.wager_gold

            # Refund defender wager (only if war was accepted — defender paid at acceptance)
            if war.status == ClanWar.Status.ACCEPTED and war.wager_gold > 0:
                defender = Clan.objects.select_for_update().get(pk=war.defender_id)
                defender.treasury_gold += war.wager_gold
                defender.save(update_fields=['treasury_gold'])
                refunded += war.wager_gold

            war.status = ClanWar.Status.CANCELLED
            war.save(update_fields=['status'])

            ClanActivityLog.objects.create(
                clan=user_membership.clan, actor=request.auth,
                action=ClanActivityLog.Action.WAR_DECLARED,
                detail={'cancelled': True, 'refunded_gold': refunded, 'cancelled_by': request.auth.username},
            )

        return {'ok': True, 'message': 'Wojna została anulowana. Złoto zwrócone obu klanom.', 'refunded_gold': refunded}


@api_controller('/clans', tags=['Clans'], auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
class ClanController:
    """Routes with {clan_id} parameter."""

    # ── Clan CRUD ──

    @route.post('/', response=ClanOutSchema)
    def create_clan(self, request, payload: ClanCreateSchema):
        user = request.auth

        if get_membership(user):
            raise HttpError(400, 'Musisz opuścić obecny klan przed utworzeniem nowego.')

        tag = payload.tag.upper()
        if Clan.objects.filter(Q(name=payload.name) | Q(tag=tag)).exists():
            raise HttpError(400, 'Nazwa lub tag klanu jest już zajęty.')

        from apps.inventory.models import Wallet
        wallet = Wallet.objects.filter(user=user).first()
        if not wallet or wallet.gold < CLAN_CREATION_COST:
            raise HttpError(400, f'Niewystarczająca ilość złota. Utworzenie klanu kosztuje {CLAN_CREATION_COST} złota.')

        with transaction.atomic():
            wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
            if wallet.gold < CLAN_CREATION_COST:
                raise HttpError(400, f'Niewystarczająca ilość złota. Utworzenie klanu kosztuje {CLAN_CREATION_COST} złota.')
            wallet.gold -= CLAN_CREATION_COST
            wallet.total_spent += CLAN_CREATION_COST
            wallet.save(update_fields=['gold', 'total_spent', 'updated_at'])

            clan = Clan.objects.create(
                name=payload.name,
                tag=tag,
                description=payload.description,
                color=payload.color,
                is_public=payload.is_public,
                leader=user,
            )
            ClanMembership.objects.create(
                clan=clan,
                user=user,
                role=ClanMembership.Role.LEADER,
            )
            ClanActivityLog.objects.create(
                clan=clan, actor=user, action=ClanActivityLog.Action.MEMBER_JOINED,
                detail={'username': user.username, 'role': 'leader'},
            )

        return Clan.objects.select_related('leader').get(pk=clan.pk)

    @route.get('/', )
    def list_clans(self, request, search: str = '', limit: int = 50, offset: int = 0):
        qs = Clan.objects.select_related('leader').filter(dissolved_at__isnull=True)
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(tag__icontains=search))
        return paginate_qs(qs, limit, offset, schema=ClanOutSchema)

    @route.get('/{clan_id}/', )
    def get_clan(self, request, clan_id: uuid.UUID):
        clan = Clan.objects.select_related('leader').filter(pk=clan_id, dissolved_at__isnull=True).first()
        if not clan:
            raise HttpError(404, 'Klan nie znaleziony.')

        data = ClanDetailSchema.from_orm(clan).dict()

        # Hide treasury from non-members
        m = get_membership(request.auth, clan_id=clan_id)
        if m:
            data['my_membership'] = ClanMembershipOutSchema.from_orm(m).dict()
        else:
            data['treasury_gold'] = 0
            data['tax_percent'] = 0
            data['my_membership'] = None

        return data

    @route.patch('/{clan_id}/', response=ClanOutSchema)
    def update_clan(self, request, clan_id: uuid.UUID, payload: ClanUpdateSchema):
        require_officer(request.auth, clan_id)
        clan = Clan.objects.select_related('leader').filter(pk=clan_id, dissolved_at__isnull=True).first()
        if not clan:
            raise HttpError(404, 'Klan nie znaleziony.')

        update_fields = []
        changed = {}
        for field, value in payload.dict(exclude_unset=True).items():
            if value is not None:
                if field == 'name' and Clan.objects.filter(name=value).exclude(pk=clan_id).exists():
                    raise HttpError(400, 'Ta nazwa jest już zajęta.')
                setattr(clan, field, value)
                update_fields.append(field)
                changed[field] = str(value)

        if update_fields:
            clan.save(update_fields=update_fields)
            ClanActivityLog.objects.create(
                clan=clan, actor=request.auth,
                action=ClanActivityLog.Action.SETTINGS_CHANGED,
                detail=changed,
            )

        return clan

    @route.delete('/{clan_id}/')
    def dissolve_clan(self, request, clan_id: uuid.UUID):
        require_leader(request.auth, clan_id)
        clan = Clan.objects.filter(pk=clan_id, dissolved_at__isnull=True).first()
        if not clan:
            raise HttpError(404, 'Klan nie znaleziony.')

        with transaction.atomic():
            clan.dissolved_at = timezone.now()
            clan.is_recruiting = False
            clan.save(update_fields=['dissolved_at', 'is_recruiting'])
            clan.memberships.all().delete()

        return {'ok': True}

    # ── Members ──

    @route.get('/{clan_id}/members/', )
    def list_members(self, request, clan_id: uuid.UUID, limit: int = 50, offset: int = 0):
        clan = Clan.objects.filter(pk=clan_id, dissolved_at__isnull=True).first()
        if not clan:
            raise HttpError(404, 'Klan nie znaleziony.')
        qs = ClanMembership.objects.select_related('user').filter(clan=clan).order_by('-role', 'joined_at')
        return paginate_qs(qs, limit, offset, schema=ClanMembershipOutSchema)

    @route.post('/{clan_id}/leave/')
    def leave_clan(self, request, clan_id: uuid.UUID):
        m = require_membership(request.auth, clan_id)
        if m.role == ClanMembership.Role.LEADER:
            raise HttpError(400, 'Lider nie może opuścić klanu. Przekaż lidera lub rozwiąż klan.')

        clan = m.clan
        m.delete()
        ClanActivityLog.objects.create(
            clan=clan, actor=request.auth,
            action=ClanActivityLog.Action.MEMBER_LEFT,
            detail={'username': request.auth.username},
        )
        return {'ok': True}

    @route.post('/{clan_id}/kick/{user_id}/')
    def kick_member(self, request, clan_id: uuid.UUID, user_id: uuid.UUID):
        actor_m = require_officer(request.auth, clan_id)
        target_m = ClanMembership.objects.select_related('user').filter(clan_id=clan_id, user_id=user_id).first()
        if not target_m:
            raise HttpError(404, 'Gracz nie jest w tym klanie.')

        if target_m.rank >= actor_m.rank:
            raise HttpError(403, 'Nie możesz wyrzucić gracza o równej lub wyższej randze.')

        clan = actor_m.clan
        username = target_m.user.username
        target_m.delete()

        ClanActivityLog.objects.create(
            clan=clan, actor=request.auth,
            action=ClanActivityLog.Action.MEMBER_KICKED,
            detail={'username': username, 'kicked_by': request.auth.username},
        )

        from apps.notifications.services import create_notification
        from apps.notifications.models import Notification
        create_notification(
            user=target_m.user,
            type=Notification.Type.CLAN_KICKED,
            title=f'Zostałeś wyrzucony z klanu [{clan.tag}]',
            data={'clan_id': str(clan.pk), 'clan_tag': clan.tag},
        )

        return {'ok': True}

    @route.post('/{clan_id}/promote/{user_id}/')
    def promote_member(self, request, clan_id: uuid.UUID, user_id: uuid.UUID):
        actor_m = require_officer(request.auth, clan_id)
        target_m = ClanMembership.objects.select_related('user').filter(clan_id=clan_id, user_id=user_id).first()
        if not target_m:
            raise HttpError(404, 'Gracz nie jest w tym klanie.')

        promotion_map = {
            ClanMembership.Role.RECRUIT: ClanMembership.Role.MEMBER,
            ClanMembership.Role.MEMBER: ClanMembership.Role.OFFICER,
        }
        new_role = promotion_map.get(target_m.role)
        if not new_role:
            raise HttpError(400, 'Nie można awansować tego gracza wyżej.')
        if ClanMembership.ROLE_HIERARCHY[new_role] >= actor_m.rank:
            raise HttpError(403, 'Nie możesz awansować gracza do swojej rangi lub wyższej.')

        old_role = target_m.role
        target_m.role = new_role
        target_m.save(update_fields=['role'])

        ClanActivityLog.objects.create(
            clan=actor_m.clan, actor=request.auth,
            action=ClanActivityLog.Action.MEMBER_PROMOTED,
            detail={'username': target_m.user.username, 'from': old_role, 'to': new_role},
        )

        from apps.notifications.services import create_notification
        from apps.notifications.models import Notification
        create_notification(
            user=target_m.user,
            type=Notification.Type.CLAN_PROMOTED,
            title=f'Awansowano Cię na {new_role} w [{actor_m.clan.tag}]',
            data={'clan_id': str(clan_id), 'new_role': new_role},
        )

        return {'ok': True, 'new_role': new_role}

    @route.post('/{clan_id}/demote/{user_id}/')
    def demote_member(self, request, clan_id: uuid.UUID, user_id: uuid.UUID):
        actor_m = require_officer(request.auth, clan_id)
        target_m = ClanMembership.objects.select_related('user').filter(clan_id=clan_id, user_id=user_id).first()
        if not target_m:
            raise HttpError(404, 'Gracz nie jest w tym klanie.')

        demotion_map = {
            ClanMembership.Role.OFFICER: ClanMembership.Role.MEMBER,
            ClanMembership.Role.MEMBER: ClanMembership.Role.RECRUIT,
        }
        new_role = demotion_map.get(target_m.role)
        if not new_role:
            raise HttpError(400, 'Nie można zdegradować tego gracza niżej.')
        if target_m.rank >= actor_m.rank:
            raise HttpError(403, 'Nie możesz zdegradować gracza o równej lub wyższej randze.')

        old_role = target_m.role
        target_m.role = new_role
        target_m.save(update_fields=['role'])

        ClanActivityLog.objects.create(
            clan=actor_m.clan, actor=request.auth,
            action=ClanActivityLog.Action.MEMBER_DEMOTED,
            detail={'username': target_m.user.username, 'from': old_role, 'to': new_role},
        )

        from apps.notifications.services import create_notification
        from apps.notifications.models import Notification
        create_notification(
            user=target_m.user,
            type=Notification.Type.CLAN_DEMOTED,
            title=f'Zdegradowano Cię do {new_role} w [{actor_m.clan.tag}]',
            data={'clan_id': str(clan_id), 'new_role': new_role},
        )

        return {'ok': True, 'new_role': new_role}

    @route.post('/{clan_id}/transfer-leadership/{user_id}/')
    def transfer_leadership(self, request, clan_id: uuid.UUID, user_id: uuid.UUID):
        actor_m = require_leader(request.auth, clan_id)
        target_m = ClanMembership.objects.select_related('user').filter(clan_id=clan_id, user_id=user_id).first()
        if not target_m:
            raise HttpError(404, 'Gracz nie jest w tym klanie.')
        if target_m.user_id == request.auth.pk:
            raise HttpError(400, 'Jesteś już liderem.')

        with transaction.atomic():
            actor_m.role = ClanMembership.Role.OFFICER
            actor_m.save(update_fields=['role'])
            target_m.role = ClanMembership.Role.LEADER
            target_m.save(update_fields=['role'])
            clan = actor_m.clan
            clan.leader = target_m.user
            clan.save(update_fields=['leader'])

        ClanActivityLog.objects.create(
            clan=clan, actor=request.auth,
            action=ClanActivityLog.Action.LEADER_TRANSFERRED,
            detail={'from': request.auth.username, 'to': target_m.user.username},
        )

        return {'ok': True}

    # ── Invitations ──

    @route.post('/{clan_id}/invite/{user_id}/', response=ClanInvitationOutSchema)
    def invite_player(self, request, clan_id: uuid.UUID, user_id: uuid.UUID):
        require_officer(request.auth, clan_id)
        clan = Clan.objects.select_related('leader').filter(pk=clan_id, dissolved_at__isnull=True).first()
        if not clan:
            raise HttpError(404, 'Klan nie znaleziony.')

        if clan.member_count >= clan.max_members:
            raise HttpError(400, 'Klan jest pełny.')

        target = User.objects.filter(pk=user_id).first()
        if not target:
            raise HttpError(404, 'Gracz nie znaleziony.')

        if get_membership(target):
            raise HttpError(400, 'Gracz jest już w klanie.')

        existing = ClanInvitation.objects.filter(
            clan=clan, invited_user=target, status=ClanInvitation.Status.PENDING,
        ).first()
        if existing:
            raise HttpError(400, 'Zaproszenie już zostało wysłane.')

        inv = ClanInvitation.objects.create(
            clan=clan,
            invited_user=target,
            invited_by=request.auth,
            expires_at=timezone.now() + timedelta(hours=INVITATION_EXPIRY_HOURS),
        )

        from apps.notifications.services import create_notification
        from apps.notifications.models import Notification
        create_notification(
            user=target,
            type=Notification.Type.CLAN_INVITATION_RECEIVED,
            title=f'Zaproszenie do klanu [{clan.tag}] {clan.name}',
            data={'clan_id': str(clan.pk), 'clan_tag': clan.tag, 'invitation_id': str(inv.pk)},
        )

        return ClanInvitation.objects.select_related(
            'clan', 'clan__leader', 'invited_user', 'invited_by',
        ).get(pk=inv.pk)

    # ── Join Requests ──

    @route.post('/{clan_id}/join/', )
    def join_or_request(self, request, clan_id: uuid.UUID, payload: JoinRequestSchema = None):
        if get_membership(request.auth):
            raise HttpError(400, 'Musisz opuścić obecny klan przed dołączeniem do innego.')

        clan = Clan.objects.filter(pk=clan_id, dissolved_at__isnull=True).first()
        if not clan:
            raise HttpError(404, 'Klan nie znaleziony.')
        if not clan.is_recruiting:
            raise HttpError(400, 'Klan nie rekrutuje.')
        if clan.member_count >= clan.max_members:
            raise HttpError(400, 'Klan jest pełny.')

        if clan.is_public:
            # Direct join
            with transaction.atomic():
                ClanMembership.objects.create(
                    clan=clan, user=request.auth, role=ClanMembership.Role.RECRUIT,
                )
                ClanActivityLog.objects.create(
                    clan=clan, actor=request.auth,
                    action=ClanActivityLog.Action.MEMBER_JOINED,
                    detail={'username': request.auth.username, 'via': 'public_join'},
                )
            return {'ok': True, 'joined': True, 'clan_id': str(clan.pk)}
        else:
            # Send join request
            existing = ClanJoinRequest.objects.filter(
                clan=clan, user=request.auth, status=ClanJoinRequest.Status.PENDING,
            ).first()
            if existing:
                raise HttpError(400, 'Prośba o dołączenie już istnieje.')

            message = payload.message if payload else ''
            ClanJoinRequest.objects.create(
                clan=clan, user=request.auth, message=message,
            )

            from apps.notifications.services import create_notification
            from apps.notifications.models import Notification
            # Notify clan leader
            create_notification(
                user=clan.leader,
                type=Notification.Type.CLAN_JOIN_REQUEST,
                title=f'{request.auth.username} chce dołączyć do [{clan.tag}]',
                data={'clan_id': str(clan.pk), 'username': request.auth.username},
            )

            return {'ok': True, 'joined': False, 'message': 'Prośba o dołączenie wysłana.'}

    @route.get('/{clan_id}/join-requests/', )
    def list_join_requests(self, request, clan_id: uuid.UUID, limit: int = 50, offset: int = 0):
        require_officer(request.auth, clan_id)
        qs = ClanJoinRequest.objects.select_related('clan', 'clan__leader', 'user').filter(
            clan_id=clan_id, status=ClanJoinRequest.Status.PENDING,
        )
        return paginate_qs(qs, limit, offset, schema=ClanJoinRequestOutSchema)

    # ── Treasury ──

    @route.get('/{clan_id}/treasury/')
    def get_treasury(self, request, clan_id: uuid.UUID):
        require_membership(request.auth, clan_id)
        clan = Clan.objects.filter(pk=clan_id).first()
        if not clan:
            raise HttpError(404, 'Klan nie znaleziony.')
        return {'treasury_gold': clan.treasury_gold, 'tax_percent': float(clan.tax_percent)}

    @route.post('/{clan_id}/treasury/donate/')
    def donate_gold(self, request, clan_id: uuid.UUID, payload: DonateSchema):
        m = require_membership(request.auth, clan_id)

        from apps.inventory.models import Wallet
        wallet = Wallet.objects.filter(user=request.auth).first()
        if not wallet:
            raise HttpError(400, 'Nie masz portfela złota.')
        if wallet.gold < payload.amount:
            raise HttpError(
                400,
                f'Nie masz wystarczająco złota (potrzebujesz {payload.amount}, masz {wallet.gold}).',
            )

        with transaction.atomic():
            wallet.gold -= payload.amount
            wallet.total_spent += payload.amount
            wallet.save(update_fields=['gold', 'total_spent', 'updated_at'])

            clan = Clan.objects.select_for_update().get(pk=clan_id)
            clan.treasury_gold += payload.amount
            clan.save(update_fields=['treasury_gold'])

            m.contributions_gold += payload.amount
            m.save(update_fields=['contributions_gold'])

            ClanActivityLog.objects.create(
                clan=clan, actor=request.auth,
                action=ClanActivityLog.Action.GOLD_DONATED,
                detail={'amount': payload.amount, 'username': request.auth.username},
            )

        return {'ok': True, 'treasury_gold': clan.treasury_gold}

    # Withdraw disabled — treasury gold is spent only on clan wars and upgrades

    # ── Clan Wars ──

    @route.post('/{clan_id}/wars/declare/{target_id}/', response=ClanWarOutSchema)
    def declare_war(self, request, clan_id: uuid.UUID, target_id: uuid.UUID, payload: DeclareWarSchema):
        require_officer(request.auth, clan_id)

        if str(clan_id) == str(target_id):
            raise HttpError(400, 'Klan nie może wypowiedzieć wojny sam sobie.')

        challenger = Clan.objects.filter(pk=clan_id, dissolved_at__isnull=True).first()
        defender = Clan.objects.filter(pk=target_id, dissolved_at__isnull=True).first()
        if not challenger:
            raise HttpError(404, 'Twój klan nie istnieje lub został rozwiązany.')
        if not defender:
            raise HttpError(404, 'Klan docelowy nie istnieje lub został rozwiązany.')

        # Check no active war between these clans
        active_war = ClanWar.objects.filter(
            Q(challenger=challenger, defender=defender) | Q(challenger=defender, defender=challenger),
            status__in=[ClanWar.Status.PENDING, ClanWar.Status.ACCEPTED, ClanWar.Status.IN_PROGRESS],
        ).exists()
        if active_war:
            raise HttpError(400, 'Aktywna wojna między tymi klanami już istnieje.')

        MIN_WAGER = 100
        if payload.wager_gold > 0:
            if payload.wager_gold < MIN_WAGER:
                raise HttpError(400, f'Minimalny zakład to {MIN_WAGER} złota.')
            if challenger.treasury_gold < payload.wager_gold:
                raise HttpError(
                    400,
                    f'Skarbiec klanu nie ma wystarczających środków (potrzebujesz {payload.wager_gold} złota, masz {challenger.treasury_gold}).',
                )

        with transaction.atomic():
            if payload.wager_gold > 0:
                locked = Clan.objects.select_for_update().get(pk=challenger.pk)
                if locked.treasury_gold < payload.wager_gold:
                    raise HttpError(
                        400,
                        f'Skarbiec klanu nie ma wystarczających środków (potrzebujesz {payload.wager_gold} złota, masz {locked.treasury_gold}).',
                    )
                locked.treasury_gold -= payload.wager_gold
                locked.save(update_fields=['treasury_gold'])

            war = ClanWar.objects.create(
                challenger=challenger,
                defender=defender,
                players_per_side=payload.players_per_side,
                wager_gold=payload.wager_gold,
                scheduled_at=payload.scheduled_at,
            )

            ClanActivityLog.objects.create(
                clan=challenger, actor=request.auth,
                action=ClanActivityLog.Action.WAR_DECLARED,
                detail={
                    'against': defender.tag,
                    'players_per_side': payload.players_per_side,
                    'wager_gold': payload.wager_gold,
                },
            )

        from apps.notifications.services import create_notification
        from apps.notifications.models import Notification
        create_notification(
            user=defender.leader,
            type=Notification.Type.CLAN_WAR_DECLARED,
            title=f'[{challenger.tag}] wypowiedział wojnę!',
            data={
                'war_id': str(war.pk),
                'challenger_tag': challenger.tag,
                'wager_gold': payload.wager_gold,
            },
        )

        return ClanWar.objects.select_related(
            'challenger', 'challenger__leader', 'defender', 'defender__leader',
        ).get(pk=war.pk)

    @route.get('/{clan_id}/wars/', )
    def list_wars(self, request, clan_id: uuid.UUID, limit: int = 50, offset: int = 0):
        qs = ClanWar.objects.select_related(
            'challenger', 'challenger__leader', 'defender', 'defender__leader',
        ).filter(
            Q(challenger_id=clan_id) | Q(defender_id=clan_id),
        )
        return paginate_qs(qs, limit, offset, schema=ClanWarOutSchema)

    @route.get('/{clan_id}/stats/')
    def clan_stats(self, request, clan_id: uuid.UUID):
        clan = Clan.objects.filter(pk=clan_id, dissolved_at__isnull=True).first()
        if not clan:
            raise HttpError(404, 'Klan nie znaleziony.')

        wars_won = ClanWar.objects.filter(winner_id=clan_id, status=ClanWar.Status.FINISHED).count()
        wars_lost = ClanWar.objects.filter(
            Q(challenger_id=clan_id) | Q(defender_id=clan_id),
            status=ClanWar.Status.FINISHED,
        ).exclude(winner_id=clan_id).count()
        wars_total = wars_won + wars_lost

        return {
            'clan_id': str(clan_id),
            'level': clan.level,
            'experience': clan.experience,
            'elo_rating': clan.elo_rating,
            'member_count': clan.member_count,
            'wars_total': wars_total,
            'wars_won': wars_won,
            'wars_lost': wars_lost,
            'war_win_rate': wars_won / wars_total if wars_total > 0 else 0,
        }

    # ── Activity Log ──

    @route.get('/{clan_id}/activity-log/', )
    def activity_log(self, request, clan_id: uuid.UUID, limit: int = 50, offset: int = 0):
        require_membership(request.auth, clan_id)
        qs = ClanActivityLog.objects.select_related('actor').filter(clan_id=clan_id)
        return paginate_qs(qs, limit, offset, schema=ClanActivityLogOutSchema)

    # ── Chat ──

    @route.get('/{clan_id}/chat/', )
    def list_chat(self, request, clan_id: uuid.UUID, limit: int = 50, offset: int = 0):
        require_membership(request.auth, clan_id)
        qs = ClanChatMessage.objects.select_related('user').filter(clan_id=clan_id)
        return paginate_qs(qs, limit, offset, schema=ClanChatMessageOutSchema)

    @route.post('/{clan_id}/chat/', response=ClanChatMessageOutSchema)
    def send_chat_message(self, request, clan_id: uuid.UUID, payload: ClanChatCreateSchema):
        require_membership(request.auth, clan_id)
        msg = ClanChatMessage.objects.create(
            clan_id=clan_id, user=request.auth, content=payload.content,
        )
        return ClanChatMessage.objects.select_related('user').get(pk=msg.pk)
