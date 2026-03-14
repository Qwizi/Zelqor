"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  Layers,
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  createDeck,
  deleteDeck,
  getMyDecks,
  setDefaultDeck,
  type DeckOut,
} from "@/lib/api";

const RARITY_BADGE: Record<string, string> = {
  common: "text-slate-400",
  uncommon: "text-green-400",
  rare: "text-blue-400",
  epic: "text-purple-400",
  legendary: "text-amber-400",
};

export default function DecksPage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();

  const [decks, setDecks] = useState<DeckOut[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [creating, setCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const decksRes = await getMyDecks(token);
      setDecks(decksRes.items);
    } catch {
      toast.error("Nie udało się załadować talii");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Create ──────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!token || !newDeckName.trim()) return;
    setSaving(true);
    try {
      const deck = await createDeck(token, { name: newDeckName.trim() });
      toast.success("Talia utworzona");
      setNewDeckName("");
      setCreating(false);
      // Navigate directly to the editor
      router.push(`/decks/${deck.id}`);
    } catch {
      toast.error("Nie udało się utworzyć talii");
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async (deckId: string) => {
    if (!token) return;
    try {
      await deleteDeck(token, deckId);
      toast.success("Talia usunięta");
      await loadData();
    } catch {
      toast.error("Nie udało się usunąć talii");
    }
  };

  // ─── Set default ─────────────────────────────────────────────────────────────

  const handleSetDefault = async (deckId: string) => {
    if (!token) return;
    try {
      await setDefaultDeck(token, deckId);
      toast.success("Domyślna talia ustawiona");
      await loadData();
    } catch {
      toast.error("Nie udało się ustawić domyślnej talii");
    }
  };

  if (authLoading || !user) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Talia</p>
          <h1 className="font-display text-3xl text-zinc-50">Kreator talii</h1>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="rounded-xl border border-cyan-400/20 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25 transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Nowa talia
          </button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 backdrop-blur-xl">
          <p className="mb-3 text-sm font-medium text-amber-200">Nowa talia</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              placeholder="Nazwa talii..."
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-slate-500 focus:border-amber-400/40 focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={saving || !newDeckName.trim()}
              className="rounded-xl bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 border border-amber-400/20"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setNewDeckName("");
              }}
              className="rounded-xl text-slate-400"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Deck cards */}
      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-8 text-center backdrop-blur-xl">
          <p className="text-slate-400">Ładowanie...</p>
        </div>
      ) : decks.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-10 text-center backdrop-blur-xl">
          <Layers className="mx-auto mb-3 h-10 w-10 text-slate-500" />
          <p className="text-slate-400">Nie masz żadnych talii. Utwórz pierwszą!</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => {
            const totalItems = deck.items.reduce((s, i) => s + i.quantity, 0);
            return (
              <div
                key={deck.id}
                className="group relative rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl transition-all hover:border-white/25 hover:bg-white/[0.06]"
              >
                {/* Default glow stripe */}
                {deck.is_default && (
                  <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
                )}

                <div className="mb-4 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-display text-base text-zinc-50">
                        {deck.name}
                      </h3>
                      {deck.is_default && (
                        <span className="shrink-0 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                          Domyślna
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {totalItems}{" "}
                      {totalItems === 1
                        ? "przedmiot"
                        : totalItems < 5
                          ? "przedmioty"
                          : "przedmiotów"}
                    </p>
                  </div>
                </div>

                {/* Item preview pills */}
                {deck.items.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {deck.items.slice(0, 6).map((di) => (
                      <span
                        key={di.item.slug}
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${RARITY_BADGE[di.item.rarity] ?? "text-slate-400"} border-white/10 bg-white/[0.06]`}
                      >
                        <span className="text-[11px] leading-none">
                          {di.item.icon || "📦"}
                        </span>
                        {di.item.name}
                        {di.quantity > 1 && (
                          <span className="rounded-full bg-white/10 px-1 font-bold">
                            x{di.quantity}
                          </span>
                        )}
                      </span>
                    ))}
                    {deck.items.length > 6 && (
                      <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] text-slate-400">
                        +{deck.items.length - 6} więcej
                      </span>
                    )}
                  </div>
                )}

                {deck.items.length === 0 && (
                  <p className="mb-4 text-xs text-slate-500">Talia jest pusta</p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/decks/${deck.id}`}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-slate-300 transition-colors hover:border-cyan-400/20 hover:bg-cyan-400/10 hover:text-cyan-300"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edytuj
                  </Link>
                  {!deck.is_default && (
                    <button
                      onClick={() => handleSetDefault(deck.id)}
                      title="Ustaw jako domyślną"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:border-amber-400/20 hover:bg-amber-400/10 hover:text-amber-300"
                    >
                      <StarOff className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {deck.is_default && (
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-400/20 bg-amber-400/10 text-amber-300">
                      <Star className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <button
                    onClick={() => handleDelete(deck.id)}
                    title="Usuń"
                    className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-500 transition-colors hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
