"use client";

import {
  ArrowLeft,
  Globe,
  Loader2,
  Plus,
  Puzzle,
  Save,
  Settings,
  Swords,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ModuleDisabledPage } from "@/components/ModuleGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDeveloperApps } from "@/hooks/queries";
import { useModuleConfig } from "@/hooks/useSystemModules";
import {
  type CommunityServer,
  type CustomGameMode,
  type GameModeCreatePayload,
  type PluginInstallPayload,
  type PluginListItem,
  type ServerPlugin,
  type ServerUpdatePayload,
  createServerGameMode,
  deleteServerGameMode,
  getDeveloperServerGameModes,
  getDeveloperServerPlugins,
  getDeveloperServers,
  getPublicPlugins,
  installServerPlugin,
  uninstallServerPlugin,
  updateDeveloperServer,
  updateServerPlugin,
} from "@/lib/api";
import { requireToken } from "@/lib/queryClient";

// ── Settings Tab ──────────────────────────────────────────────

function SettingsTab({
  server,
  appId,
  onUpdated,
}: {
  server: CommunityServer;
  appId: string;
  onUpdated: (s: CommunityServer) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ServerUpdatePayload>({
    name: server.name,
    description: server.description,
    motd: server.motd,
    max_players: server.max_players,
    max_concurrent_matches: server.max_concurrent_matches,
    is_public: server.is_public,
    auto_start_match: server.auto_start_match,
    min_players_to_start: server.min_players_to_start,
    match_start_countdown_seconds: server.match_start_countdown_seconds,
    allow_spectators: server.allow_spectators,
    max_spectators: server.max_spectators,
    allow_custom_game_modes: server.allow_custom_game_modes,
    tags: server.tags,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateDeveloperServer(requireToken(), appId, server.id, form);
      onUpdated(updated);
      toast.success("Ustawienia zapisane");
    } catch {
      toast.error("Nie udalo sie zapisac ustawien");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs text-slate-400">Nazwa serwera</Label>
          <Input
            value={form.name ?? ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border-white/10 bg-white/[0.04] text-zinc-50"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-slate-400">MOTD (wiadomosc dnia)</Label>
          <Input
            value={form.motd ?? ""}
            onChange={(e) => setForm({ ...form, motd: e.target.value })}
            className="border-white/10 bg-white/[0.04] text-zinc-50"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label className="text-xs text-slate-400">Opis</Label>
          <textarea
            value={form.description ?? ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="flex w-full rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-50 placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-cyan-400/40 focus-visible:ring-1 focus-visible:ring-cyan-400/20"
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-slate-400">Maks. graczy</Label>
          <Input
            type="number"
            value={form.max_players ?? 0}
            onChange={(e) => setForm({ ...form, max_players: parseInt(e.target.value) || 0 })}
            className="border-white/10 bg-white/[0.04] text-zinc-50"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-slate-400">Maks. jednoczesnych meczy</Label>
          <Input
            type="number"
            value={form.max_concurrent_matches ?? 0}
            onChange={(e) => setForm({ ...form, max_concurrent_matches: parseInt(e.target.value) || 0 })}
            className="border-white/10 bg-white/[0.04] text-zinc-50"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-slate-400">Min. graczy do startu</Label>
          <Input
            type="number"
            value={form.min_players_to_start ?? 2}
            onChange={(e) => setForm({ ...form, min_players_to_start: parseInt(e.target.value) || 2 })}
            className="border-white/10 bg-white/[0.04] text-zinc-50"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-slate-400">Odliczanie do startu (sek.)</Label>
          <Input
            type="number"
            value={form.match_start_countdown_seconds ?? 10}
            onChange={(e) => setForm({ ...form, match_start_countdown_seconds: parseInt(e.target.value) || 10 })}
            className="border-white/10 bg-white/[0.04] text-zinc-50"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-slate-400">Maks. widzow</Label>
          <Input
            type="number"
            value={form.max_spectators ?? 0}
            onChange={(e) => setForm({ ...form, max_spectators: parseInt(e.target.value) || 0 })}
            className="border-white/10 bg-white/[0.04] text-zinc-50"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-slate-400">Tagi (oddzielone przecinkiem)</Label>
          <Input
            value={(form.tags ?? []).join(", ")}
            onChange={(e) => setForm({ ...form, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
            className="border-white/10 bg-white/[0.04] text-zinc-50"
            placeholder="pvp, competitive, 2v2"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.is_public ?? true} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} className="h-4 w-4 accent-cyan-400" />
          <span className="text-sm text-slate-300">Publiczny</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.auto_start_match ?? false} onChange={(e) => setForm({ ...form, auto_start_match: e.target.checked })} className="h-4 w-4 accent-cyan-400" />
          <span className="text-sm text-slate-300">Auto-start meczu</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.allow_spectators ?? false} onChange={(e) => setForm({ ...form, allow_spectators: e.target.checked })} className="h-4 w-4 accent-cyan-400" />
          <span className="text-sm text-slate-300">Widzowie</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.allow_custom_game_modes ?? false} onChange={(e) => setForm({ ...form, allow_custom_game_modes: e.target.checked })} className="h-4 w-4 accent-cyan-400" />
          <span className="text-sm text-slate-300">Custom tryby gry</span>
        </label>
      </div>

      <Button
        onClick={handleSave}
        disabled={saving}
        className="gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-6 font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90 disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Zapisz ustawienia
      </Button>
    </div>
  );
}

// ── Game Modes Tab ────────────────────────────────────────────

function GameModesTab({ server, appId }: { server: CommunityServer; appId: string }) {
  const [modes, setModes] = useState<CustomGameMode[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newMode, setNewMode] = useState<GameModeCreatePayload>({
    name: "",
    slug: "",
    description: "",
    base_game_mode_slug: "",
    is_public: true,
  });

  useEffect(() => {
    getDeveloperServerGameModes(requireToken(), appId, server.id)
      .then(setModes)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [appId, server.id]);

  const handleCreate = async () => {
    if (!newMode.name || !newMode.slug) return;
    setCreating(true);
    try {
      const created = await createServerGameMode(requireToken(), appId, server.id, newMode);
      setModes((prev) => [...prev, created]);
      setCreateOpen(false);
      setNewMode({ name: "", slug: "", description: "", base_game_mode_slug: "", is_public: true });
      toast.success(`Tryb "${created.name}" utworzony`);
    } catch {
      toast.error("Nie udalo sie utworzyc trybu gry");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (slug: string) => {
    try {
      await deleteServerGameMode(requireToken(), appId, server.id, slug);
      setModes((prev) => prev.filter((m) => m.slug !== slug));
      toast.success("Tryb gry usuniety");
    } catch {
      toast.error("Nie udalo sie usunac trybu gry");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {modes.length === 0 ? "Brak custom trybow gry" : `${modes.length} tryb(ow) gry`}
        </p>
        <Button
          onClick={() => setCreateOpen(true)}
          variant="outline"
          className="gap-1.5 rounded-full border-white/10 bg-white/[0.04] text-xs text-slate-300 hover:bg-white/[0.10]"
        >
          <Plus className="h-3.5 w-3.5" />
          Dodaj tryb
        </Button>
      </div>

      {modes.map((mode) => (
        <div
          key={mode.id}
          className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Swords className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate text-sm font-medium text-zinc-200">{mode.name}</span>
              <Badge className="shrink-0 border-0 bg-slate-500/20 text-[10px] text-slate-400 hover:bg-slate-500/20">
                {mode.slug}
              </Badge>
              {mode.base_game_mode && (
                <Badge className="shrink-0 border-0 bg-cyan-500/15 text-[10px] text-cyan-300 hover:bg-cyan-500/15">
                  {mode.base_game_mode}
                </Badge>
              )}
            </div>
            {mode.description && <p className="mt-0.5 text-xs text-slate-500">{mode.description}</p>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDelete(mode.slug)}
            className="h-8 w-8 shrink-0 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-white/10 bg-zinc-900/95 backdrop-blur-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-zinc-50">Nowy tryb gry</DialogTitle>
            <DialogDescription className="text-sm text-slate-400">
              Utworz niestandardowy tryb gry dla serwera.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Nazwa</Label>
              <Input
                value={newMode.name}
                onChange={(e) => setNewMode({ ...newMode, name: e.target.value })}
                className="border-white/10 bg-white/[0.04] text-zinc-50"
                placeholder="Turbo 4v4"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Slug</Label>
              <Input
                value={newMode.slug}
                onChange={(e) => setNewMode({ ...newMode, slug: e.target.value })}
                className="border-white/10 bg-white/[0.04] text-zinc-50"
                placeholder="turbo-4v4"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Opis</Label>
              <textarea
                value={newMode.description ?? ""}
                onChange={(e) => setNewMode({ ...newMode, description: e.target.value })}
                className="flex w-full rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-50 placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-cyan-400/40 focus-visible:ring-1 focus-visible:ring-cyan-400/20"
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Bazowy tryb gry (slug oficjalnego)</Label>
              <Input
                value={newMode.base_game_mode_slug ?? ""}
                onChange={(e) => setNewMode({ ...newMode, base_game_mode_slug: e.target.value })}
                className="border-white/10 bg-white/[0.04] text-zinc-50"
                placeholder="standard-2p"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={creating || !newMode.name || !newMode.slug}
              className="gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-6 font-display uppercase tracking-[0.15em] text-slate-950 hover:opacity-90 disabled:opacity-40"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Utworz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Plugins Tab ───────────────────────────────────────────────

function PluginsTab({ server, appId }: { server: CommunityServer; appId: string }) {
  const [plugins, setPlugins] = useState<ServerPlugin[]>([]);
  const [availablePlugins, setAvailablePlugins] = useState<PluginListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [installOpen, setInstallOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState("");

  useEffect(() => {
    Promise.all([
      getDeveloperServerPlugins(requireToken(), appId, server.id),
      getPublicPlugins(),
    ])
      .then(([sp, ap]) => {
        setPlugins(sp);
        setAvailablePlugins(ap);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [appId, server.id]);

  const installedSlugs = new Set(plugins.map((p) => p.plugin_slug));
  const notInstalled = availablePlugins.filter((p) => !installedSlugs.has(p.slug));

  const handleInstall = async () => {
    if (!selectedSlug) return;
    setInstalling(true);
    try {
      const installed = await installServerPlugin(requireToken(), appId, server.id, {
        plugin_slug: selectedSlug,
      });
      setPlugins((prev) => [...prev, installed]);
      setInstallOpen(false);
      setSelectedSlug("");
      toast.success("Plugin zainstalowany");
    } catch {
      toast.error("Nie udalo sie zainstalowac pluginu");
    } finally {
      setInstalling(false);
    }
  };

  const handleToggle = async (slug: string, enabled: boolean) => {
    try {
      const updated = await updateServerPlugin(requireToken(), appId, server.id, slug, {
        is_enabled: enabled,
      });
      setPlugins((prev) => prev.map((p) => (p.plugin_slug === slug ? updated : p)));
    } catch {
      toast.error("Nie udalo sie zmienic statusu pluginu");
    }
  };

  const handleUninstall = async (slug: string) => {
    try {
      await uninstallServerPlugin(requireToken(), appId, server.id, slug);
      setPlugins((prev) => prev.filter((p) => p.plugin_slug !== slug));
      toast.success("Plugin odinstalowany");
    } catch {
      toast.error("Nie udalo sie odinstalowac pluginu");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {plugins.length === 0 ? "Brak zainstalowanych pluginow" : `${plugins.length} plugin(ow)`}
        </p>
        <Button
          onClick={() => setInstallOpen(true)}
          variant="outline"
          disabled={notInstalled.length === 0}
          className="gap-1.5 rounded-full border-white/10 bg-white/[0.04] text-xs text-slate-300 hover:bg-white/[0.10] disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Zainstaluj plugin
        </Button>
      </div>

      {plugins.map((plugin) => (
        <div
          key={plugin.id}
          className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <Puzzle className="h-4 w-4 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-zinc-200">{plugin.plugin_name}</span>
                <span className="font-mono text-xs text-slate-500">v{plugin.plugin_version}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={plugin.is_enabled}
              onChange={(e) => handleToggle(plugin.plugin_slug, e.target.checked)}
              className="h-4 w-4 accent-cyan-400"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleUninstall(plugin.plugin_slug)}
              className="h-8 w-8 shrink-0 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent className="border-white/10 bg-zinc-900/95 backdrop-blur-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg text-zinc-50">Zainstaluj plugin</DialogTitle>
            <DialogDescription className="text-sm text-slate-400">
              Wybierz plugin z marketplace do zainstalowania na serwerze.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {notInstalled.map((plugin) => (
              <button
                key={plugin.id}
                type="button"
                onClick={() => setSelectedSlug(plugin.slug)}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                  selectedSlug === plugin.slug
                    ? "border-cyan-300/30 bg-cyan-500/[0.08]"
                    : "border-white/10 bg-white/[0.04] hover:border-white/20"
                }`}
              >
                <Puzzle className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-200">{plugin.name}</div>
                  <div className="text-xs text-slate-500">{plugin.description?.slice(0, 60)}</div>
                </div>
              </button>
            ))}
            {notInstalled.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-500">
                Wszystkie dostepne pluginy sa juz zainstalowane.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={handleInstall}
              disabled={installing || !selectedSlug}
              className="gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-6 font-display uppercase tracking-[0.15em] text-slate-950 hover:opacity-90 disabled:opacity-40"
            >
              {installing && <Loader2 className="h-4 w-4 animate-spin" />}
              Zainstaluj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function ServerConfigPage() {
  const { enabled } = useModuleConfig("developers");
  if (!enabled) return <ModuleDisabledPage slug="developers" />;
  return <ServerConfigContent />;
}

function ServerConfigContent() {
  const { serverId } = useParams<{ serverId: string }>();
  const { data: appsData, isLoading: appsLoading } = useDeveloperApps();
  const apps = appsData?.items ?? [];

  const [server, setServer] = useState<CommunityServer | null>(null);
  const [appId, setAppId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Find the server across all apps
  useEffect(() => {
    if (appsLoading || apps.length === 0) return;

    const findServer = async () => {
      for (const app of apps) {
        try {
          const res = await getDeveloperServers(requireToken(), app.id);
          const found = res.items.find((s: CommunityServer) => s.id === serverId);
          if (found) {
            setServer(found);
            setAppId(app.id);
            break;
          }
        } catch {
          // Try next app
        }
      }
      setLoading(false);
    };

    findServer();
  }, [apps, appsLoading, serverId]);

  if (appsLoading || loading) {
    return (
      <div className="animate-page-in space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!server || !appId) {
    return (
      <div className="animate-page-in space-y-6">
        <Link
          href="/developers/servers"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Powrot do serwerow
        </Link>
        <p className="text-sm text-slate-400">Serwer nie znaleziony.</p>
      </div>
    );
  }

  return (
    <div className="animate-page-in space-y-6">
      <Link
        href="/developers/servers"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Powrot do serwerow
      </Link>

      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Konfiguracja serwera</p>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl text-zinc-50">{server.name}</h1>
          <Badge
            className={`border-0 text-[10px] uppercase tracking-[0.18em] ${
              server.status === "online"
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-slate-500/20 text-slate-400"
            }`}
          >
            {server.status}
          </Badge>
        </div>
        <p className="text-sm text-slate-400">Region: {server.region}</p>
      </div>

      <Tabs defaultValue="settings" className="w-full">
        <TabsList className="h-10 w-full justify-start gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
          <TabsTrigger
            value="settings"
            className="gap-1.5 rounded-lg px-4 text-xs font-display uppercase tracking-[0.15em] data-[state=active]:bg-white/[0.10] data-[state=active]:text-cyan-200"
          >
            <Settings className="h-3.5 w-3.5" />
            Ustawienia
          </TabsTrigger>
          <TabsTrigger
            value="gamemodes"
            className="gap-1.5 rounded-lg px-4 text-xs font-display uppercase tracking-[0.15em] data-[state=active]:bg-white/[0.10] data-[state=active]:text-cyan-200"
          >
            <Swords className="h-3.5 w-3.5" />
            Tryby gry
          </TabsTrigger>
          <TabsTrigger
            value="plugins"
            className="gap-1.5 rounded-lg px-4 text-xs font-display uppercase tracking-[0.15em] data-[state=active]:bg-white/[0.10] data-[state=active]:text-cyan-200"
          >
            <Puzzle className="h-3.5 w-3.5" />
            Pluginy
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4">
          <SettingsTab server={server} appId={appId} onUpdated={setServer} />
        </TabsContent>
        <TabsContent value="gamemodes" className="mt-4">
          <GameModesTab server={server} appId={appId} />
        </TabsContent>
        <TabsContent value="plugins" className="mt-4">
          <PluginsTab server={server} appId={appId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
