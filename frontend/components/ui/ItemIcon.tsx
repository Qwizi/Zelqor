"use client";

import Image from "next/image";

/** Maps item slugs (or slug prefixes) to SVG icon paths. */
const SVG_MAP: Record<string, string> = {
  // Materials
  "armor-piercing-ammo": "/assets/items/svg/armor-piercing-ammo.svg",
  antimatter: "/assets/items/svg/antimatter.svg",
  "artifact-fragment": "/assets/items/svg/artifact-fragment.svg",
  "titanium-composite": "/assets/items/svg/titanium-composite.svg",
  capacitor: "/assets/items/svg/capacitor.svg",
  "raw-silicon": "/assets/items/svg/raw-silicon.svg",
  "radar-module": "/assets/items/svg/radar-module.svg",
  "fuel-cell": "/assets/items/svg/fuel-cell.svg",
  "quantum-processor": "/assets/items/svg/quantum-processor.svg",
  gunpowder: "/assets/items/svg/gunpowder.svg",
  "command-protocol": "/assets/items/svg/command-protocol.svg",
  "circuit-board": "/assets/items/svg/circuit-board.svg",
  "plasma-core": "/assets/items/svg/plasma-core.svg",
  mercury: "/assets/items/svg/mercury.svg",
  "copper-ore": "/assets/items/svg/copper-ore.svg",
  "lead-ore": "/assets/items/svg/lead-ore.svg",
  "tungsten-ore": "/assets/items/svg/tungsten-ore.svg",
  "iron-alloy": "/assets/items/svg/iron-alloy.svg",
  carbon: "/assets/items/svg/carbon.svg",
  "steel-scrap": "/assets/items/svg/steel-scrap.svg",
  "optic-fiber": "/assets/items/svg/optic-fiber.svg",
  // Crates & Keys
  "crate-soldier": "/assets/items/svg/crate-soldier.svg",
  "crate-officer": "/assets/items/svg/crate-officer.svg",
  "crate-general": "/assets/items/svg/crate-general.svg",
  "key-soldier": "/assets/items/svg/key-soldier.svg",
  "key-officer": "/assets/items/svg/key-officer.svg",
  "key-general": "/assets/items/svg/key-general.svg",
  // Cosmetics
  "skin-arctic-white": "/assets/items/svg/skin-arctic-white.svg",
  "skin-desert-camo": "/assets/items/svg/skin-desert-camo.svg",
  "skin-blood-red": "/assets/items/svg/skin-blood-red.svg",
  "skin-golden-commander": "/assets/items/svg/skin-golden-commander.svg",
};

/** Prefix-based matching for blueprints, packages, boosts, VFX. */
const PREFIX_MAP: [string, string][] = [
  // Blueprints → use unit/building SVGs
  ["bp-tank", "/assets/units/svg/tank.svg"],
  ["bp-fighter", "/assets/units/svg/fighter.svg"],
  ["bp-bomber", "/assets/units/svg/bomber.svg"],
  ["bp-ship", "/assets/units/svg/ship.svg"],
  ["bp-submarine", "/assets/units/svg/submarine.svg"],
  ["bp-commando", "/assets/units/svg/commando.svg"],
  ["bp-artillery", "/assets/units/svg/artillery.svg"],
  ["bp-sam", "/assets/units/svg/sam.svg"],
  ["bp-heavy-tank", "/assets/units/svg/tank.svg"],
  ["bp-commandos", "/assets/units/svg/commando.svg"],
  ["bp-barracks", "/assets/buildings/svg/barracks.svg"],
  ["bp-factory", "/assets/buildings/svg/factory.svg"],
  ["bp-carrier", "/assets/buildings/svg/airport.svg"],
  ["bp-port", "/assets/buildings/svg/port.svg"],
  ["bp-tower", "/assets/buildings/svg/tower.svg"],
  ["bp-radar", "/assets/buildings/svg/radar.svg"],
  // Tactical packages
  ["pkg-nuke", "/assets/items/svg/pkg-nuke.svg"],
  ["pkg-virus", "/assets/items/svg/pkg-virus.svg"],
  ["pkg-shield", "/assets/items/svg/pkg-shield.svg"],
  ["pkg-flash", "/assets/items/svg/pkg-flash.svg"],
  ["pkg-conscription", "/assets/items/svg/pkg-conscription.svg"],
  ["pkg-recon", "/assets/items/svg/pkg-recon.svg"],
  // Boosts
  ["boost-blitzkrieg", "/assets/items/svg/boost-blitzkrieg.svg"],
  ["boost-war-economy", "/assets/items/svg/boost-war-economy.svg"],
  ["boost-fortification", "/assets/items/svg/boost-fortification.svg"],
  ["boost-mobilization", "/assets/items/svg/boost-mobilization.svg"],
  // VFX / effects / emblems
  ["vfx-", "/assets/items/svg/vfx-generic.svg"],
  ["effect-", "/assets/items/svg/effect-generic.svg"],
  ["emblem-", "/assets/items/svg/emblem-generic.svg"],
];

/**
 * Resolve an SVG asset path for an item slug.
 * Returns null if no SVG exists (fallback to emoji).
 */
export function getItemSvg(slug: string | null | undefined): string | null {
  if (!slug) return null;
  // Exact match
  if (SVG_MAP[slug]) return SVG_MAP[slug];
  // Prefix match
  for (const [prefix, path] of PREFIX_MAP) {
    if (slug.startsWith(prefix)) return path;
  }
  return null;
}

interface ItemIconProps {
  slug?: string | null;
  icon?: string | null;
  /** Pixel size (width & height). Default 32. */
  size?: number;
  className?: string;
}

/**
 * Renders an item icon — SVG image if available, emoji text fallback.
 * Use this everywhere items are displayed for consistent military icons.
 */
export default function ItemIcon({ slug, icon, size = 32, className }: ItemIconProps) {
  const svgPath = getItemSvg(slug);

  if (svgPath) {
    return (
      <Image
        src={svgPath}
        alt={slug ?? ""}
        width={size}
        height={size}
        className={
          className ??
          `h-${size <= 20 ? 5 : size <= 32 ? 8 : size <= 48 ? 12 : 16} w-${size <= 20 ? 5 : size <= 32 ? 8 : size <= 48 ? 12 : 16} object-contain`
        }
        style={{ width: size, height: size }}
      />
    );
  }

  // Emoji fallback
  return (
    <span className={className ?? "leading-none select-none"} style={{ fontSize: size * 0.75 }}>
      {icon || "📦"}
    </span>
  );
}
