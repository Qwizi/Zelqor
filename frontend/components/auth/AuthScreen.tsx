"use client";

import Link from "next/link";
import { Globe } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="flex min-h-screen bg-background">
      {/* Left half — branding */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center border-r border-border">
        <div className="space-y-8 text-center">
          <div className="flex items-center justify-center gap-5">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-border bg-secondary">
              <Globe size={48} className="text-muted-foreground" />
            </div>
          </div>
          <h2 className="font-display text-7xl font-bold uppercase tracking-[0.2em] text-foreground">
            MAPLORD
          </h2>
          <p className="text-2xl text-muted-foreground max-w-md mx-auto">
            Strategia w czasie rzeczywistym na mapie świata
          </p>
        </div>
      </div>

      {/* Right half — form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center px-6 py-12">
        <div className="w-full space-y-10 px-8">
          {/* Mobile logo */}
          <div className="flex items-center justify-center gap-4 lg:hidden">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary">
              <Globe size={28} className="text-muted-foreground" />
            </div>
            <span className="font-display text-4xl font-bold uppercase tracking-[0.18em] text-foreground">
              MAPLORD
            </span>
          </div>

          {/* Card */}
          <Card className="rounded-3xl">
            <CardContent className="space-y-10 p-10 sm:p-14">
              <div>
                <p className="text-lg font-bold uppercase tracking-[0.25em] text-muted-foreground">
                  {eyebrow}
                </p>
                <h1 className="mt-4 font-display text-5xl text-foreground leading-tight">
                  {title}
                </h1>
                {description && (
                  <p className="mt-4 text-xl leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
              {children}
            </CardContent>
          </Card>

          {/* Alt link */}
          {altPrompt && altHref && (
            <p className="text-center text-xl text-muted-foreground">
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
    </div>
  );
}
