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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import {
  createDeck,
  deleteDeck,
  getMyDecks,
  setDefaultDeck,
  type DeckOut,
} from "@/lib/api";

const RARITY_TEXT: Record<string, string> = {
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
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Talia</p>
          <h1 className="font-display text-3xl text-foreground">Kreator talii</h1>
        </div>
        {!creating && (
          <Button
            onClick={() => setCreating(true)}
            className="rounded-xl border border-primary/20 bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
            variant="ghost"
            size="sm"
          >
            <Plus className="h-4 w-4" />
            Nowa talia
          </Button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <Card className="rounded-2xl border-accent/20 bg-accent/5 backdrop-blur-xl">
          <CardContent className="p-5">
            <p className="mb-3 text-sm font-medium text-accent">Nowa talia</p>
            <div className="flex gap-2">
              <Input
                type="text"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                placeholder="Nazwa talii..."
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={saving || !newDeckName.trim()}
                className="rounded-xl bg-accent/20 text-accent hover:bg-accent/30 border border-accent/20"
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
                className="rounded-xl text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deck cards */}
      {loading ? (
        <Card className="rounded-2xl backdrop-blur-xl">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Ładowanie...</p>
          </CardContent>
        </Card>
      ) : decks.length === 0 ? (
        <Card className="rounded-2xl backdrop-blur-xl">
          <CardContent className="p-10 text-center">
            <Layers className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">Nie masz żadnych talii. Utwórz pierwszą!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => {
            const totalItems = deck.items.reduce((s, i) => s + i.quantity, 0);
            return (
              <Card
                key={deck.id}
                className="group relative rounded-2xl backdrop-blur-xl transition-all hover:border-border/60"
              >
                {/* Default glow stripe */}
                {deck.is_default && (
                  <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
                )}

                <CardContent className="p-6">
                  <div className="mb-4 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-display text-base text-foreground">
                          {deck.name}
                        </h3>
                        {deck.is_default && (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-accent/25 bg-accent/10 text-[10px] text-accent uppercase tracking-wide hover:bg-accent/10"
                          >
                            Domyślna
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
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
                          className={`flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium ${RARITY_TEXT[di.item.rarity] ?? "text-muted-foreground"}`}
                        >
                          <span className="text-[11px] leading-none">
                            {di.item.icon || "📦"}
                          </span>
                          {di.item.name}
                          {di.quantity > 1 && (
                            <span className="rounded-full bg-muted px-1 font-bold">
                              x{di.quantity}
                            </span>
                          )}
                        </span>
                      ))}
                      {deck.items.length > 6 && (
                        <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                          +{deck.items.length - 6} więcej
                        </span>
                      )}
                    </div>
                  )}

                  {deck.items.length === 0 && (
                    <p className="mb-4 text-xs text-muted-foreground">Talia jest pusta</p>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/decks/${deck.id}`}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/20 hover:bg-primary/10 hover:text-primary"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edytuj
                    </Link>
                    {!deck.is_default && (
                      <button
                        onClick={() => handleSetDefault(deck.id)}
                        title="Ustaw jako domyślną"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground transition-colors hover:border-accent/20 hover:bg-accent/10 hover:text-accent"
                      >
                        <StarOff className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {deck.is_default && (
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                        <Star className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(deck.id)}
                      title="Usuń"
                      className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground transition-colors hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
