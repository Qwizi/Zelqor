import contextlib

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.shortcuts import redirect
from unfold.admin import ModelAdmin, TabularInline
from unfold.contrib.filters.admin import RangeNumericFilter
from unfold.decorators import action, display
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from apps.accounts.models import DirectMessage, Friendship, SocialAccount, User
from apps.inventory.admin import DeckInline, EquippedCosmeticInline


class SocialAccountInline(TabularInline):
    model = SocialAccount
    extra = 0
    fields = ("provider", "provider_user_id", "email", "display_name", "created_at")
    readonly_fields = ("created_at",)


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm
    list_display = (
        "email",
        "username",
        "display_role",
        "display_elo",
        "display_social",
        "is_staff",
        "is_active",
        "is_banned",
    )
    list_filter = (
        "role",
        "is_staff",
        "is_active",
        "is_banned",
        "banned_reason",
        ("elo_rating", RangeNumericFilter),
    )
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("email", "username")
    ordering = ("email",)
    warn_unsaved_form = True
    actions = ["merge_selected_users"]
    actions_detail = ["merge_into_user", "set_admin_password"]
    inlines = [SocialAccountInline, EquippedCosmeticInline, DeckInline]
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Game", {"fields": ("role", "elo_rating", "avatar", "tutorial_completed", "is_banned", "banned_reason")}),
    )

    @display(description="Role", label={"USER": "info", "ADMIN": "danger"})
    def display_role(self, obj):
        return obj.role

    @display(description="ELO", ordering="elo_rating")
    def display_elo(self, obj):
        return obj.elo_rating

    @display(description="Social")
    def display_social(self, obj):
        providers = list(obj.social_accounts.values_list("provider", flat=True))
        if not providers:
            return "-"
        return ", ".join(p.capitalize() for p in providers)

    @action(description="Scal konto do innego użytkownika", url_path="merge-into-user")
    def merge_into_user(self, request, object_id):
        """Admin detail action: merge this user's data into another user.

        Shows a form to enter target username/email, then merges all data.
        """
        from django.contrib import messages

        source = User.objects.get(pk=object_id)

        if request.method == "POST":
            target_identifier = request.POST.get("target_identifier", "").strip()
            if not target_identifier:
                messages.error(request, "Podaj nazwę użytkownika lub email docelowego konta.")
                return redirect(request.get_full_path())

            target = (
                User.objects.filter(username__iexact=target_identifier).first()
                or User.objects.filter(email__iexact=target_identifier).first()
            )
            if not target:
                messages.error(request, f"Nie znaleziono użytkownika: {target_identifier}")
                return redirect(request.get_full_path())

            if str(source.pk) == str(target.pk):
                messages.error(request, "Nie można scalić użytkownika z samym sobą.")
                return redirect(request.get_full_path())

            # Move social accounts
            source.social_accounts.update(user=target)

            # Move all FK-related objects: iterate over reverse relations
            for rel in User._meta.get_fields():
                if not rel.one_to_many and not rel.one_to_one:
                    continue
                if rel.related_model is SocialAccount:
                    continue  # already handled
                accessor = rel.get_accessor_name()
                try:
                    related_qs = getattr(source, accessor)
                except Exception:
                    continue  # OneToOneField may raise RelatedObjectDoesNotExist
                if hasattr(related_qs, "all"):
                    try:
                        related_qs.all().update(**{rel.field.name: target})
                    except Exception:
                        pass  # skip relations with unique constraints
                elif rel.one_to_one:
                    try:
                        setattr(related_qs, rel.field.name, target)
                        related_qs.save(update_fields=[rel.field.name])
                    except Exception:
                        pass

            # Merge ELO: keep the higher rating
            if source.elo_rating > target.elo_rating:
                target.elo_rating = source.elo_rating
                target.save(update_fields=["elo_rating"])

            # Deactivate source
            source.is_active = False
            source.save(update_fields=["is_active"])

            messages.success(request, f"Scalono {source.username} → {target.username}. Konto źródłowe dezaktywowane.")
            return redirect(f"/admin/accounts/user/{target.pk}/change/")

        # GET: show inline form
        from django.http import HttpResponse
        from django.middleware.csrf import get_token

        csrf_token = get_token(request)
        html = f"""
        <!DOCTYPE html>
        <html><head><title>Scal konto: {source.username}</title>
        <style>
            body {{ font-family: sans-serif; max-width: 500px; margin: 60px auto; padding: 20px; background: #0f172a; color: #e2e8f0; }}
            input {{ padding: 10px; width: 100%; border: 1px solid #334155; border-radius: 8px; background: #1e293b; color: #f1f5f9; margin: 10px 0; font-size: 16px; }}
            button {{ padding: 10px 24px; background: #ef4444; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; }}
            button:hover {{ background: #dc2626; }}
            a {{ color: #22d3ee; }}
            .warn {{ background: #7f1d1d; border: 1px solid #991b1b; padding: 12px; border-radius: 8px; margin: 16px 0; font-size: 14px; }}
        </style></head><body>
        <h2>Scal konto</h2>
        <p>Źródło: <strong>{source.username}</strong> ({source.email})</p>
        <p>Wszystkie dane (mecze, social accounts, ELO) zostaną przeniesione do docelowego konta. Konto źródłowe zostanie dezaktywowane.</p>
        <div class="warn">⚠️ Ta operacja jest nieodwracalna!</div>
        <form method="post">
            <input type="hidden" name="csrfmiddlewaretoken" value="{csrf_token}">
            <label>Nazwa użytkownika lub email docelowego konta:</label>
            <input type="text" name="target_identifier" placeholder="username lub email" required autofocus>
            <br><br>
            <button type="submit">Scal konto</button>
            <a href="/admin/accounts/user/{object_id}/change/" style="margin-left: 16px;">Anuluj</a>
        </form>
        </body></html>
        """
        return HttpResponse(html)

    @action(description="Ustaw hasło (migracja z konta social)", url_path="set-admin-password")
    def set_admin_password(self, request, object_id):
        """Redirect to the built-in Django/Unfold per-user password change view.

        Unfold already hooks AdminPasswordChangeForm into that view via
        ``change_password_form``, so no custom template is needed.
        """
        return redirect(f"/admin/accounts/user/{object_id}/password/")

    @action(description="Scal zaznaczonych użytkowników (zaznacz 2)")
    def merge_selected_users(self, request, queryset):
        """List action: select exactly 2 users, then choose merge direction."""
        from django.contrib import messages as django_messages
        from django.http import HttpResponse
        from django.middleware.csrf import get_token

        users = list(queryset.order_by("date_joined"))
        if len(users) != 2:
            django_messages.error(request, "Zaznacz dokładnie 2 użytkowników do scalenia.")
            return

        # If POST with direction chosen — execute merge
        if request.method == "POST" and request.POST.get("target_id"):
            target_id = request.POST["target_id"]
            target = next((u for u in users if str(u.pk) == target_id), None)
            source = next((u for u in users if str(u.pk) != target_id), None)
            if not target or not source:
                django_messages.error(request, "Nieprawidłowy wybór.")
                return

            # Move social accounts
            source.social_accounts.update(user=target)

            # Move ALL FK-related objects
            for rel in User._meta.get_fields():
                if not rel.one_to_many and not rel.one_to_one:
                    continue
                if rel.related_model is SocialAccount:
                    continue
                accessor = rel.get_accessor_name()
                try:
                    related_qs = getattr(source, accessor)
                except Exception:
                    continue
                if hasattr(related_qs, "all"):
                    with contextlib.suppress(Exception):
                        related_qs.all().update(**{rel.field.name: target})
                elif rel.one_to_one:
                    try:
                        setattr(related_qs, rel.field.name, target)
                        related_qs.save(update_fields=[rel.field.name])
                    except Exception:
                        pass

            # Merge fields: keep best values
            if source.elo_rating > target.elo_rating:
                target.elo_rating = source.elo_rating
            if source.tutorial_completed and not target.tutorial_completed:
                target.tutorial_completed = True
            if source.avatar and not target.avatar:
                target.avatar = source.avatar
            target.save(update_fields=["elo_rating", "tutorial_completed", "avatar"])

            # Deactivate source
            source.is_active = False
            source.save(update_fields=["is_active"])

            django_messages.success(
                request,
                f"Scalono {source.username} → {target.username}. "
                f"Wszystkie dane przeniesione. Konto {source.username} dezaktywowane.",
            )
            return redirect(f"/admin/accounts/user/{target.pk}/change/")

        # GET — show direction picker
        u1, u2 = users[0], users[1]
        u1_social = ", ".join(s.provider for s in u1.social_accounts.all()) or "brak"
        u2_social = ", ".join(s.provider for s in u2.social_accounts.all()) or "brak"
        csrf_token = get_token(request)

        html = f"""<!DOCTYPE html>
<html><head><title>Scal użytkowników</title>
<style>
body {{ font-family: sans-serif; max-width: 700px; margin: 40px auto; padding: 20px; background: #0f172a; color: #e2e8f0; }}
h2 {{ color: #22d3ee; }}
.cards {{ display: flex; gap: 16px; margin: 24px 0; }}
.card {{ flex: 1; border: 2px solid #334155; border-radius: 12px; padding: 20px; background: #1e293b; text-align: center; }}
.card h3 {{ margin: 0 0 12px; font-size: 20px; }}
.card p {{ margin: 4px 0; font-size: 14px; color: #94a3b8; }}
.card .elo {{ font-size: 28px; color: #fbbf24; font-weight: bold; }}
.card .social {{ color: #22d3ee; font-size: 13px; }}
button {{ padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 15px; font-weight: bold; width: 100%; margin-top: 12px; }}
.btn-merge {{ background: #22d3ee; color: #0f172a; }}
.btn-merge:hover {{ background: #06b6d4; }}
.arrow {{ font-size: 32px; color: #22d3ee; display: flex; align-items: center; }}
.warn {{ background: #7f1d1d; border: 1px solid #991b1b; padding: 12px; border-radius: 8px; font-size: 13px; margin-bottom: 20px; }}
a {{ color: #22d3ee; }}
</style></head><body>
<h2>Scal użytkowników</h2>
<div class="warn">⚠️ Wszystkie dane (mecze, ELO, social accounts, ekwipunek, kosmetyki, talii) zostaną przeniesione do konta docelowego. Konto źródłowe zostanie dezaktywowane. Ta operacja jest nieodwracalna!</div>

<p style="margin-bottom: 8px; font-size: 14px; color: #94a3b8;">Wybierz kierunek scalenia — kliknij "Scal do tego konta" na koncie które ma ZOSTAĆ:</p>

<div class="cards">
  <div class="card">
    <h3>{u1.username}</h3>
    <p>{u1.email}</p>
    <p class="elo">ELO: {u1.elo_rating}</p>
    <p class="social">Social: {u1_social}</p>
    <p>Hasło: {"✅ tak" if u1.has_usable_password() else "❌ nie"}</p>
    <form method="post"><input type="hidden" name="csrfmiddlewaretoken" value="{csrf_token}">
    <input type="hidden" name="action" value="merge_selected_users">
    <input type="hidden" name="_selected_action" value="{u1.pk}">
    <input type="hidden" name="_selected_action" value="{u2.pk}">
    <input type="hidden" name="target_id" value="{u1.pk}">
    <button type="submit" class="btn-merge">← Scal do tego konta</button></form>
  </div>
  <div class="arrow">⇄</div>
  <div class="card">
    <h3>{u2.username}</h3>
    <p>{u2.email}</p>
    <p class="elo">ELO: {u2.elo_rating}</p>
    <p class="social">Social: {u2_social}</p>
    <p>Hasło: {"✅ tak" if u2.has_usable_password() else "❌ nie"}</p>
    <form method="post"><input type="hidden" name="csrfmiddlewaretoken" value="{csrf_token}">
    <input type="hidden" name="action" value="merge_selected_users">
    <input type="hidden" name="_selected_action" value="{u1.pk}">
    <input type="hidden" name="_selected_action" value="{u2.pk}">
    <input type="hidden" name="target_id" value="{u2.pk}">
    <button type="submit" class="btn-merge">Scal do tego konta →</button></form>
  </div>
</div>
<a href="/admin/accounts/user/">← Powrót do listy</a>
</body></html>"""
        return HttpResponse(html)


@admin.register(SocialAccount)
class SocialAccountAdmin(ModelAdmin):
    list_display = ("user", "provider", "display_name", "email", "created_at")
    list_filter = ("provider",)
    search_fields = ("user__email", "user__username", "display_name", "email", "provider_user_id")
    raw_id_fields = ("user",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(DirectMessage)
class DirectMessageAdmin(ModelAdmin):
    list_display = ("sender", "receiver", "content", "is_read", "created_at")
    list_filter = ("is_read",)
    search_fields = ("sender__username", "receiver__username", "content")
    raw_id_fields = ("sender", "receiver")


@admin.register(Friendship)
class FriendshipAdmin(ModelAdmin):
    list_display = ("from_user", "to_user", "status", "created_at", "updated_at")
    list_filter = ("status",)
    search_fields = ("from_user__email", "from_user__username", "to_user__email", "to_user__username")
    raw_id_fields = ("from_user", "to_user")
    readonly_fields = ("created_at", "updated_at")
