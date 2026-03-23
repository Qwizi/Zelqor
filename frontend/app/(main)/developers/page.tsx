"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Code, Copy, ArrowRight, KeyRound, CheckCheck, BookOpen } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useModuleConfig } from "@/hooks/useSystemModules";
import { ModuleDisabledPage } from "@/components/ModuleGate";
import { useDeveloperApps, useCreateDeveloperApp } from "@/hooks/queries";
import {
  type DeveloperApp,
  type DeveloperAppCreated,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { DevelopersSkeleton } from "@/components/skeletons/DevelopersSkeleton";

// ── Zod schema ──────────────────────────────────────────────

const createAppSchema = z.object({
  name: z.string().min(1, "Nazwa jest wymagana").max(100, "Nazwa jest za dluga"),
  description: z.string().max(500, "Opis jest za dlugi").optional(),
});

type CreateAppFormValues = z.infer<typeof createAppSchema>;

// ── Helpers ──────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}…`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Sub-components ───────────────────────────────────────────

function AppCard({ app }: { app: DeveloperApp }) {
  return (
    <Link
      href={`/developers/${app.id}`}
      className="hover-lift group relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl transition-all hover:border-white/25 hover:bg-white/[0.10]"
    >
      {/* Status indicator */}
      <div className="absolute right-4 top-4">
        {app.is_active ? (
          <Badge className="border-0 bg-emerald-500/15 text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-500/15">
            Aktywna
          </Badge>
        ) : (
          <Badge className="border-0 bg-slate-500/20 text-[10px] uppercase tracking-[0.18em] text-slate-400 hover:bg-slate-500/20">
            Nieaktywna
          </Badge>
        )}
      </div>

      {/* Icon + name */}
      <div className="flex items-start gap-3 pr-16">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
          <Code className="h-5 w-5 text-cyan-300" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate font-display text-base text-zinc-50 transition-colors group-hover:text-cyan-100">
            {app.name}
          </h3>
          {app.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-400">
              {app.description}
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-slate-500">Brak opisu</p>
          )}
        </div>
      </div>

      {/* Client ID */}
      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-medium">
          Client ID
        </div>
        <div className="mt-0.5 font-mono text-xs text-slate-300">
          {truncate(app.client_id, 28)}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">Utworzono {formatDate(app.created_at)}</span>
        <ArrowRight className="h-4 w-4 text-slate-500 transition-colors group-hover:text-cyan-300" />
      </div>
    </Link>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.08),rgba(251,191,36,0.04))]">
        <Code className="h-7 w-7 text-slate-500" />
      </div>
      <h3 className="mt-4 font-display text-lg text-zinc-300">Brak aplikacji</h3>
      <p className="mt-2 max-w-xs text-sm text-slate-400">
        Stworz pierwsza aplikacje, aby uzyskac klucze API i skonfigurowac webhooki.
      </p>
      <Button
        onClick={onCreateClick}
        className="mt-6 gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-5 font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90"
      >
        <Plus className="h-4 w-4" />
        Utworz aplikacje
      </Button>
    </div>
  );
}

// ── Secret reveal dialog ─────────────────────────────────────

function SecretDialog({
  open,
  createdApp,
  onClose,
}: {
  open: boolean;
  createdApp: DeveloperAppCreated | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!createdApp) return;
    try {
      await navigator.clipboard.writeText(createdApp.client_secret);
      setCopied(true);
      toast.success("Sekret skopiowany do schowka");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="border border-amber-300/20 bg-slate-950 sm:max-w-md"
      >
        <DialogHeader>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-400/10">
            <KeyRound className="h-6 w-6 text-amber-200" />
          </div>
          <DialogTitle className="mt-3 font-display text-xl text-zinc-50">
            Aplikacja utworzona — zapisz sekret
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            Twoj sekret klienta jest wyswietlany <span className="font-semibold text-amber-200">tylko raz</span>.
            Skopiuj i przechowuj go bezpiecznie. Nie bedzie mozna go ponownie wyswietlic.
          </DialogDescription>
        </DialogHeader>

        {createdApp && (
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-slate-400 font-medium">
                Client ID
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-slate-300 break-all">
                {createdApp.client_id}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-slate-400 font-medium">
                Client Secret
              </div>
              <div className="relative">
                <div className="rounded-xl border border-amber-300/20 bg-amber-500/5 px-3 py-2 pr-10 font-mono text-xs text-amber-100 break-all">
                  {createdApp.client_secret}
                </div>
                <button
                  onClick={handleCopy}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <CheckCheck className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="-mx-4 -mb-4 border-t border-white/10 bg-transparent p-4">
          <Button
            onClick={handleCopy}
            variant="outline"
            className="rounded-full border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.12] hover:border-white/25 hover:text-zinc-100"
          >
            <Copy className="mr-2 h-4 w-4" />
            Kopiuj sekret
          </Button>
          <Button
            onClick={onClose}
            className="rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display uppercase tracking-[0.15em] text-slate-950 hover:opacity-90"
          >
            Zapisalem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create app dialog ────────────────────────────────────────

function CreateAppDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (app: DeveloperAppCreated) => void;
}) {
  const createApp = useCreateDeveloperApp();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateAppFormValues>({
    resolver: zodResolver(createAppSchema),
  });

  const onSubmit = async (values: CreateAppFormValues) => {
    try {
      const app = await createApp.mutateAsync({
        name: values.name,
        description: values.description || undefined,
      });
      reset();
      onOpenChange(false);
      onCreated(app);
    } catch {
      toast.error("Nie udalo sie utworzyc aplikacji.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-white/10 bg-slate-950 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-zinc-50">
            Utworz aplikacje
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            Aplikacje pozwalaja generowac klucze API i konfigurowac webhooki do integracji z MapLord.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="app-name" className="text-xs uppercase tracking-[0.18em] text-slate-400">
              Nazwa <span className="text-red-400">*</span>
            </Label>
            <Input
              id="app-name"
              placeholder="Moja aplikacja"
              className="border-white/10 bg-white/[0.04] text-zinc-50 placeholder:text-slate-600 focus-visible:border-cyan-400/40 focus-visible:ring-cyan-400/20"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-red-400">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="app-desc" className="text-xs uppercase tracking-[0.18em] text-slate-400">
              Opis <span className="text-slate-600">(opcjonalnie)</span>
            </Label>
            <textarea
              id="app-desc"
              rows={3}
              placeholder="Do czego sluzy ta aplikacja?"
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-sm text-zinc-50 placeholder:text-slate-600 outline-none transition-colors focus-visible:border-cyan-400/40 focus-visible:ring-2 focus-visible:ring-cyan-400/20 disabled:pointer-events-none disabled:opacity-50 resize-none"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-xs text-red-400">{errors.description.message}</p>
            )}
          </div>

          <DialogFooter className="-mx-4 -mb-4 border-t border-white/10 bg-transparent p-4">
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.12] hover:border-white/25 hover:text-zinc-100"
                />
              }
            >
              Anuluj
            </DialogClose>
            <Button
              type="submit"
              disabled={isSubmitting || createApp.isPending}
              className="gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display uppercase tracking-[0.15em] text-slate-950 hover:opacity-90 disabled:opacity-60"
            >
              {isSubmitting || createApp.isPending ? (
                "Tworzenie…"
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Utworz
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function DevelopersPage() {
  const { enabled } = useModuleConfig("developers");
  if (!enabled) return <ModuleDisabledPage slug="developers" />;
  return <DevelopersContent />;
}

function DevelopersContent() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();

  const [createOpen, setCreateOpen] = useState(false);
  const [createdApp, setCreatedApp] = useState<DeveloperAppCreated | null>(null);
  const [secretOpen, setSecretOpen] = useState(false);

  const { data: appsData, isLoading: appsLoading } = useDeveloperApps();
  const apps: DeveloperApp[] = appsData?.items ?? [];

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) {
      router.replace("/login");
    }
  }, [user, authLoading, token, router]);

  const handleCreated = (app: DeveloperAppCreated) => {
    setCreatedApp(app);
    setSecretOpen(true);
    toast.success(`Aplikacja "${app.name}" utworzona.`);
  };

  const handleSecretClose = () => {
    setSecretOpen(false);
    setCreatedApp(null);
  };

  if (authLoading || appsLoading) {
    return <DevelopersSkeleton />;
  }

  return (
    <div className="animate-page-in space-y-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Deweloperzy</p>
          <h1 className="font-display text-3xl text-zinc-50">Panel deweloperski</h1>
          <p className="mt-2 max-w-lg text-sm text-slate-400">
            Tworzenie aplikacji, kluczy API i webhookow do integracji z MapLord.
          </p>
        </div>

        <div className="flex gap-3">
          <Link href="/developers/docs">
            <Button
              variant="outline"
              className="h-11 shrink-0 gap-2 self-start rounded-full border-white/10 bg-white/[0.04] px-5 font-display uppercase tracking-[0.2em] text-slate-300 hover:bg-white/[0.12] hover:border-white/25 hover:text-zinc-100"
            >
              <BookOpen className="h-4 w-4" />
              Dokumentacja
            </Button>
          </Link>
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-11 shrink-0 gap-2 self-start rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-6 font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Utworz aplikacje
          </Button>
        </div>
      </div>

      {/* ── Stats strip ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">
            Wszystkie
          </div>
          <div className="mt-1 font-display text-2xl text-zinc-50">{apps.length}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">
            Aktywne
          </div>
          <div className="mt-1 font-display text-2xl text-emerald-300">
            {apps.filter((a) => a.is_active).length}
          </div>
        </div>
        <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl sm:col-span-1">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">
            Nieaktywne
          </div>
          <div className="mt-1 font-display text-2xl text-slate-400">
            {apps.filter((a) => !a.is_active).length}
          </div>
        </div>
      </div>

      {/* ── App grid ───────────────────────────────────────── */}
      {apps.length === 0 ? (
        <EmptyState onCreateClick={() => setCreateOpen(true)} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}

      {/* ── Dialogs ────────────────────────────────────────── */}
      <CreateAppDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      <SecretDialog
        open={secretOpen}
        createdApp={createdApp}
        onClose={handleSecretClose}
      />
    </div>
  );
}
