"use client";

import { ArrowLeft, Calendar, Globe, Plus, Server, ServerCrash, Shield, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useDeveloperApps } from "@/hooks/queries";
import { useAuth } from "@/hooks/useAuth";
import { useModuleConfig } from "@/hooks/useSystemModules";
import { type CommunityServer, deleteDeveloperServer, getDeveloperServers } from "@/lib/api";
import { requireToken } from "@/lib/queryClient";

// ── Helpers ────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatHeartbeat(iso: string | null): string {
  if (!iso) return "Brak sygnalu";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Przed chwila";
  if (mins < 60) return `${mins} min temu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} godz. temu`;
  return new Date(iso).toLocaleDateString("pl-PL");
}

// ── Status badge ───────────────────────────────────────────────

function StatusBadge({ status }: { status: CommunityServer["status"] }) {
  if (status === "online") {
    return (
      <Badge className="border-0 bg-emerald-500/15 text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-500/15">
        Online
      </Badge>
    );
  }
  if (status === "maintenance") {
    return (
      <Badge className="border-0 bg-amber-500/15 text-[10px] uppercase tracking-[0.18em] text-amber-300 hover:bg-amber-500/15">
        Konserwacja
      </Badge>
    );
  }
  return (
    <Badge className="border-0 bg-slate-500/20 text-[10px] uppercase tracking-[0.18em] text-slate-400 hover:bg-slate-500/20">
      Offline
    </Badge>
  );
}

// ── Delete confirmation dialog ─────────────────────────────────

function DeleteServerDialog({
  open,
  server,
  appId,
  onClose,
  onDeleted,
}: {
  open: boolean;
  server: CommunityServer | null;
  appId: string;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!server) return;
    setDeleting(true);
    try {
      await deleteDeveloperServer(requireToken(), appId, server.id);
      toast.success(`Serwer "${server.name}" zostal usuniety.`, { id: "dev-server-deleted" });
      onDeleted(server.id);
      onClose();
    } catch {
      toast.error("Nie udalo sie usunac serwera.", { id: "dev-server-delete-error" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="border border-red-500/20 bg-slate-950 sm:max-w-md">
        <DialogHeader>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
            <Trash2 className="h-6 w-6 text-red-400" />
          </div>
          <DialogTitle className="mt-3 font-display text-xl text-zinc-50">Usun serwer</DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            Czy na pewno chcesz usunac serwer <span className="font-semibold text-zinc-200">"{server?.name}"</span>? Tej
            operacji nie mozna cofnac.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="-mx-4 -mb-4 border-t border-white/10 bg-transparent p-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={deleting}
            className="rounded-full border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.12] hover:border-white/25 hover:text-zinc-100"
          >
            Anuluj
          </Button>
          <Button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-full border border-red-500/30 bg-red-600/70 font-display uppercase tracking-[0.15em] text-zinc-50 hover:bg-red-600/90 disabled:opacity-60"
          >
            {deleting ? "Usuwanie…" : "Usun serwer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Server row ─────────────────────────────────────────────────

function ServerRow({
  server,
  onDeleteClick,
}: {
  server: CommunityServer;
  onDeleteClick: (server: CommunityServer) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
          <Globe className="h-5 w-5 text-cyan-300" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm text-zinc-50">{server.name}</span>
            {server.is_verified && <Shield className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-label="Zweryfikowany" />}
            <StatusBadge status={server.status} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Globe className="h-3 w-3" />
              {server.region}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Sygnał: {formatHeartbeat(server.last_heartbeat)}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Dodano {formatDate(server.created_at)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-auto">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDeleteClick(server)}
          className="h-8 rounded-full border-red-500/20 bg-red-500/5 px-3 text-xs text-red-400 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Usun
        </Button>
      </div>
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────

function ServerListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.08),rgba(251,191,36,0.04))]">
        <ServerCrash className="h-7 w-7 text-slate-500" />
      </div>
      <h3 className="mt-4 font-display text-lg text-zinc-300">Brak serwerow</h3>
      <p className="mt-2 max-w-xs text-sm text-slate-400">
        Zadna aplikacja nie zarejestrowala jeszcze serwera spolecznosci. Uzyj API, aby zarejestrowac serwer.
      </p>
    </div>
  );
}

// ── App selector ───────────────────────────────────────────────

function AppSelector({ selectedAppId, onChange }: { selectedAppId: string; onChange: (id: string) => void }) {
  const { data } = useDeveloperApps();
  const apps = data?.items ?? [];

  if (apps.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {apps.map((app) => (
        <Button
          key={app.id}
          variant="outline"
          onClick={() => onChange(app.id)}
          className={`h-9 rounded-full px-4 text-xs font-display uppercase tracking-[0.15em] transition-all ${
            selectedAppId === app.id
              ? "border-cyan-300/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/15"
              : "border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.10] hover:border-white/25 hover:text-zinc-100"
          }`}
        >
          {app.name}
        </Button>
      ))}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────

export default function DeveloperServersPage() {
  const { enabled } = useModuleConfig("developers");
  if (!enabled) return <ModuleDisabledPage slug="developers" />;
  return <DeveloperServersContent />;
}

function DeveloperServersContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const { data: appsData, isLoading: appsLoading } = useDeveloperApps();
  const apps = appsData?.items ?? [];

  const [selectedAppId, setSelectedAppId] = useState<string>("");
  const [servers, setServers] = useState<CommunityServer[]>([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CommunityServer | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Default to first app once loaded
  useEffect(() => {
    if (!appsLoading && apps.length > 0 && !selectedAppId) {
      setSelectedAppId(apps[0].id);
    }
  }, [apps, appsLoading, selectedAppId]);

  // Fetch servers for selected app
  useEffect(() => {
    if (!selectedAppId) return;
    setServersLoading(true);
    getDeveloperServers(requireToken(), selectedAppId)
      .then((res) => setServers(res.items))
      .catch(() => setServers([]))
      .finally(() => setServersLoading(false));
  }, [selectedAppId]);

  // Auth redirect
  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/login");
  }, [user, authLoading, router]);

  const handleDeleteClick = (server: CommunityServer) => {
    setDeleteTarget(server);
    setDeleteOpen(true);
  };

  const handleDeleted = (id: string) => {
    setServers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleDeleteClose = () => {
    setDeleteOpen(false);
    setDeleteTarget(null);
  };

  if (authLoading || appsLoading) {
    return (
      <div className="animate-page-in space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <ServerListSkeleton />
      </div>
    );
  }

  const onlineCount = servers.filter((s) => s.status === "online").length;

  return (
    <div className="animate-page-in space-y-6">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-400">
            <Link href="/developers" className="hover:text-zinc-100 transition-colors">
              Deweloperzy
            </Link>
            <span>/</span>
            <span>Serwery</span>
          </div>
          <h1 className="font-display text-3xl text-zinc-50">Serwery spolecznosci</h1>
          <p className="mt-2 max-w-lg text-sm text-slate-400">
            Zarzadzaj serwerami spolecznosci zarejestrowanymi przez Twoje aplikacje. Serwery rejestruja sie
            automatycznie przez API przy uzyciu klucza API.
          </p>
        </div>

        <Link href="/developers">
          <Button
            variant="outline"
            className="h-11 shrink-0 self-start gap-2 rounded-full border-white/10 bg-white/[0.04] px-5 font-display uppercase tracking-[0.2em] text-slate-300 hover:bg-white/[0.12] hover:border-white/25 hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Panel deweloperski
          </Button>
        </Link>
      </div>

      {/* ── Stats strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Wszystkie</div>
          <div className="mt-1 font-display text-2xl text-zinc-50">
            {serversLoading ? <Skeleton className="h-7 w-10" /> : servers.length}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Online</div>
          <div className="mt-1 font-display text-2xl text-emerald-300">
            {serversLoading ? <Skeleton className="h-7 w-10" /> : onlineCount}
          </div>
        </div>
        <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl sm:col-span-1">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Aplikacje</div>
          <div className="mt-1 font-display text-2xl text-slate-400">{apps.length}</div>
        </div>
      </div>

      {/* ── App selector ─────────────────────────────────────── */}
      {apps.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Aplikacja</div>
          <AppSelector selectedAppId={selectedAppId} onChange={setSelectedAppId} />
        </div>
      )}

      {/* ── Info box: registration via API ───────────────────── */}
      <div className="flex items-start gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-500/5 px-4 py-3">
        <Server className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
        <p className="text-xs text-slate-300">
          Serwery spolecznosci rejestruja sie automatycznie przez API przy starcie, wysylajac regularny heartbeat. Aby
          zarejestrowac serwer, uzyj klucza API swojej aplikacji i wywolaj endpoint{" "}
          <code className="rounded bg-black/30 px-1 font-mono text-[11px] text-cyan-200">
            POST /api/v1/servers/register/
          </code>
          .
        </p>
      </div>

      {/* ── Server list ──────────────────────────────────────── */}
      {!selectedAppId || apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Plus className="h-7 w-7 text-slate-500" />
          </div>
          <h3 className="mt-4 font-display text-lg text-zinc-300">Brak aplikacji</h3>
          <p className="mt-2 max-w-xs text-sm text-slate-400">
            Najpierw utworz aplikacje w panelu deweloperskim, aby moc zarządzac serwerami.
          </p>
          <Link href="/developers">
            <Button className="mt-6 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90">
              Przejdz do panelu
            </Button>
          </Link>
        </div>
      ) : serversLoading ? (
        <ServerListSkeleton />
      ) : servers.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <ServerRow key={server.id} server={server} onDeleteClick={handleDeleteClick} />
          ))}
        </div>
      )}

      {/* ── Delete dialog ────────────────────────────────────── */}
      <DeleteServerDialog
        open={deleteOpen}
        server={deleteTarget}
        appId={selectedAppId}
        onClose={handleDeleteClose}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
