"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, Palette, Settings2, Coins } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useClan, useUpdateClan } from "@/hooks/queries";
import { APIError } from "@/lib/api";

const settingsSchema = z.object({
  name: z.string().min(3, "Min. 3 znaki").max(32, "Max. 32 znaki"),
  description: z.string().max(500, "Max. 500 znaków"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Nieprawidłowy kolor HEX"),
  is_recruiting: z.boolean(),
  is_public: z.boolean(),
  tax_percent: z.number().min(0).max(50),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export default function ClanSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const clanId = params.clanId as string;

  const { data: clan, isLoading } = useClan(clanId);
  const updateMut = useUpdateClan();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
  });

  const watchColor = watch("color");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (clan) {
      const myRole = clan.my_membership?.role;
      if (!myRole || (myRole !== "leader" && myRole !== "officer")) {
        router.replace(`/clans/${clanId}`);
        return;
      }
      reset({
        name: clan.name,
        description: clan.description,
        color: clan.color,
        is_recruiting: clan.is_recruiting,
        is_public: clan.is_public,
        tax_percent: Number(clan.tax_percent),
      });
    }
  }, [clan, clanId, router, reset]);

  const onSubmit = async (data: SettingsFormData) => {
    try {
      await updateMut.mutateAsync({ clanId, data });
      toast.success("Ustawienia zapisane", { id: "clan-settings-save" });
      router.push(`/clans/${clanId}`);
    } catch (err) {
      if (err instanceof APIError) {
        toast.error(err.message, { id: "clan-settings-error" });
      } else {
        toast.error("Nie udało się zapisać ustawień", { id: "clan-settings-error" });
      }
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
        <div className="px-4 md:px-0">
          <Skeleton className="h-6 w-24 mb-2" />
          <Skeleton className="h-10 w-64" />
        </div>
        <div className="mx-4 md:mx-0">
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!clan) {
    return <p className="py-12 text-center text-muted-foreground">Klan nie znaleziony.</p>;
  }

  return (
    <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 md:px-0">
        <Link
          href={`/clans/${clanId}`}
          className="inline-flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground transition-all hover:text-foreground hover:bg-muted active:scale-[0.95] shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">USTAWIENIA KLANU</p>
          <h1 className="font-display text-2xl md:text-5xl text-foreground truncate">[{clan.tag}] {clan.name}</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 md:space-y-6">
        {/* Preview */}
        <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
          <div className="flex items-center gap-4">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl font-display text-xl font-bold text-white shadow-lg transition-colors shrink-0"
              style={{ backgroundColor: watchColor || clan.color }}
            >
              {clan.tag}
            </div>
            <div>
              <p className="text-lg font-display text-foreground">
                <span style={{ color: watchColor || clan.color }}>[{clan.tag}]</span> {watch("name") || clan.name}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Level {clan.level} &middot; ELO {clan.elo_rating}</p>
            </div>
          </div>
        </section>

        {/* Basic info */}
        <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary">
              <Settings2 className="h-4 w-4 text-primary" />
            </div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
              Informacje
            </p>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Nazwa klanu</Label>
              <Input id="name" {...register("name")} className="h-10 md:h-12 md:text-base" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Opis</Label>
              <textarea
                id="description"
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm md:text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register("description")}
              />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <input type="checkbox" id="is_recruiting" {...register("is_recruiting")} className="h-4 w-4 rounded border-input" />
                <Label htmlFor="is_recruiting" className="cursor-pointer text-sm">Rekrutacja otwarta</Label>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="is_public" {...register("is_public")} className="h-4 w-4 rounded border-input" />
                <Label htmlFor="is_public" className="cursor-pointer text-sm">Klan publiczny (każdy może dołączyć bez akceptacji)</Label>
              </div>
            </div>
          </div>
        </section>

        {/* Color */}
        <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary">
              <Palette className="h-4 w-4 text-primary" />
            </div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
              Kolor
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="color">Kolor klanu</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                id="color"
                value={watchColor || clan.color}
                onChange={(e) => setValue("color", e.target.value, { shouldValidate: true, shouldDirty: true })}
                className="h-12 w-16 cursor-pointer rounded-lg border border-input bg-transparent p-1"
              />
              <Input
                {...register("color")}
                placeholder="#FF5500"
                className="flex-1 font-mono text-sm h-10 md:h-12 max-w-[200px]"
                onChange={(e) => setValue("color", e.target.value, { shouldValidate: true, shouldDirty: true })}
              />
              <div className="hidden md:flex gap-2">
                {["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setValue("color", c, { shouldValidate: true, shouldDirty: true })}
                    className="h-8 w-8 rounded-lg border-2 transition-all hover:scale-110"
                    style={{ backgroundColor: c, borderColor: watchColor === c ? "white" : "transparent" }}
                  />
                ))}
              </div>
            </div>
            {errors.color && <p className="text-xs text-destructive">{errors.color.message}</p>}
          </div>
        </section>

        {/* Treasury */}
        <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary">
              <Coins className="h-4 w-4 text-accent" />
            </div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
              Skarbiec
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tax_percent">Podatek od transakcji (%)</Label>
            <Input id="tax_percent" type="number" step="0.1" min="0" max="50" {...register("tax_percent", { valueAsNumber: true })} className="h-10 md:h-12 md:text-base w-32" />
            {errors.tax_percent && <p className="text-xs text-destructive">{errors.tax_percent.message}</p>}
            <p className="text-xs text-muted-foreground">Procent od transakcji członków trafia do skarbca (0-50%)</p>
          </div>
        </section>

        {/* Submit */}
        <div className="mx-4 md:mx-0">
          <Button
            type="submit"
            className="w-full md:w-auto h-10 md:h-12 md:text-base md:px-12 gap-2"
            disabled={!isDirty || updateMut.isPending}
          >
            {updateMut.isPending && <Loader2 size={18} className="animate-spin" />}
            {updateMut.isPending ? "Zapisywanie..." : "Zapisz ustawienia"}
          </Button>
        </div>
      </form>
    </div>
  );
}
