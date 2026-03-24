"use client";

import { gsap } from "gsap";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ItemIcon from "@/components/ui/ItemIcon";
import type { ItemOut } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CrateDrop {
  item_name: string;
  item_slug: string;
  rarity: string;
  quantity: number;
}

interface ResolvedLootItem {
  item_slug: string;
  item_name: string;
  rarity: string;
  icon: string;
  weight: number;
}

interface StripItem {
  item_name: string;
  item_slug: string;
  rarity: string;
  icon: string;
  isWon: boolean;
}

export interface CrateOpenModalProps {
  isOpen: boolean;
  onClose: () => void;
  crateItem: ItemOut | null;
  drops: CrateDrop[] | null;
  allItems?: ItemOut[];
}

// ─── Rarity config ────────────────────────────────────────────────────────────

const RARITY_COLOR: Record<string, string> = {
  common: "#9ca3af",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

const RARITY_COLOR_RGB: Record<string, string> = {
  common: "156,163,175",
  uncommon: "34,197,94",
  rare: "59,130,246",
  epic: "168,85,247",
  legendary: "245,158,11",
};

const RARITY_LABEL: Record<string, string> = {
  common: "Zwykły",
  uncommon: "Niepospolity",
  rare: "Rzadki",
  epic: "Epicki",
  legendary: "Legendarny",
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEM_WIDTH = 120;
const ITEM_HEIGHT = 140;
const ITEM_GAP = 8;
const ITEM_STEP = ITEM_WIDTH + ITEM_GAP;
const TOTAL_STRIP_ITEMS = 60;
const WIN_INDEX = 42;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveLootPool(crate: ItemOut, allItems?: ItemOut[]): ResolvedLootItem[] {
  const rawTable = crate.crate_loot_table;
  if (!rawTable || !Array.isArray(rawTable) || rawTable.length === 0) return [];

  const itemMap = new Map<string, ItemOut>();
  if (allItems) for (const item of allItems) itemMap.set(item.slug, item);

  return rawTable
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => {
      const slug = String(e.item_slug ?? "unknown");
      const known = itemMap.get(slug);
      return {
        item_slug: slug,
        item_name: known?.name ?? slug,
        rarity: known?.rarity ?? "common",
        icon: known?.icon ?? "📦",
        weight: typeof e.weight === "number" ? e.weight : 1,
      };
    })
    .filter((e) => e.item_slug !== "unknown");
}

function weightedRandom(pool: ResolvedLootItem[]): ResolvedLootItem {
  const totalWeight = pool.reduce((sum, e) => sum + e.weight, 0);
  let r = Math.random() * totalWeight;
  for (const entry of pool) {
    r -= entry.weight;
    if (r <= 0) return entry;
  }
  return pool[pool.length - 1];
}

function buildStrip(wonDrop: CrateDrop, lootPool: ResolvedLootItem[], wonIcon: string): StripItem[] {
  const strip: StripItem[] = [];
  for (let i = 0; i < TOTAL_STRIP_ITEMS; i++) {
    if (i === WIN_INDEX) {
      strip.push({
        item_name: wonDrop.item_name,
        item_slug: wonDrop.item_slug,
        rarity: wonDrop.rarity,
        icon: wonIcon,
        isWon: true,
      });
    } else {
      const entry = lootPool.length > 0 ? weightedRandom(lootPool) : null;
      strip.push({
        item_name: entry?.item_name ?? "Przedmiot",
        item_slug: entry?.item_slug ?? `filler-${i}`,
        rarity: entry?.rarity ?? "common",
        icon: entry?.icon ?? "📦",
        isWon: false,
      });
    }
  }
  return strip;
}

// ─── Strip Item Card ──────────────────────────────────────────────────────────

function StripCard({ item, highlighted }: { item: StripItem; highlighted: boolean }) {
  const color = RARITY_COLOR[item.rarity] ?? RARITY_COLOR.common;
  const rgb = RARITY_COLOR_RGB[item.rarity] ?? RARITY_COLOR_RGB.common;

  return (
    <div
      style={{
        width: ITEM_WIDTH,
        height: ITEM_HEIGHT,
        flexShrink: 0,
        borderRadius: "10px",
        border: highlighted ? `2px solid ${color}` : "1px solid rgba(255,255,255,0.07)",
        borderTop: `3px solid ${color}`,
        background: highlighted
          ? `linear-gradient(180deg, rgba(${rgb},0.18) 0%, rgba(${rgb},0.04) 100%)`
          : `linear-gradient(180deg, rgba(${rgb},0.06) 0%, rgba(15,23,42,0.8) 100%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px 6px",
        gap: "6px",
        boxShadow: highlighted ? `0 0 30px 8px rgba(${rgb},0.5), inset 0 0 20px rgba(${rgb},0.15)` : "none",
        position: "relative",
        overflow: "hidden",
        transition: "border-color 0.3s, box-shadow 0.5s",
      }}
    >
      {/* Shimmer on highlighted */}
      {highlighted && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(ellipse at 50% 30%, rgba(${rgb},0.25) 0%, transparent 70%)`,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: -2,
              left: "50%",
              transform: "translateX(-50%)",
              width: "60%",
              height: "4px",
              background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
              borderRadius: "2px",
              pointerEvents: "none",
            }}
          />
        </>
      )}
      <div
        style={{ filter: highlighted ? `drop-shadow(0 0 12px ${color})` : "none", lineHeight: 1, userSelect: "none" }}
      >
        <ItemIcon slug={item.item_slug} icon={item.icon} size={40} />
      </div>
      <span
        style={{
          fontSize: "12px",
          lineHeight: 1.2,
          color: highlighted ? color : "rgba(255,255,255,0.5)",
          textAlign: "center",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          padding: "0 2px",
          fontWeight: highlighted ? 700 : 400,
          textShadow: highlighted ? `0 0 12px rgba(${rgb},0.6)` : "none",
        }}
      >
        {item.item_name}
      </span>
    </div>
  );
}

// ─── Phase type ───────────────────────────────────────────────────────────────

type Phase = "idle" | "spinning" | "reveal";

// ─── Main component ───────────────────────────────────────────────────────────

export function CrateOpenModal({ isOpen, onClose, crateItem, drops, allItems }: CrateOpenModalProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [strip, setStrip] = useState<StripItem[]>([]);
  const [highlighted, setHighlighted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const topArrowRef = useRef<HTMLDivElement>(null);
  const bottomArrowRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const glowBgRef = useRef<HTMLDivElement>(null);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const wonDrop = drops?.[0] ?? null;

  // ── Build strip and start GSAP animation ──────────────────────────────────

  const buildAndStartAnimation = useCallback(() => {
    if (!wonDrop || !crateItem) return;

    const lootPool = resolveLootPool(crateItem, allItems);
    const wonItem = allItems?.find((i) => i.slug === wonDrop.item_slug);
    const wonIcon = wonItem?.icon ?? lootPool.find((l) => l.item_slug === wonDrop.item_slug)?.icon ?? "📦";

    const newStrip = buildStrip(wonDrop, lootPool, wonIcon);
    setStrip(newStrip);
    setHighlighted(false);
    setPhase("idle");

    // Wait for React to render the strip items
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const stripEl = stripRef.current;
        const containerEl = containerRef.current;
        if (!stripEl || !containerEl) return;

        const containerWidth = containerEl.clientWidth;
        const wonItemCenterX = WIN_INDEX * ITEM_STEP + ITEM_WIDTH / 2;
        const finalX = containerWidth / 2 - wonItemCenterX;
        const jitter = (Math.random() - 0.5) * 16;
        const targetX = finalX + jitter;
        const startX = containerWidth + 300;

        gsap.set(stripEl, { x: startX });
        setPhase("spinning");

        // Tick sound simulation via subtle scale pulses
        tweenRef.current = gsap.to(stripEl, {
          x: targetX,
          duration: 5.5,
          ease: "power4.out",
          onComplete: () => {
            setPhase("reveal");
            setHighlighted(true);

            const wonColor = RARITY_COLOR[wonDrop.rarity] ?? RARITY_COLOR.common;
            const wonRgb = RARITY_COLOR_RGB[wonDrop.rarity] ?? RARITY_COLOR_RGB.common;

            // ── Reveal timeline ──
            const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
            tlRef.current = tl;

            // 1. Indicator flash
            tl.to(
              indicatorRef.current,
              {
                backgroundColor: wonColor,
                boxShadow: `0 0 20px 6px rgba(${wonRgb},0.7)`,
                duration: 0.4,
              },
              0,
            );
            tl.to(topArrowRef.current, { borderTopColor: wonColor, duration: 0.4 }, 0);
            tl.to(bottomArrowRef.current, { borderBottomColor: wonColor, duration: 0.4 }, 0);

            // 2. Background glow burst
            if (glowBgRef.current) {
              tl.fromTo(
                glowBgRef.current,
                { opacity: 0, scale: 0.5 },
                { opacity: 1, scale: 1, duration: 0.8, ease: "power2.out" },
                0,
              );
            }

            // 3. Won card — big pop with bounce
            const wonCard = stripEl.children[WIN_INDEX] as HTMLElement | undefined;
            if (wonCard) {
              tl.to(
                wonCard,
                {
                  scale: 1.15,
                  duration: 0.4,
                  ease: "back.out(3)",
                },
                0.1,
              );
              tl.to(
                wonCard,
                {
                  scale: 1.05,
                  duration: 0.6,
                  ease: "power2.inOut",
                  yoyo: true,
                  repeat: -1,
                },
                0.5,
              );
            }

            // 4. Reveal section slides up
            if (revealRef.current) {
              tl.fromTo(
                revealRef.current,
                { opacity: 0, y: 30, scale: 0.95 },
                { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.4)" },
                0.3,
              );
            }

            // 5. Subtle shake on the whole dialog for impact
            const dialogEl = containerEl.closest('[role="dialog"]');
            if (dialogEl) {
              tl.fromTo(dialogEl, { x: 0 }, { x: 3, duration: 0.05, repeat: 5, yoyo: true, ease: "none" }, 0);
            }
          },
        });
      });
    });
  }, [wonDrop, crateItem, allItems]);

  useEffect(() => {
    if (isOpen && wonDrop && crateItem) {
      buildAndStartAnimation();
    }
    return () => {
      tweenRef.current?.kill();
      tweenRef.current = null;
      tlRef.current?.kill();
      tlRef.current = null;
    };
  }, [isOpen, wonDrop, crateItem, buildAndStartAnimation]);

  // ── Close handler ──────────────────────────────────────────────────────────

  const handleClose = () => {
    tweenRef.current?.kill();
    tweenRef.current = null;
    tlRef.current?.kill();
    tlRef.current = null;
    setPhase("idle");
    setStrip([]);
    setHighlighted(false);
    onClose();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const wonColor = wonDrop ? (RARITY_COLOR[wonDrop.rarity] ?? RARITY_COLOR.common) : RARITY_COLOR.common;
  const wonRgb = wonDrop ? (RARITY_COLOR_RGB[wonDrop.rarity] ?? RARITY_COLOR_RGB.common) : RARITY_COLOR_RGB.common;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && phase === "reveal") handleClose();
      }}
    >
      <DialogContent
        showCloseButton={phase === "reveal"}
        className="sm:max-w-5xl w-[95vw] p-0 gap-0 overflow-hidden border-white/10"
        style={{
          background: "linear-gradient(180deg, #0c1526 0%, #020617 100%)",
          boxShadow:
            phase === "reveal"
              ? `0 0 80px 20px rgba(${wonRgb},0.15), 0 32px 80px rgba(0,0,0,0.6)`
              : "0 32px 80px rgba(0,0,0,0.6)",
          transition: "box-shadow 0.8s ease",
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <DialogHeader className="px-8 pt-10 pb-6">
          <DialogTitle
            className="text-center font-display text-3xl font-black uppercase tracking-[0.2em]"
            style={{
              color: phase === "reveal" ? wonColor : "#22d3ee",
              textShadow:
                phase === "reveal"
                  ? `0 0 30px rgba(${wonRgb},0.5), 0 0 60px rgba(${wonRgb},0.2)`
                  : "0 0 30px rgba(34,211,238,0.3)",
              transition: "color 0.5s, text-shadow 0.5s",
            }}
          >
            {phase === "reveal"
              ? "Zdobyto!"
              : phase === "spinning"
                ? "Losowanie..."
                : (crateItem?.name ?? "Otwieranie skrzynki")}
          </DialogTitle>
        </DialogHeader>

        {/* ── Spinning strip area ──────────────────────────────────────────── */}
        <div
          ref={containerRef}
          style={{
            position: "relative",
            width: "100%",
            height: `${ITEM_HEIGHT + 24}px`,
            overflow: "hidden",
            background: "linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.2) 100%)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {/* Animated background glow on reveal */}
          <div
            ref={glowBgRef}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: "300px",
              height: "300px",
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(${wonRgb},0.2) 0%, transparent 70%)`,
              opacity: 0,
              pointerEvents: "none",
              zIndex: 1,
            }}
          />

          {/* Strip */}
          <div
            ref={stripRef}
            style={{
              display: "flex",
              gap: `${ITEM_GAP}px`,
              alignItems: "center",
              height: "100%",
              padding: "12px 0",
              willChange: "transform",
              position: "relative",
              zIndex: 2,
            }}
          >
            {strip.map((item, idx) => (
              <StripCard key={`${item.item_slug}-${idx}`} item={item} highlighted={highlighted && item.isWon} />
            ))}
          </div>

          {/* Center indicator line */}
          <div
            ref={indicatorRef}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: "50%",
              width: "2px",
              transform: "translateX(-50%)",
              backgroundColor: "rgba(34,211,238,0.5)",
              boxShadow: "0 0 8px 2px rgba(34,211,238,0.25)",
              zIndex: 10,
              pointerEvents: "none",
            }}
          />

          {/* Top arrow */}
          <div
            ref={topArrowRef}
            style={{
              position: "absolute",
              top: 0,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "10px solid transparent",
              borderRight: "10px solid transparent",
              borderTop: "12px solid rgba(34,211,238,0.6)",
              filter: "drop-shadow(0 2px 4px rgba(34,211,238,0.4))",
              zIndex: 11,
              pointerEvents: "none",
            }}
          />

          {/* Bottom arrow */}
          <div
            ref={bottomArrowRef}
            style={{
              position: "absolute",
              bottom: 0,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "10px solid transparent",
              borderRight: "10px solid transparent",
              borderBottom: "12px solid rgba(34,211,238,0.6)",
              filter: "drop-shadow(0 -2px 4px rgba(34,211,238,0.4))",
              zIndex: 11,
              pointerEvents: "none",
            }}
          />

          {/* Edge fade masks — deeper */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to right, #0c1526 0%, transparent 15%, transparent 85%, #0c1526 100%)",
              pointerEvents: "none",
              zIndex: 5,
            }}
          />

          {/* Scanline effect */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 4px)",
              pointerEvents: "none",
              zIndex: 6,
            }}
          />
        </div>

        {/* ── Reveal section ───────────────────────────────────────────────── */}
        <div
          ref={revealRef}
          style={{
            minHeight: "200px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "36px 40px 44px",
            gap: "18px",
            opacity: 0,
            position: "relative",
          }}
        >
          {wonDrop && phase === "reveal" && (
            <>
              {/* Decorative top line */}
              <div
                style={{
                  width: "80px",
                  height: "2px",
                  background: `linear-gradient(90deg, transparent, ${wonColor}, transparent)`,
                  borderRadius: "1px",
                  marginBottom: "4px",
                }}
              />

              {/* Item name — big and glowing */}
              <div className="text-center">
                <p
                  className="font-display text-4xl font-black uppercase tracking-wider"
                  style={{
                    color: wonColor,
                    textShadow: `0 0 20px rgba(${wonRgb},0.5), 0 0 50px rgba(${wonRgb},0.2)`,
                  }}
                >
                  {wonDrop.item_name}
                </p>
                {wonDrop.quantity > 1 && (
                  <p className="text-lg font-bold mt-1" style={{ color: `rgba(${wonRgb},0.7)` }}>
                    x{wonDrop.quantity}
                  </p>
                )}
              </div>

              {/* Rarity badge — pill style with glow */}
              <div
                className="font-display text-xs font-bold uppercase tracking-[0.3em] px-5 py-1.5 rounded-full"
                style={{
                  color: wonColor,
                  border: `1px solid rgba(${wonRgb},0.4)`,
                  background: `rgba(${wonRgb},0.1)`,
                  boxShadow: `0 0 16px rgba(${wonRgb},0.2)`,
                  letterSpacing: "0.25em",
                }}
              >
                {RARITY_LABEL[wonDrop.rarity] ?? wonDrop.rarity}
              </div>

              {/* Additional drops */}
              {drops && drops.length > 1 && (
                <p className="text-sm text-white/40 text-center mt-1">
                  +{" "}
                  {drops
                    .slice(1)
                    .map((d) => `${d.item_name} x${d.quantity}`)
                    .join(", ")}
                </p>
              )}

              {/* Close button */}
              <Button
                onClick={handleClose}
                className="mt-3 rounded-full px-10 py-2 font-display uppercase tracking-wider text-sm font-bold"
                style={{
                  background: `linear-gradient(135deg, ${wonColor}, rgba(${wonRgb},0.7))`,
                  color: "#020617",
                  boxShadow: `0 0 20px rgba(${wonRgb},0.3), 0 4px 16px rgba(0,0,0,0.4)`,
                }}
              >
                Odbieram
              </Button>
            </>
          )}

          {phase !== "reveal" && (
            <div className="flex flex-col items-center gap-3">
              {/* Spinning crate icon */}
              <div
                style={{
                  animation: "spin 2s linear infinite",
                  filter: "drop-shadow(0 0 12px rgba(34,211,238,0.4))",
                }}
              >
                <ItemIcon slug={crateItem?.slug} icon={crateItem?.icon} size={48} />
              </div>
              <p
                className="text-sm font-display uppercase tracking-[0.2em]"
                style={{
                  color: "#22d3ee",
                  textShadow: "0 0 16px rgba(34,211,238,0.3)",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              >
                {phase === "spinning" ? "Losowanie..." : "Przygotowywanie..."}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
