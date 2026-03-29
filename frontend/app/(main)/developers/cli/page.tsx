"use client";

import { ArrowLeft, Check, Copy, Monitor, Terminal } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

// -- Platform data ------------------------------------------------------------

type Platform = "linux" | "macos" | "windows";

interface PlatformInfo {
  label: string;
  icon: React.ReactNode;
  command: string;
  description: string;
}

const BASE_URL = typeof window !== "undefined" ? window.location.origin : "https://zelqor.pl";

const PLATFORMS: Record<Platform, PlatformInfo> = {
  linux: {
    label: "Linux / WSL",
    icon: <Terminal className="h-5 w-5" />,
    command: `curl -fsSL ${BASE_URL}/install.sh | bash`,
    description: "Bash, zsh lub dowolna powloka POSIX. Dziala tez w WSL.",
  },
  macos: {
    label: "macOS",
    icon: <Monitor className="h-5 w-5" />,
    command: `curl -fsSL ${BASE_URL}/install.sh | bash`,
    description: "Terminal.app lub iTerm2. Obsluguje Apple Silicon (M1/M2/M3) i Intel.",
  },
  windows: {
    label: "Windows",
    icon: <Monitor className="h-5 w-5" />,
    command: `irm ${BASE_URL}/install.ps1 | iex`,
    description: "PowerShell 5.1+ (wbudowany w Windows 10/11). Uruchom jako administrator.",
  },
};

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "linux";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  return "linux";
}

// -- Components ---------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
      title="Kopiuj"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function PlatformTab({
  platform,
  info,
  active,
  onClick,
}: {
  platform: Platform;
  info: PlatformInfo;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
        active ? "bg-white/10 text-white shadow-sm" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
    >
      {info.icon}
      {info.label}
    </button>
  );
}

// -- Page ---------------------------------------------------------------------

export default function CliInstallPage() {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const info = PLATFORMS[platform];

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8 md:py-12">
      {/* Back link */}
      <Link
        href="/developers"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Powrot do panelu developerskiego
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
            <Terminal className="h-6 w-6 text-cyan-300" />
          </div>
          <div>
            <h1 className="font-display text-2xl text-foreground md:text-3xl">Zainstaluj Zelqor CLI</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Jedno polecenie — gotowe w kilka sekund</p>
          </div>
        </div>
      </div>

      {/* Platform selector */}
      <div className="rounded-[24px] border border-white/10 bg-slate-950/55 backdrop-blur-xl">
        <div className="p-6 md:p-8">
          {/* Tabs */}
          <div className="flex gap-1 rounded-xl bg-white/[0.03] p-1">
            {(Object.entries(PLATFORMS) as [Platform, PlatformInfo][]).map(([key, pinfo]) => (
              <PlatformTab
                key={key}
                platform={key}
                info={pinfo}
                active={platform === key}
                onClick={() => setPlatform(key)}
              />
            ))}
          </div>

          {/* Install command */}
          <div className="mt-6">
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Wklej w terminalu</p>
            <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/40 p-4">
              <code className="flex-1 overflow-x-auto font-mono text-sm leading-6 text-emerald-300 md:text-base">
                {info.command}
              </code>
              <CopyButton text={info.command} />
            </div>
            <p className="mt-3 text-xs text-slate-500">{info.description}</p>
          </div>
        </div>
      </div>

      {/* After install */}
      <div className="rounded-[24px] border border-white/10 bg-slate-950/55 backdrop-blur-xl">
        <div className="p-6 md:p-8">
          <h2 className="font-display text-lg text-foreground">Po instalacji</h2>
          <div className="mt-4 space-y-3">
            <Step num={1} command="zelqor doctor" description="Sprawdz wymagania systemowe" />
            <Step num={2} command="zelqor login" description="Zaloguj sie do platformy" />
            <Step num={3} command="zelqor app create" description="Stworz aplikacje developerska" />
            <Step num={4} command="zelqor server create" description="Zarejestruj serwer" />
            <Step num={5} command="zelqor server start" description="Uruchom serwer" />
          </div>
        </div>
      </div>

      {/* Manual install */}
      <div className="rounded-[24px] border border-white/10 bg-slate-950/55 backdrop-blur-xl">
        <div className="p-6 md:p-8">
          <h2 className="font-display text-lg text-foreground">Reczna instalacja</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Jesli wolisz zainstalowac recznie, pobierz binarkę ze{" "}
            <a
              href="https://github.com/qwizi/zelqor/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
            >
              strony releases
            </a>{" "}
            i umiesc ja w katalogu dostepnym w PATH.
          </p>

          <div className="mt-4">
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">Lub zbuduj ze zrodel</p>
            <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/40 p-4">
              <code className="flex-1 overflow-x-auto font-mono text-sm leading-6 text-slate-300">
                cargo install --git https://github.com/qwizi/zelqor.git --bin zelqor zelqor-cli
              </code>
              <CopyButton text="cargo install --git https://github.com/qwizi/zelqor.git --bin zelqor zelqor-cli" />
            </div>
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-3">
        <Link href="/developers/docs">
          <Button variant="outline" className="gap-2 rounded-xl">
            Dokumentacja API
          </Button>
        </Link>
        <a href="https://github.com/qwizi/zelqor" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" className="gap-2 rounded-xl">
            GitHub
          </Button>
        </a>
      </div>
    </div>
  );
}

// -- Step component -----------------------------------------------------------

function Step({ num, command, description }: { num: number; command: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-bold text-slate-400">
        {num}
      </div>
      <div className="min-w-0">
        <code className="font-mono text-sm text-cyan-300">{command}</code>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
    </div>
  );
}
