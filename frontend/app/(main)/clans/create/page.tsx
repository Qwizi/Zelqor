"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Coins, Loader2, Shield, Palette, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useMyClan, useCreateClan } from "@/hooks/queries";
import { APIError } from "@/lib/api";

const clanSchema = z.object({
  name: z.string().min(3, "Min. 3 znaki").max(32, "Max. 32 znaki"),
  tag: z
    .string()
    .min(2, "Min. 2 znaki")
    .max(5, "Max. 5 znaków")
    .regex(/^[A-Za-z0-9]+$/, "Tylko litery i cyfry"),
  description: z.string().max(500, "Max. 500 znaków").optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Nieprawidłowy kolor HEX"),
  is_public: z.boolean(),
});

type ClanFormData = z.infer<typeof clanSchema>;

export default function CreateClanPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: myClanData, isLoading: myClanLoading } = useMyClan();
  const createMut = useCreateClan();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ClanFormData>({
    resolver: zodResolver(clanSchema),
    defaultValues: {
      name: "",
      tag: "",
      description: "",
      color: "#3B82F6",
      is_public: true,
    },
  });

  const watchColor = watch("color");
  const watchTag = watch("tag");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!myClanLoading && myClanData?.clan) {
      router.replace(`/clans/${myClanData.clan.id}`);
    }
  }, [myClanLoading, myClanData, router]);

  const onSubmit = async (data: ClanFormData) => {
    try {
      const clan = await createMut.mutateAsync({
        ...data,
        tag: data.tag.toUpperCase(),
      });
      toast.success("Klan utworzony!", { id: "clan-create" });
      router.push(`/clans/${clan.id}`);
    } catch (err) {
      if (err instanceof APIError) {
        toast.error(err.message, { id: "clan-create-error" });
      } else {
        toast.error("Nie udało się utworzyć klanu", { id: "clan-create-error" });
      }
    }
  };

  if (authLoading || myClanLoading) return null;

  return (
    <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Header */}
      <div className="px-4 md:px-0">
        <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">KLANY</p>
        <h1 className="font-display text-2xl md:text-5xl text-foreground">Utwórz klan</h1>
        <p className="hidden md:block mt-1 text-sm text-muted-foreground">
          Nadaj nazwę, wybierz tag i kolor dla swojego klanu.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 md:space-y-6">
        {/* Preview + cost */}
        <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
              Podgląd klanu
            </p>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
            <div
              className="flex h-20 w-20 items-center justify-center rounded-2xl font-display text-2xl font-bold text-white shadow-lg transition-colors shrink-0"
              style={{ backgroundColor: watchColor || "#3B82F6" }}
            >
              {(watchTag || "TAG").toUpperCase().slice(0, 5)}
            </div>
            <div className="text-center md:text-left">
              <p className="text-lg font-display text-foreground">
                <span style={{ color: watchColor || "#3B82F6" }}>[{(watchTag || "TAG").toUpperCase().slice(0, 5)}]</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">Tak będzie wyglądał tag Twojego klanu</p>
            </div>
            <div className="md:ml-auto flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
              <Coins className="h-4 w-4 text-accent shrink-0" />
              <p className="text-sm text-muted-foreground">
                Koszt: <span className="font-semibold text-accent">500 złota</span>
              </p>
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
            <div className="grid md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label htmlFor="name">Nazwa klanu</Label>
                <Input id="name" placeholder="Nazwa" {...register("name")} className="h-10 md:h-12 md:text-base" />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="tag">Tag (2-5 znaków)</Label>
                <Input id="tag" placeholder="TAG" maxLength={5} {...register("tag")} className="h-10 md:h-12 md:text-base uppercase" />
                {errors.tag && <p className="text-xs text-destructive">{errors.tag.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Opis</Label>
              <textarea
                id="description"
                placeholder="Opis klanu (opcjonalnie)"
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm md:text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register("description")}
              />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>

            <div className="flex items-center gap-3">
              <input type="checkbox" id="is_public" {...register("is_public")} className="h-4 w-4 rounded border-input" />
              <Label htmlFor="is_public" className="cursor-pointer text-sm">Klan publiczny (każdy może dołączyć)</Label>
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
                value={watchColor || "#3B82F6"}
                onChange={(e) => setValue("color", e.target.value, { shouldValidate: true })}
                className="h-12 w-16 cursor-pointer rounded-lg border border-input bg-transparent p-1"
              />
              <Input
                {...register("color")}
                placeholder="#3B82F6"
                className="flex-1 font-mono text-sm h-10 md:h-12 max-w-[200px]"
                onChange={(e) => setValue("color", e.target.value, { shouldValidate: true })}
              />
              <div className="hidden md:flex gap-2">
                {["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setValue("color", c, { shouldValidate: true })}
                    className="h-8 w-8 rounded-lg border-2 transition-all hover:scale-110"
                    style={{ backgroundColor: c, borderColor: watchColor === c ? "white" : "transparent" }}
                  />
                ))}
              </div>
            </div>
            {errors.color && <p className="text-xs text-destructive">{errors.color.message}</p>}
          </div>
        </section>

        {/* Submit */}
        <div className="mx-4 md:mx-0">
          <Button type="submit" className="w-full md:w-auto h-10 md:h-12 md:text-base md:px-12 gap-2" disabled={createMut.isPending}>
            {createMut.isPending && <Loader2 size={18} className="animate-spin" />}
            {createMut.isPending ? "Tworzenie..." : "Utwórz klan"}
          </Button>
        </div>
      </form>
    </div>
  );
}
