"use client";

import Link from "next/link";
import { Globe } from "lucide-react";
import type { ReactNode } from "react";

interface AuthScreenProps {
  eyebrow: string;
  title: string;
  description?: string;
  altPrompt?: string;
  altHref?: string;
  altLabel?: string;
  children: ReactNode;
}

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
    <div className="flex min-h-screen flex-col items-center justify-start md:justify-center bg-background px-4 py-6 md:py-12 relative overflow-hidden">
      {/* Background decorations — desktop only */}
      <div className="hidden md:block absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[radial-gradient(ellipse,rgba(34,211,238,0.06),transparent_70%)]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(251,191,36,0.04),transparent_70%)]" />
      </div>

      <div className="relative w-full max-w-md md:max-w-lg lg:max-w-xl space-y-6 md:space-y-8">
        {/* Logo */}
        <div className="flex items-center gap-3 md:justify-center">
          <div className="flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl border border-border bg-secondary">
            <Globe size={20} className="text-primary md:hidden" />
            <Globe size={24} className="text-primary hidden md:block" />
          </div>
          <span className="font-display text-xl md:text-3xl font-bold uppercase tracking-[0.15em] md:tracking-[0.2em] text-foreground">
            MAPLORD
          </span>
        </div>

        {/* Card */}
        <div className="md:rounded-2xl md:border md:border-border md:bg-card/80 md:backdrop-blur-xl md:shadow-xl md:shadow-black/10">
          <div className="space-y-6 md:p-10 lg:p-12">
            <div>
              <p className="text-[11px] md:text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                {eyebrow}
              </p>
              <h1 className="mt-2 font-display text-3xl md:text-4xl text-foreground leading-tight">
                {title}
              </h1>
              {description && (
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {description}
                </p>
              )}
            </div>
            {children}
          </div>
        </div>

        {/* Alt link */}
        {altPrompt && altHref && (
          <p className="text-center text-sm text-muted-foreground">
            {altPrompt}{" "}
            <Link
              href={altHref}
              className="font-bold text-primary hover:text-primary/80 transition-colors"
            >
              {altLabel}
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
