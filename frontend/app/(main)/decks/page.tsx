"use client";

import { useEffect, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { useModuleConfig } from "@/hooks/useSystemModules";
import { ModuleDisabledPage } from "@/components/ModuleGate";
import ItemIcon from "@/components/ui/ItemIcon";
import { type DeckOut } from "@/lib/api";
import {
  useMyDecks,
  useCreateDeck,
  useDeleteDeck,
  useSetDefaultDeck,
} from "@/hooks/queries";

export default function DecksPage() {
  const { enabled } = useModuleConfig("cosmetics");
  if (!enabled) return <ModuleDisabledPage slug="cosmetics" />;
  return <DecksContent />;
}

function DecksContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");

  const { data: decksData, isLoading: loading } = useMyDecks();
  const createMutation = useCreateDeck();
  const deleteMutation = useDeleteDeck();
  const setDefaultMutation = useSetDefaultDeck();

  const decks: DeckOut[] = decksData?.items ?? [];

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const handleCreate = async () => {
    if (!newDeckName.trim()) return;
    try {
      const deck = await createMutation.mutateAsync({ name: newDeckName.trim() });
      toast.success("Talia utworzona");
      setNewDeckName("");
      setCreating(false);
      router.push(`/decks/${deck.id}`);
    } catch {
      toast.error("Nie udało się utworzyć talii");
    }
  };

  const handleDelete = async (deckId: string) => {
    try {
      await deleteMutation.mutateAsync(deckId);
      toast.success("Talia usunięta");
    } catch {
      toast.error("Nie udało się usunąć talii");
    }
  };

  const handleSetDefault = async (deckId: string) => {
    try {
      await setDefaultMutation.mutateAsync(deckId);
      toast.success("Domyślna talia ustawiona");
    } catch {
      toast.error("Nie udało się ustawić domyślnej talii");
    }
  };

  const saving = createMutation.isPending;

  if (authLoading || !user) return null;

  return (
    <div className="space-y-3 md:space-y-8 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-0">
        <div>
          <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">Talia</p>
          <h1 className="font-display text-2xl md:text-5xl text-foreground">Talie</h1>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 md:gap-2 rounded-full md:rounded-2xl bg-primary px-4 py-2.5 md:px-8 md:py-3.5 text-sm md:text-lg font-semibold md:font-display uppercase tracking-wider text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-all"
          >
            <Plus className="h-4 w-4 md:h-5 md:w-5" />
            <span className="md:hidden">Nowa</span>
            <span className="hidden md:inline">Nowa talia</span>
          </button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="px-4 md:px-0">
          <div className="flex items-center gap-3 rounded-2xl bg-card/60 md:bg-card border border-transparent md:border-border p-3 md:p-6">
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                placeholder="Nazwa talii..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") { setCreating(false); setNewDeckName(""); }
                }}
                autoFocus
                className="w-full bg-transparent font-display text-lg md:text-2xl text-foreground placeholder:text-muted-foreground/40 outline-none border-b-2 border-primary/30 focus:border-primary pb-1"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={saving || !newDeckName.trim()}
              className="flex h-10 w-10 md:h-14 md:w-auto items-center justify-center md:gap-2 md:px-8 rounded-full md:rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-all active:scale-[0.95]"
            >
              <Check className="h-5 w-5" />
              <span className="hidden md:inline font-display text-lg uppercase tracking-wider">Utwórz</span>
            </button>
            <button
              onClick={() => { setCreating(false); setNewDeckName(""); }}
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Deck list */}
      {loading ? (
        <div className="px-4 md:px-0 py-10 text-center text-sm md:text-lg text-muted-foreground">
          Ładowanie...
        </div>
      ) : decks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 md:gap-5 px-4 md:px-0 py-12 md:py-16 text-center">
          <Layers className="h-12 w-12 md:h-16 md:w-16 text-muted-foreground/30" />
          <p className="text-sm md:text-xl text-muted-foreground">Nie masz żadnych talii</p>
          <p className="text-xs md:text-base text-muted-foreground/60">Utwórz pierwszą talię aby rozpocząć grę</p>
        </div>
      ) : (
        <div className="space-y-1 md:space-y-4 px-4 md:px-0">
          {decks.map((deck) => {
            const totalItems = deck.items.reduce((s, i) => s + i.quantity, 0);
            return (
              <div key={deck.id}>
                {/* Mobile: compact list row */}
                <div
                  role="button"
                  tabIndex={0}
                  className={`flex w-full items-center gap-3 rounded-xl py-3 px-1 text-left transition-all active:bg-muted/50 md:hidden cursor-pointer ${
                    deck.is_default ? "bg-accent/5" : ""
                  }`}
                  onClick={() => router.push(`/decks/${deck.id}`)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/decks/${deck.id}`); }}
                >
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                    deck.is_default ? "bg-accent/15 border border-accent/25" : "bg-secondary border border-border"
                  }`}>
                    {deck.is_default ? <Shield className="h-5 w-5 text-accent" /> : <Layers className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground truncate">{deck.name}</span>
                      {deck.is_default && (
                        <span className="text-[10px] font-bold uppercase text-accent">Domyślna</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {totalItems} {totalItems === 1 ? "przedmiot" : totalItems < 5 ? "przedmioty" : "przedmiotów"}
                    </span>
                  </div>

                  {/* Mobile: inline actions */}
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {!deck.is_default && (
                      <button
                        onClick={() => handleSetDefault(deck.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground active:bg-muted"
                      >
                        <StarOff className="h-4 w-4" />
                      </button>
                    )}
                    {deck.is_default && (
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg text-accent">
                        <Star className="h-4 w-4" />
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(deck.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground active:bg-destructive/10 active:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                </div>

                {/* Desktop: full card */}
                <Card
                  className={`hidden md:block rounded-2xl transition-all hover:border-border/60 ${
                    deck.is_default ? "border-accent/25" : ""
                  }`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-center gap-5">
                      <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border ${
                        deck.is_default ? "border-accent/30 bg-accent/10" : "border-border bg-secondary"
                      }`}>
                        {deck.is_default ? (
                          <Shield className="h-7 w-7 text-accent" />
                        ) : (
                          <Layers className="h-7 w-7 text-muted-foreground" />
                        )}
                      </div>

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

                    {deck.items.length > 0 && (
                      <>
                        <Separator className="my-5" />
                        <div className="flex gap-3 overflow-x-auto pb-1">
                          {deck.items.map((di, i) => (
                            <div
                              key={`${di.item.slug}-${i}`}
                              className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2"
                            >
                              <ItemIcon slug={di.item.slug} icon={di.item.icon} size={24} />
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
