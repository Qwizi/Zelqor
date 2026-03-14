"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import {
  getDeveloperApp,
  updateDeveloperApp,
  deleteDeveloperApp,
  createAPIKey,
  getAPIKeys,
  deleteAPIKey,
  createWebhook,
  getWebhooks,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  getWebhookDeliveries,
  getAppUsage,
  getAvailableScopes,
  getAvailableEvents,
  type DeveloperApp,
  type APIKeyOut,
  type APIKeyCreated,
  type WebhookOut,
  type WebhookDelivery,
  type UsageStats,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Key,
  Webhook,
  BarChart3,
  Plus,
  Trash2,
  Send,
  Copy,
  Check,
  ArrowLeft,
  RefreshCw,
  Edit,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Activity,
  Clock,
  Shield,
} from "lucide-react";

// --- Helpers ---

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac.");
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:border-white/30 hover:bg-white/[0.10] hover:text-zinc-100"
      title="Kopiuj do schowka"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

// --- API Keys Tab ---

interface CreateKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableScopes: string[];
  onCreated: (key: APIKeyCreated) => void;
  appId: string;
  token: string;
}

function CreateKeyDialog({
  open,
  onOpenChange,
  availableScopes,
  onCreated,
  appId,
  token,
}: CreateKeyDialogProps) {
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [rateLimit, setRateLimit] = useState(1000);
  const [loading, setLoading] = useState(false);

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleSubmit = async () => {
    if (selectedScopes.length === 0) {
      toast.error("Wybierz co najmniej jedno uprawnienie.");
      return;
    }
    setLoading(true);
    try {
      const created = await createAPIKey(token, appId, {
        scopes: selectedScopes,
        rate_limit: rateLimit,
      });
      onCreated(created);
      setSelectedScopes([]);
      setRateLimit(1000);
      onOpenChange(false);
    } catch {
      toast.error("Nie udalo sie utworzyc klucza API.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/10 bg-zinc-900 text-zinc-50 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-zinc-50">
            Utworz klucz API
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Scopes */}
          <div className="space-y-2">
            <Label className="text-sm text-slate-400">Uprawnienia</Label>
            <div className="grid grid-cols-2 gap-2">
              {availableScopes.map((scope) => (
                <label
                  key={scope}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                    selectedScopes.includes(scope)
                      ? "border-cyan-400/40 bg-cyan-500/10 text-zinc-50"
                      : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-zinc-100"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 accent-cyan-400"
                  />
                  <span className="truncate font-mono text-xs">{scope}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Rate limit */}
          <div className="space-y-2">
            <Label className="text-sm text-slate-400">
              Limit zapytan (na godzine)
            </Label>
            <Input
              type="number"
              min={1}
              max={100000}
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value))}
              className="border-white/10 bg-white/[0.04] text-zinc-50 placeholder:text-slate-600 focus-visible:border-cyan-400/50"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-full border-white/10 bg-transparent text-slate-300 hover:bg-white/[0.10] hover:border-white/25 hover:text-zinc-100"
          >
            Anuluj
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || selectedScopes.length === 0}
            className="rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90 disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Key className="h-4 w-4" />
                Utworz klucz
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface NewKeyAlertProps {
  keyData: APIKeyCreated;
  onDismiss: () => void;
}

function NewKeyAlert({ keyData, onDismiss }: NewKeyAlertProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(keyData.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac.");
    }
  };

  return (
    <div className="rounded-2xl border border-amber-300/30 bg-amber-400/5 p-5">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-300" />
        <p className="font-display text-base text-amber-200">
          Skopiuj klucz API teraz — nie zostanie wyswietlony ponownie.
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
        <code className="flex-1 truncate font-mono text-sm text-zinc-100">
          {keyData.key}
        </code>
        <button
          onClick={handleCopy}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:border-white/25 hover:bg-white/[0.10] hover:text-zinc-100"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="mt-3 text-xs text-slate-400 underline-offset-2 hover:text-slate-300 hover:underline"
      >
        Zapisalem klucz — zamknij
      </button>
    </div>
  );
}

interface APIKeysTabProps {
  appId: string;
  token: string;
}

function APIKeysTab({ appId, token }: APIKeysTabProps) {
  const [keys, setKeys] = useState<APIKeyOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newKey, setNewKey] = useState<APIKeyCreated | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const data = await getAPIKeys(token, appId);
      setKeys(data.items);
    } catch {
      toast.error("Nie udalo sie zaladowac kluczy API.");
    } finally {
      setLoading(false);
    }
  }, [token, appId]);

  useEffect(() => {
    loadKeys();
    getAvailableScopes(token)
      .then((d) => setAvailableScopes(d.scopes))
      .catch(() => {});
  }, [loadKeys, token]);

  const handleCreated = (key: APIKeyCreated) => {
    setNewKey(key);
    setKeys((prev) => [key, ...prev]);
    toast.success("Klucz API zostal utworzony.");
  };

  const handleDelete = async (keyId: string, prefix: string) => {
    if (
      !window.confirm(
        "Czy na pewno chcesz usunac ten klucz API?"
      )
    )
      return;
    setDeletingId(keyId);
    try {
      await deleteAPIKey(token, appId, keyId);
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
      toast.success("Klucz API dezaktywowany.");
    } catch {
      toast.error("Nie udalo sie usunac klucza API.");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {keys.length} {keys.length === 1 ? "klucz" : "kluczy"}
        </p>
        <Button
          onClick={() => setDialogOpen(true)}
          className="gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-5 font-display text-xs uppercase tracking-[0.2em] text-slate-950 hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Utworz klucz
        </Button>
      </div>

      {newKey && (
        <NewKeyAlert keyData={newKey} onDismiss={() => setNewKey(null)} />
      )}

      {keys.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-10 text-center">
          <Key className="mx-auto h-8 w-8 text-slate-500" />
          <p className="mt-3 text-sm text-slate-400">
            Brak kluczy API. Utworz klucz API, aby korzystac z publicznego API.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div
              key={key.id}
              className="rounded-2xl border border-white/10 bg-white/[0.05] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-sm text-zinc-100">
                      {key.prefix}...
                    </code>
                    <Badge
                      className={`border-0 text-[10px] hover:bg-transparent ${
                        key.is_active
                          ? "bg-emerald-400/15 text-emerald-300"
                          : "bg-red-400/15 text-red-400"
                      }`}
                    >
                      {key.is_active ? "Aktywny" : "Nieaktywny"}
                    </Badge>
                  </div>

                  {/* Scopes */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {key.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] text-slate-400"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      {key.rate_limit} req/hr
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {key.last_used
                        ? `Ostatnie uzycie: ${formatDate(key.last_used)}`
                        : "Nigdy"}
                    </span>
                    <span>Utworzono: {formatDate(key.created_at)}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(key.id, key.prefix)}
                  disabled={deletingId === key.id}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-400/20 bg-red-400/5 text-red-400 transition-colors hover:border-red-400/40 hover:bg-red-400/10 disabled:opacity-50"
                  title="Usun klucz"
                >
                  {deletingId === key.id ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateKeyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        availableScopes={availableScopes}
        onCreated={handleCreated}
        appId={appId}
        token={token}
      />
    </div>
  );
}

// --- Webhooks Tab ---

interface CreateWebhookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableEvents: string[];
  onCreated: (webhook: WebhookOut) => void;
  appId: string;
  token: string;
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  availableEvents,
  onCreated,
  appId,
  token,
}: CreateWebhookDialogProps) {
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event)
        ? prev.filter((e) => e !== event)
        : [...prev, event]
    );
  };

  const handleSubmit = async () => {
    if (!url.trim()) {
      toast.error("Adres URL webhooka jest wymagany.");
      return;
    }
    if (selectedEvents.length === 0) {
      toast.error("Wybierz co najmniej jedno zdarzenie.");
      return;
    }
    setLoading(true);
    try {
      const created = await createWebhook(token, appId, {
        url: url.trim(),
        events: selectedEvents,
      });
      onCreated(created);
      setUrl("");
      setSelectedEvents([]);
      onOpenChange(false);
    } catch {
      toast.error("Nie udalo sie utworzyc webhooka.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/10 bg-zinc-900 text-zinc-50 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-zinc-50">
            Utworz webhook
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label className="text-sm text-slate-400">Endpoint URL</Label>
            <Input
              type="url"
              placeholder="https://example.com/webhook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="border-white/10 bg-white/[0.04] text-zinc-50 placeholder:text-slate-600 focus-visible:border-cyan-400/50"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-slate-400">Zdarzenia</Label>
            <div className="grid grid-cols-2 gap-2">
              {availableEvents.map((event) => (
                <label
                  key={event}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                    selectedEvents.includes(event)
                      ? "border-amber-400/40 bg-amber-500/10 text-zinc-50"
                      : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-zinc-100"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 accent-amber-400"
                  />
                  <span className="truncate font-mono text-xs">{event}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-full border-white/10 bg-transparent text-slate-300 hover:bg-white/[0.10] hover:border-white/25 hover:text-zinc-100"
          >
            Anuluj
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !url.trim() || selectedEvents.length === 0}
            className="rounded-full border border-amber-300/30 bg-[linear-gradient(135deg,#fbbf24,#f59e0b)] font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90 disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Webhook className="h-4 w-4" />
                Utworz
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EditWebhookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhook: WebhookOut;
  availableEvents: string[];
  onUpdated: (webhook: WebhookOut) => void;
  appId: string;
  token: string;
}

function EditWebhookDialog({
  open,
  onOpenChange,
  webhook,
  availableEvents,
  onUpdated,
  appId,
  token,
}: EditWebhookDialogProps) {
  const [url, setUrl] = useState(webhook.url);
  const [selectedEvents, setSelectedEvents] = useState<string[]>(
    webhook.events
  );
  const [isActive, setIsActive] = useState(webhook.is_active);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUrl(webhook.url);
    setSelectedEvents(webhook.events);
    setIsActive(webhook.is_active);
  }, [webhook]);

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event)
        ? prev.filter((e) => e !== event)
        : [...prev, event]
    );
  };

  const handleSubmit = async () => {
    if (!url.trim()) {
      toast.error("Adres URL webhooka jest wymagany.");
      return;
    }
    setLoading(true);
    try {
      const updated = await updateWebhook(token, appId, webhook.id, {
        url: url.trim(),
        events: selectedEvents,
        is_active: isActive,
      });
      onUpdated(updated);
      onOpenChange(false);
      toast.success("Webhook zaktualizowany.");
    } catch {
      toast.error("Nie udalo sie zaktualizowac webhooka.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/10 bg-zinc-900 text-zinc-50 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-zinc-50">
            Edytuj webhook
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label className="text-sm text-slate-400">Endpoint URL</Label>
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="border-white/10 bg-white/[0.04] text-zinc-50 placeholder:text-slate-600 focus-visible:border-cyan-400/50"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-slate-400">Zdarzenia</Label>
            <div className="grid grid-cols-2 gap-2">
              {availableEvents.map((event) => (
                <label
                  key={event}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                    selectedEvents.includes(event)
                      ? "border-amber-400/40 bg-amber-500/10 text-zinc-50"
                      : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-zinc-100"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 accent-amber-400"
                  />
                  <span className="truncate font-mono text-xs">{event}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-white/10 accent-cyan-400"
              />
              Aktywny
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-full border-white/10 bg-transparent text-slate-300 hover:bg-white/[0.10] hover:border-white/25 hover:text-zinc-100"
          >
            Anuluj
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90 disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Check className="h-4 w-4" />
                Zapisz
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface WebhookRowProps {
  webhook: WebhookOut;
  appId: string;
  token: string;
  availableEvents: string[];
  onDeleted: (id: string) => void;
  onUpdated: (webhook: WebhookOut) => void;
}

function WebhookRow({
  webhook,
  appId,
  token,
  availableEvents,
  onDeleted,
  onUpdated,
}: WebhookRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const loadDeliveries = async () => {
    if (deliveries !== null) return;
    setLoadingDeliveries(true);
    try {
      const data = await getWebhookDeliveries(token, appId, webhook.id);
      setDeliveries(data.items);
    } catch {
      toast.error("Nie udalo sie zaladowac dostarczeń.");
    } finally {
      setLoadingDeliveries(false);
    }
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadDeliveries();
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testWebhook(token, appId, webhook.id);
      if (result.success) {
        toast.success(
          `Test webhooka wyslany — HTTP ${result.status_code ?? "?"}: ${result.message}`
        );
      } else {
        toast.error(
          `Test webhooka nie powiodl sie — HTTP ${result.status_code ?? "?"}: ${result.message}`
        );
      }
    } catch {
      toast.error("Nie udalo sie przetestowac webhooka.");
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        "Czy na pewno chcesz usunac ten webhook?"
      )
    )
      return;
    setDeleting(true);
    try {
      await deleteWebhook(token, appId, webhook.id);
      onDeleted(webhook.id);
      toast.success("Webhook usuniety.");
    } catch {
      toast.error("Nie udalo sie usunac webhooka.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Expand toggle */}
          <button
            onClick={handleExpand}
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:border-white/25 hover:bg-white/[0.10] hover:text-zinc-100"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-sm text-zinc-100">
                {webhook.url}
              </span>
              <Badge
                className={`border-0 text-[10px] hover:bg-transparent ${
                  webhook.is_active
                    ? "bg-emerald-400/15 text-emerald-300"
                    : "bg-red-400/15 text-red-400"
                }`}
              >
                {webhook.is_active ? "Aktywny" : "Nieaktywny"}
              </Badge>
              {webhook.failure_count > 0 && (
                <Badge className="border-0 bg-red-400/15 text-[10px] text-red-400 hover:bg-transparent">
                  {webhook.failure_count} bledow
                </Badge>
              )}
            </div>

            {/* Events */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {webhook.events.map((event) => (
                <span
                  key={event}
                  className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] text-slate-400"
                >
                  {event}
                </span>
              ))}
            </div>

            <p className="mt-2 text-xs text-slate-400">
              Utworzono: {formatDate(webhook.created_at)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/5 text-cyan-400 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 disabled:opacity-50"
              title="Wyslij test"
            >
              {testing ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              onClick={() => setEditOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:border-white/30 hover:bg-white/[0.10] hover:text-zinc-100"
              title="Edytuj webhook"
            >
              <Edit className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-400/20 bg-red-400/5 text-red-400 transition-colors hover:border-red-400/40 hover:bg-red-400/10 disabled:opacity-50"
              title="Usun webhook"
            >
              {deleting ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Deliveries panel */}
      {expanded && (
        <div className="border-t border-white/10 bg-black/20 p-4">
          <p className="mb-3 text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">
            Dostarczenia
          </p>
          {loadingDeliveries ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Ladowanie...
            </div>
          ) : deliveries && deliveries.length > 0 ? (
            <div className="space-y-2">
              {deliveries.slice(0, 10).map((delivery) => (
                <div
                  key={delivery.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
                >
                  <div
                    className={`h-2 w-2 rounded-full ${
                      delivery.success ? "bg-emerald-400" : "bg-red-400"
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-zinc-100">
                      {delivery.event}
                    </span>
                    <p className="text-[10px] text-slate-400">
                      {formatDate(delivery.created_at)}
                    </p>
                  </div>
                  <Badge
                    className={`border-0 text-[10px] hover:bg-transparent ${
                      delivery.success
                        ? "bg-emerald-400/15 text-emerald-300"
                        : "bg-red-400/15 text-red-400"
                    }`}
                  >
                    {delivery.response_status ?? "—"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Brak dostarczeń.</p>
          )}
        </div>
      )}

      <EditWebhookDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        webhook={webhook}
        availableEvents={availableEvents}
        onUpdated={onUpdated}
        appId={appId}
        token={token}
      />
    </div>
  );
}

interface WebhooksTabProps {
  appId: string;
  token: string;
}

function WebhooksTab({ appId, token }: WebhooksTabProps) {
  const [webhooks, setWebhooks] = useState<WebhookOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadWebhooks = useCallback(async () => {
    try {
      const data = await getWebhooks(token, appId);
      setWebhooks(data.items);
    } catch {
      toast.error("Nie udalo sie zaladowac webhookow.");
    } finally {
      setLoading(false);
    }
  }, [token, appId]);

  useEffect(() => {
    loadWebhooks();
    getAvailableEvents(token)
      .then((d) => setAvailableEvents(d.events))
      .catch(() => {});
  }, [loadWebhooks, token]);

  const handleCreated = (webhook: WebhookOut) => {
    setWebhooks((prev) => [webhook, ...prev]);
    toast.success("Webhook utworzony.");
  };

  const handleDeleted = (id: string) => {
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
  };

  const handleUpdated = (updated: WebhookOut) => {
    setWebhooks((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {webhooks.length} {webhooks.length === 1 ? "webhook" : "webhookow"}
        </p>
        <Button
          onClick={() => setDialogOpen(true)}
          className="gap-2 rounded-full border border-amber-300/30 bg-[linear-gradient(135deg,#fbbf24,#f59e0b)] px-5 font-display text-xs uppercase tracking-[0.2em] text-slate-950 hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Utworz webhook
        </Button>
      </div>

      {webhooks.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-10 text-center">
          <Webhook className="mx-auto h-8 w-8 text-slate-500" />
          <p className="mt-3 text-sm text-slate-400">
            Brak webhookow. Dodaj webhook, aby otrzymywac zdarzenia z MapLord.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.id}
              webhook={webhook}
              appId={appId}
              token={token}
              availableEvents={availableEvents}
              onDeleted={handleDeleted}
              onUpdated={handleUpdated}
            />
          ))}
        </div>
      )}

      <CreateWebhookDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        availableEvents={availableEvents}
        onCreated={handleCreated}
        appId={appId}
        token={token}
      />
    </div>
  );
}

// --- Usage Tab ---

interface UsageTabProps {
  appId: string;
  token: string;
}

function UsageTab({ appId, token }: UsageTabProps) {
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAppUsage(token, appId)
      .then(setUsage)
      .catch(() => toast.error("Nie udalo sie zaladowac statystyk."))
      .finally(() => setLoading(false));
  }, [token, appId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-10 text-center">
        <BarChart3 className="mx-auto h-8 w-8 text-slate-500" />
        <p className="mt-3 text-sm text-slate-400">
          Nie udalo sie zaladowac danych.
        </p>
      </div>
    );
  }

  const stats: Array<{
    label: string;
    value: number | string;
    color: string;
    icon: React.ReactNode;
  }> = [
    {
      label: "Aktywne klucze",
      value: usage.active_keys,
      color: "text-cyan-200",
      icon: <Key className="h-4 w-4 text-cyan-300" />,
    },
    {
      label: "Webhooki",
      value: usage.total_webhooks,
      color: "text-amber-200",
      icon: <Webhook className="h-4 w-4 text-amber-300" />,
    },
    {
      label: "Aktywne webhooki",
      value: usage.active_webhooks,
      color: "text-emerald-300",
      icon: <Activity className="h-4 w-4 text-emerald-400" />,
    },
    {
      label: "Dostarczenia",
      value: usage.total_deliveries,
      color: "text-zinc-50",
      icon: <Send className="h-4 w-4 text-slate-400" />,
    },
    {
      label: "Udane dostarczenia",
      value: usage.successful_deliveries,
      color: "text-emerald-300",
      icon: <Check className="h-4 w-4 text-emerald-400" />,
    },
    {
      label: "Nieudane dostarczenia",
      value: usage.failed_deliveries,
      color: "text-red-400",
      icon: <AlertTriangle className="h-4 w-4 text-red-400" />,
    },
  ];

  const successRate =
    usage.total_deliveries > 0
      ? Math.round((usage.successful_deliveries / usage.total_deliveries) * 100)
      : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-white/10 bg-white/[0.05] p-4"
          >
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">
              {stat.icon}
              {stat.label}
            </div>
            <div className={`mt-2 font-display text-3xl ${stat.color}`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {successRate !== null && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">
            Skutecznosc dostarczeń webhookow
          </p>
          <div className="mt-3 flex items-end gap-3">
            <span
              className={`font-display text-4xl ${
                successRate >= 90
                  ? "text-emerald-300"
                  : successRate >= 70
                    ? "text-amber-200"
                    : "text-red-400"
              }`}
            >
              {successRate}%
            </span>
            <span className="mb-1 text-sm text-slate-400">
              {usage.successful_deliveries} z {usage.total_deliveries}{" "}
              dostarczeń
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all ${
                successRate >= 90
                  ? "bg-emerald-400"
                  : successRate >= 70
                    ? "bg-amber-400"
                    : "bg-red-400"
              }`}
              style={{ width: `${successRate}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// --- Edit App Dialog ---

interface EditAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app: DeveloperApp;
  onUpdated: (app: DeveloperApp) => void;
  token: string;
}

function EditAppDialog({
  open,
  onOpenChange,
  app,
  onUpdated,
  token,
}: EditAppDialogProps) {
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setName(app.name);
    setDescription(app.description);
  }, [app]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Nazwa aplikacji jest wymagana.");
      return;
    }
    setLoading(true);
    try {
      const updated = await updateDeveloperApp(token, app.id, {
        name: name.trim(),
        description: description.trim(),
      });
      onUpdated(updated);
      onOpenChange(false);
      toast.success("Aplikacja zaktualizowana.");
    } catch {
      toast.error("Nie udalo sie zaktualizowac aplikacji.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/10 bg-zinc-900 text-zinc-50">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-zinc-50">
            Edytuj aplikacje
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm text-slate-400">Nazwa</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-white/10 bg-white/[0.04] text-zinc-50 placeholder:text-slate-600 focus-visible:border-cyan-400/50"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm text-slate-400">Opis</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-50 placeholder:text-slate-600 outline-none transition-colors focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
              placeholder="Opisz, co robi twoja aplikacja..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-full border-white/10 bg-transparent text-slate-300 hover:bg-white/[0.10] hover:border-white/25 hover:text-zinc-100"
          >
            Anuluj
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !name.trim()}
            className="rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90 disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Check className="h-4 w-4" />
                Zapisz
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Page ---

export default function DeveloperAppDetailPage() {
  const { appId } = useParams<{ appId: string }>();
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();
  const [app, setApp] = useState<DeveloperApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }

    getDeveloperApp(token, appId)
      .then(setApp)
      .catch(() => {
        toast.error("Nie udalo sie zaladowac danych aplikacji.");
        router.replace("/developers");
      })
      .finally(() => setLoading(false));
  }, [authLoading, user, token, appId, router]);

  const handleDelete = async () => {
    if (!token || !app) return;
    if (
      !window.confirm(
        "Czy na pewno chcesz usunac te aplikacje? Ta operacja jest nieodwracalna."
      )
    )
      return;
    setDeleting(true);
    try {
      await deleteDeveloperApp(token, app.id);
      toast.success("Aplikacja usunieta.");
      router.replace("/developers");
    } catch {
      toast.error("Nie udalo sie usunac aplikacji.");
      setDeleting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Image
          src="/assets/match_making/circle291.webp"
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 animate-spin object-contain"
        />
      </div>
    );
  }

  if (!app || !token) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/developers"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Powrot do aplikacji
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl text-zinc-50">{app.name}</h1>
              <Badge
                className={`border-0 text-xs hover:bg-transparent ${
                  app.is_active
                    ? "bg-emerald-400/15 text-emerald-300"
                    : "bg-red-400/15 text-red-400"
                }`}
              >
                {app.is_active ? "Aktywny" : "Nieaktywny"}
              </Badge>
            </div>
            {app.description && (
              <p className="mt-2 text-sm text-slate-400">{app.description}</p>
            )}

            {/* Client ID */}
            <div className="mt-3 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs text-slate-400">Client ID:</span>
              <code className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-0.5 font-mono text-xs text-slate-300">
                {app.client_id}
              </code>
              <CopyButton text={app.client_id} />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Utworzono: {formatDate(app.created_at)}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300 hover:border-white/25 hover:bg-white/[0.12] hover:text-zinc-100 transition-colors"
            >
              <Edit className="h-4 w-4" />
              Edytuj
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              {deleting ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Usun
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <Tabs defaultValue="keys">
          <TabsList className="mb-6 w-full justify-start gap-1 rounded-2xl border border-white/10 bg-white/[0.05] p-1">
            <TabsTrigger
              value="keys"
              className="flex-none gap-2 rounded-xl px-4 py-2 text-sm data-active:bg-white/[0.08] data-active:text-zinc-50"
            >
              <Key className="h-4 w-4" />
              Klucze API
            </TabsTrigger>
            <TabsTrigger
              value="webhooks"
              className="flex-none gap-2 rounded-xl px-4 py-2 text-sm data-active:bg-white/[0.08] data-active:text-zinc-50"
            >
              <Webhook className="h-4 w-4" />
              Webhooki
            </TabsTrigger>
            <TabsTrigger
              value="usage"
              className="flex-none gap-2 rounded-xl px-4 py-2 text-sm data-active:bg-white/[0.08] data-active:text-zinc-50"
            >
              <BarChart3 className="h-4 w-4" />
              Statystyki
            </TabsTrigger>
          </TabsList>

          <TabsContent value="keys">
            <APIKeysTab appId={app.id} token={token} />
          </TabsContent>

          <TabsContent value="webhooks">
            <WebhooksTab appId={app.id} token={token} />
          </TabsContent>

          <TabsContent value="usage">
            <UsageTab appId={app.id} token={token} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit app dialog */}
      <EditAppDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        app={app}
        onUpdated={setApp}
        token={token}
      />
    </div>
  );
}
