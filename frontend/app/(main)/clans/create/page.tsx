"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
      toast.success("Klan utworzony!");
      router.push(`/clans/${clan.id}`);
    } catch (err) {
      if (err instanceof APIError) {
        toast.error(err.message);
      } else {
        toast.error("Nie udało się utworzyć klanu");
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
          Nadaj nazwę, wybierz tag i kolor.
        </p>
      </div>

      <div className="px-4 md:px-0 max-w-lg">
        <Card className="rounded-2xl">
          <CardContent className="p-5 md:p-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Preview */}
              <div className="flex items-center justify-center pb-2">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-xl font-display text-xl font-bold text-white transition-colors"
                  style={{ backgroundColor: watchColor || "#3B82F6" }}
                >
                  {(watchTag || "TAG").toUpperCase().slice(0, 5)}
                </div>
              </div>

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

              <div className="space-y-2">
                <Label htmlFor="color">Kolor klanu</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    id="color"
                    {...register("color")}
                    className="h-10 w-14 cursor-pointer rounded border border-input bg-transparent"
                  />
                  <Input {...register("color")} placeholder="#3B82F6" className="flex-1 font-mono text-sm h-10" />
                </div>
                {errors.color && <p className="text-xs text-destructive">{errors.color.message}</p>}
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" id="is_public" {...register("is_public")} className="h-4 w-4 rounded border-input" />
                <Label htmlFor="is_public" className="cursor-pointer text-sm">Klan publiczny (każdy może dołączyć)</Label>
              </div>

              <Button type="submit" className="w-full h-10 md:h-12 md:text-base gap-2" disabled={createMut.isPending}>
                {createMut.isPending && <Loader2 size={18} className="animate-spin" />}
                {createMut.isPending ? "Tworzenie..." : "Utwórz klan"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
