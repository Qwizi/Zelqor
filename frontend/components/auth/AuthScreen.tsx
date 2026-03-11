"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

interface AuthScreenProps {
  eyebrow: string;
  title: string;
  description: string;
  altPrompt: string;
  altHref: string;
  altLabel: string;
  children: ReactNode;
}

const providerLogos = [
  {
    src: "/assets/auth/google_logo.png",
    alt: "Google",
    label: "Google",
  },
  {
    src: "/assets/auth/discord_logo.webp",
    alt: "Discord",
    label: "Discord",
  },
  {
    src: "/assets/auth/apple_logo.png",
    alt: "Apple",
    label: "Apple",
  },
];

export default function AuthScreen({
  eyebrow,
  title,
  description,
  altPrompt,
  altHref,
  altLabel,
  children,
}: AuthScreenProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#18253c_0%,#08111f_48%,#04070d_100%)] text-zinc-100">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42vh] opacity-80">
        <Image
          src="/assets/login_screen/login_top.webp"
          alt=""
          fill
          priority
          className="object-cover object-top"
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[34vh] opacity-75">
        <Image
          src="/assets/login_screen/login_bottom.webp"
          alt=""
          fill
          priority
          className="object-cover object-bottom"
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(6,10,18,0.15),rgba(6,10,18,0.7)_40%,rgba(6,10,18,0.95))]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid w-full gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <section className="hidden lg:block">
            <div className="max-w-xl space-y-6">
              <div className="inline-flex items-center gap-3 rounded-full border border-cyan-400/20 bg-slate-950/45 px-4 py-2 text-[11px] uppercase tracking-[0.32em] text-cyan-200/80 backdrop-blur-md">
                <Image
                  src="/assets/common/world.webp"
                  alt=""
                  width={18}
                  height={18}
                  className="opacity-90"
                />
                Global Strategy Interface
              </div>

              <div className="space-y-4">
                <p className="font-display text-sm uppercase tracking-[0.42em] text-amber-300/85">
                  MapLord
                </p>
                <h1 className="font-display text-5xl leading-none tracking-[0.02em] text-zinc-50 xl:text-6xl">
                  Command the map.
                  <br />
                  Break the stalemate.
                </h1>
                <p className="max-w-lg text-lg leading-8 text-slate-300/88">
                  Wykorzystaj przygotowane prowincje, budynki i zdolnosci w
                  interfejsie, ktory wyglada jak panel dowodzenia, a nie zwykla
                  karta formularza.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 backdrop-blur-md">
                  <div className="flex items-center gap-3">
                    <Image
                      src="/assets/common/coin_w200.webp"
                      alt=""
                      width={24}
                      height={24}
                    />
                    <span className="text-xs uppercase tracking-[0.24em] text-slate-400">
                      Economy
                    </span>
                  </div>
                  <p className="mt-3 font-display text-2xl text-amber-200">
                    4X
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 backdrop-blur-md">
                  <div className="flex items-center gap-3">
                    <Image
                      src="/assets/icons/building_icon.webp"
                      alt=""
                      width={24}
                      height={24}
                    />
                    <span className="text-xs uppercase tracking-[0.24em] text-slate-400">
                      Control
                    </span>
                  </div>
                  <p className="mt-3 font-display text-2xl text-cyan-200">
                    RTS
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 backdrop-blur-md">
                  <div className="flex items-center gap-3">
                    <Image
                      src="/assets/ranks/10.webp"
                      alt=""
                      width={24}
                      height={24}
                    />
                    <span className="text-xs uppercase tracking-[0.24em] text-slate-400">
                      Ranked
                    </span>
                  </div>
                  <p className="mt-3 font-display text-2xl text-zinc-50">
                    PVP
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="mx-auto w-full max-w-lg">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/72 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(251,191,36,0.06),rgba(15,23,42,0.04))] px-6 py-6 sm:px-8">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-display text-xs uppercase tracking-[0.36em] text-cyan-200/80">
                      {eyebrow}
                    </p>
                    <h2 className="mt-2 font-display text-3xl leading-none text-zinc-50 sm:text-4xl">
                      {title}
                    </h2>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-3">
                    <Image
                      src="/assets/auth/plag_games_logo.png"
                      alt="MapLord insignia"
                      width={48}
                      height={48}
                      className="h-12 w-12 object-contain"
                    />
                  </div>
                </div>
                <p className="max-w-md text-sm leading-6 text-slate-300/82">
                  {description}
                </p>
              </div>

              <div className="space-y-6 px-6 py-6 sm:px-8 sm:py-8">
                {children}

                <div className="space-y-3 border-t border-white/10 pt-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-[0.28em] text-slate-500">
                      Identity providers
                    </span>
                    <span className="text-xs text-slate-500">w przygotowaniu</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {providerLogos.map((provider) => (
                      <div
                        key={provider.label}
                        className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300/80"
                      >
                        <Image
                          src={provider.src}
                          alt={provider.alt}
                          width={18}
                          height={18}
                          className="h-[18px] w-[18px] object-contain"
                        />
                        <span>{provider.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-center text-sm text-slate-400">
                  {altPrompt}{" "}
                  <Link
                    href={altHref}
                    className="font-medium text-amber-300 transition-colors hover:text-amber-200"
                  >
                    {altLabel}
                  </Link>
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
