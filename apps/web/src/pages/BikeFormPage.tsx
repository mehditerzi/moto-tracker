import { useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Trash2, Pencil, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useBike, useCreateBike, useUpdateBike, useArchiveBike } from "@/hooks/useBikes";
import { useDatedItemsForBike } from "@/hooks/useDatedItems";
import { pushToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ConfirmSheet";

export function BikeFormPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const bike = useBike(id);
  const createMut = useCreateBike();
  const updateMut = useUpdateBike(id ?? "");
  const archiveMut = useArchiveBike();

  const schema = z.object({
    nickname: z.string().min(1, t("auth.nameRequired")).max(80),
    plate: z.string().max(20).optional().or(z.literal("")),
    make: z.string().max(60).optional().or(z.literal("")),
    model: z.string().max(60).optional().or(z.literal("")),
    year: z
      .union([z.coerce.number().int().min(1900).max(2100), z.literal("")])
      .optional(),
    currentKm: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
    color: z.string().max(40).optional().or(z.literal("")),
    chassisNo: z.string().max(30).optional().or(z.literal("")),
    engineNo: z.string().max(30).optional().or(z.literal("")),
    cylinderCc: z.union([z.coerce.number().int().min(0).max(10000), z.literal("")]).optional(),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nickname: "" },
  });

  useEffect(() => {
    if (isEdit && bike.data) {
      form.reset({
        nickname: bike.data.nickname,
        plate: bike.data.plate ?? "",
        make: bike.data.make ?? "",
        model: bike.data.model ?? "",
        year: bike.data.year ?? "",
        currentKm: bike.data.currentKm ?? "",
        color: bike.data.color ?? "",
        chassisNo: (bike.data as any).chassisNo ?? "",
        engineNo: (bike.data as any).engineNo ?? "",
        cylinderCc: (bike.data as any).cylinderCc ?? "",
      });
    }
  }, [isEdit, bike.data, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const payload = {
      nickname: v.nickname,
      plate: v.plate ? v.plate.toUpperCase().replace(/\s+/g, " ").trim() : null,
      make: v.make || null,
      model: v.model || null,
      year: typeof v.year === "number" ? v.year : null,
      currentKm: typeof v.currentKm === "number" ? v.currentKm : null,
      color: v.color || null,
      chassisNo: v.chassisNo || null,
      engineNo: v.engineNo || null,
      cylinderCc: typeof v.cylinderCc === "number" ? v.cylinderCc : null,
    };
    try {
      if (isEdit && id) {
        await updateMut.mutateAsync(payload);
        pushToast({ variant: "success", title: t("bike.updated") });
        navigate("/bikes");
      } else {
        const created = await createMut.mutateAsync(payload);
        pushToast({ variant: "success", title: t("bike.added") });
        navigate(`/capture?bikeId=${created.id}`);
      }
    } catch (e) {
      pushToast({
        variant: "danger",
        title: t("items.saveFailed"),
        description: String(e),
      });
    }
  });

  const onArchive = async () => {
    if (!id) return;
    const ok = await confirm({ title: t("bike.archiveConfirm"), confirmLabel: t("bike.archive"), destructive: true });
    if (!ok) return;
    try {
      await archiveMut.mutateAsync(id);
      navigate("/bikes");
    } catch (e) {
      pushToast({ variant: "danger", title: t("common.error"), description: (e as Error).message });
    }
  };

  if (isEdit && bike.isLoading && !bike.data) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-md"
      >
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-11" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-11" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-11" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-11" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-11" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-11" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-11" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-11" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-11" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-11" />
              </div>
              <div className="mt-2 flex gap-2">
                <Skeleton className="h-11 flex-1" />
                <Skeleton className="h-11 flex-1" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md"
    >
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? t("bike.editTitle") : t("bike.newTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Field label={t("bike.nickname")} error={form.formState.errors.nickname?.message}>
              <Input
                {...form.register("nickname")}
                placeholder="Monster"
                autoCapitalize="words"
              />
            </Field>
            <Field label={t("bike.plate")} hint={t("bike.optional")}>
              <Input
                {...form.register("plate")}
                placeholder="34 ABC 123"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="uppercase tracking-wider font-mono"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("bike.make")} hint={t("bike.optional")}>
                <Input {...form.register("make")} placeholder="Ducati" />
              </Field>
              <Field label={t("bike.model")} hint={t("bike.optional")}>
                <Input {...form.register("model")} placeholder="Monster 937" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("bike.year")} hint={t("bike.optional")}>
                <Input
                  type="number"
                  inputMode="numeric"
                  {...form.register("year")}
                  placeholder="2023"
                />
              </Field>
              <Field label={t("bike.currentKm")} hint={t("bike.optional")}>
                <Input
                  type="number"
                  inputMode="numeric"
                  {...form.register("currentKm")}
                  placeholder="12000"
                />
              </Field>
            </div>
            <Field label={t("bike.color")} hint={t("bike.optional")}>
              <Input {...form.register("color")} placeholder="Kırmızı" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("bike.chassisNo")} hint={t("bike.optional")}>
                <Input
                  {...form.register("chassisNo")}
                  placeholder="VF3..."
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="uppercase font-mono tracking-wide"
                />
              </Field>
              <Field label={t("bike.engineNo")} hint={t("bike.optional")}>
                <Input
                  {...form.register("engineNo")}
                  placeholder="ZD4..."
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="uppercase font-mono tracking-wide"
                />
              </Field>
            </div>
            <Field label={t("bike.cylinderCc")} hint={t("bike.optional")}>
              <Input
                type="number"
                inputMode="numeric"
                {...form.register("cylinderCc")}
                placeholder="937"
              />
            </Field>
            <div className="mt-2 flex gap-2">
              <Button asChild variant="ghost" className="flex-1">
                <Link to="/bikes">{t("common.cancel")}</Link>
              </Button>
              <Button type="submit" variant="accent" className="flex-1" disabled={createMut.isPending || updateMut.isPending}>
                {isEdit ? t("common.save") : t("dashboard.add")}
              </Button>
            </div>
            {isEdit && (
              <Button
                type="button"
                variant="outline"
                className="mt-1 text-danger border-danger/40 hover:bg-danger/10 hover:border-danger/60"
                onClick={onArchive}
                disabled={archiveMut.isPending}
              >
                <Trash2 className="h-4 w-4" /> {t("bike.archive")}
              </Button>
            )}
          </form>
          {isEdit && id && <BikeDocumentsSection bikeId={id} />}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function BikeDocumentsSection({ bikeId }: { bikeId: string }) {
  const { t } = useTranslation();
  const items = useDatedItemsForBike(bikeId);
  const TYPES = ["sigorta", "kasko", "muayene"] as const;

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 dark:border-border-dark">
      <div className="flex items-center justify-between">
        <span className="label-micro text-muted dark:text-muted-dark">{t("bike.documents")}</span>
      </div>
      {TYPES.map((type) => {
        const item = items.data?.find((i) => i.type === type);
        return (
          <div
            key={type}
            className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5 dark:border-border-dark"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium">{t(`items.${type}`)}</span>
              {item ? (
                <span className="num text-[11px] text-muted dark:text-muted-dark">
                  {item.expiresOn}
                </span>
              ) : (
                <span className="text-[11px] text-muted dark:text-muted-dark">
                  {t("items.addDate")}
                </span>
              )}
            </div>
            {item ? (
              <Link
                to={`/dated-items/${item.id}/edit`}
                className="rounded-lg p-1.5 text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <Link
                to={`/bikes/${bikeId}/dated-items/new?type=${type}`}
                className="rounded-lg p-1.5 text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
              >
                <Plus className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        {hint && (
          <span className="text-[10px] uppercase tracking-wider text-muted dark:text-muted-dark">
            {hint}
          </span>
        )}
      </div>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
