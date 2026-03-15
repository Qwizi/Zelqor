"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  Layers,
  Pencil,
  Plus,
  Shield,
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
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import {
  createDeck,
  deleteDeck,
  getMyDecks,
  setDefaultDeck,
  type DeckOut,
} from "@/lib/api";

export default function DecksPage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();

  const [decks, setDecks] = useState<DeckOut[]>([]);
  const [loading, setLoading] = useState(true);
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

  const handleCreate = async () => {
    if (!token || !newDeckName.trim()) return;
    setSaving(true);
    try {
      const deck = await createDeck(token, { name: newDeckName.trim() });
      toast.success("Talia utworzona");
      setNewDeckName("");
      setCreating(false);
      router.push(`/decks/${deck.id}`);
    } catch {
      toast.error("Nie udało się utworzyć talii");
    } finally {
      setSaving(false);
    }
  };

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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">Talia</p>
          <h1 className="font-display text-4xl sm:text-5xl text-foreground">Twoje talie</h1>
        </div>
        {!creating && (
          <Button
            onClick={() => setCreating(true)}
            className="h-14 rounded-2xl bg-primary px-8 font-display text-lg uppercase tracking-wider text-primary-foreground hover:bg-primary/90 gap-2"
          >
            <Plus className="h-5 w-5" />
            Nowa talia
          </Button>
        )}
      </div>

      {/* Create form — inline */}
      {creating && (
        <Card className="rounded-2xl">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
                <Plus className="h-7 w-7 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={newDeckName}
                  onChange={(e) => setNewDeckName(e.target.value)}
                  placeholder="Wpisz nazwę talii..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setCreating(false); setNewDeckName(""); }
                  }}
                  autoFocus
                  className="w-full bg-transparent font-display text-2xl text-foreground placeholder:text-muted-foreground/40 outline-none border-b-2 border-primary/30 focus:border-primary pb-1"
                />
              </div>
              <Button
                onClick={handleCreate}
                disabled={saving || !newDeckName.trim()}
                className="h-14 rounded-2xl bg-primary px-8 font-display text-lg uppercase tracking-wider text-primary-foreground hover:bg-primary/90 gap-2"
              >
                <Check className="h-5 w-5" />
                Utwórz
              </Button>
              <button
                onClick={() => { setCreating(false); setNewDeckName(""); }}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deck list */}
      {loading ? (
        <Card className="rounded-2xl">
          <CardContent className="p-10 text-center">
            <p className="text-lg text-muted-foreground">Ładowanie...</p>
          </CardContent>
        </Card>
      ) : decks.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-5 p-16 text-center">
            <Layers className="h-16 w-16 text-muted-foreground/30" />
            <p className="text-xl text-muted-foreground">Nie masz żadnych talii</p>
            <p className="text-base text-muted-foreground/60">Utwórz pierwszą talię aby rozpocząć grę</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {decks.map((deck) => {
            const totalItems = deck.items.reduce((s, i) => s + i.quantity, 0);
            return (
              <Card
                key={deck.id}
                className={`rounded-2xl transition-all hover:border-border/60 ${
                  deck.is_default ? "border-accent/25" : ""
                }`}
              >
                <CardContent className="p-6">
                  <div className="flex items-center gap-5">
                    {/* Icon */}
                    <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border ${
                      deck.is_default ? "border-accent/30 bg-accent/10" : "border-border bg-secondary"
                    }`}>
                      {deck.is_default ? (
                        <Shield className="h-7 w-7 text-accent" />
                      ) : (
                        <Layers className="h-7 w-7 text-muted-foreground" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-display text-2xl text-foreground truncate">{deck.name}</h3>
                        {deck.is_default && (
                          <Badge className="bg-accent/20 text-accent border-accent/30 text-sm">Domyślna</Badge>
                        )}
                      </div>
                      <p className="text-base text-muted-foreground">
                        {totalItems} {totalItems === 1 ? "przedmiot" : totalItems < 5 ? "przedmioty" : "przedmiotów"}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/decks/${deck.id}`}
                        className="flex h-11 items-center gap-2 rounded-xl border border-border bg-secondary px-4 text-base font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                      >
                        <Pencil className="h-4 w-4" />
                        Edytuj
                      </Link>
                      {!deck.is_default && (
                        <button
                          onClick={() => handleSetDefault(deck.id)}
                          title="Ustaw jako domyślną"
                          className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-secondary text-muted-foreground transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                        >
                          <StarOff className="h-5 w-5" />
                        </button>
                      )}
                      {deck.is_default && (
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
                          <Star className="h-5 w-5" />
                        </span>
                      )}
                      <button
                        onClick={() => handleDelete(deck.id)}
                        title="Usuń"
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-secondary text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  {/* Items preview */}
                  {deck.items.length > 0 && (
                    <>
                      <Separator className="my-5" />
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {deck.items.map((di, i) => (
                          <div
                            key={`${di.item.slug}-${i}`}
                            className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2"
                          >
                            <span className="text-xl">{di.item.icon || "📦"}</span>
                            <span className="text-base text-foreground font-medium whitespace-nowrap">
                              {di.item.name.replace(/^(Pakiet|Blueprint|Bonus): ?/, "")}
                            </span>
                            {di.quantity > 1 && (
                              <Badge variant="outline" className="text-xs">x{di.quantity}</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
