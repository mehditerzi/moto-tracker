import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Trash2, Pencil, Plus, Camera, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchMakes, fetchModels } from "@/lib/catalog";
import { COLOR_OPTIONS, FUEL_OPTIONS, yearOptions } from "@/lib/vehicleOptions";
import {
  useBike,
  useCreateBike,
  useUpdateBike,
  useArchiveBike,
  useUploadBikePhoto,
  useDeleteBikePhoto,
} from "@/hooks/useBikes";
import { useDatedItemsForBike } from "@/hooks/useDatedItems";
import { useDocumentsForBike } from "@/hooks/useDocuments";
import { pushToast } from "@/hooks/useToast";
import { friendlyError, isVehicleLimitError } from "@/lib/apiError";
import { env } from "@/env";
import { useConfirm } from "@/components/ConfirmSheet";
import { PaywallSheet } from "@/components/PaywallSheet";

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
  const [paywall, setPaywall] = useState(false);

  const schema = z.object({
    vehicleType: z.enum(["motorcycle", "car"]).default("motorcycle"),
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
    fuelType: z.string().max(40).optional().or(z.literal("")),
    firstRegistrationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG")
      .optional()
      .or(z.literal("")),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nickname: "", vehicleType: "motorcycle" },
  });
  const vehicleType = (form.watch("vehicleType") ?? "motorcycle") as "motorcycle" | "car";

  useEffect(() => {
    if (isEdit && bike.data) {
      form.reset({
        vehicleType: bike.data.vehicleType ?? "motorcycle",
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
        fuelType: (bike.data as any).fuelType ?? "",
        firstRegistrationDate: (bike.data as any).firstRegistrationDate ?? "",
      });
    }
  }, [isEdit, bike.data, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const payload = {
      vehicleType: v.vehicleType,
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
      fuelType: v.fuelType || null,
      firstRegistrationDate: v.firstRegistrationDate || null,
    };
    try {
      if (isEdit && id) {
        await updateMut.mutateAsync(payload);
        pushToast({ variant: "success", title: t("bike.updated") });
        navigate("/bikes");
      } else {
        await createMut.mutateAsync(payload);
        pushToast({ variant: "success", title: t("bike.added") });
        // Adding a vehicle is manual entry only — don't force the user into the
        // scanner. OCR is initiated from the dashboard capture button and merges
        // into the active vehicle. (Previously navigated to /capture, which
        // auto-opened the camera right after saving.)
        navigate("/bikes");
      }
    } catch (e) {
      if (isVehicleLimitError(e)) {
        setPaywall(true);
        return;
      }
      pushToast({
        variant: "danger",
        title: t("items.saveFailed"),
        description: friendlyError(e, t),
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
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(e, t) });
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
      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} />
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? t("bike.editTitle") : t("bike.newTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isEdit && id && (
            <VehiclePhotoSection bikeId={id} photoUrl={bike.data?.photoUrl ?? null} />
          )}
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            {/* Vehicle type — scopes the make/model dropdowns below */}
            <Field label={t("bike.vehicleType")}>
              <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-surface-elev p-1 dark:bg-surface-elev-dark">
                {(["motorcycle", "car"] as const).map((vt) => (
                  <button
                    key={vt}
                    type="button"
                    onClick={() => {
                      if (form.getValues("vehicleType") === vt) return;
                      form.setValue("vehicleType", vt);
                      // Make/model are type-specific — clear them on a type switch.
                      form.setValue("make", "");
                      form.setValue("model", "");
                    }}
                    className={`rounded-xl py-2 text-[13px] font-medium transition ${
                      vehicleType === vt
                        ? "bg-surface shadow-card text-text dark:bg-surface-dark dark:text-text-dark"
                        : "text-muted dark:text-muted-dark"
                    }`}
                  >
                    {t(`bike.${vt}`)}
                  </button>
                ))}
              </div>
            </Field>
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
                <Controller
                  control={form.control}
                  name="make"
                  render={({ field }) => (
                    <Combobox
                      id="bike-make"
                      value={(field.value as string) ?? ""}
                      onChange={(v) => {
                        field.onChange(v);
                        // Changing make invalidates a previously chosen model.
                        if (form.getValues("model")) form.setValue("model", "");
                      }}
                      fetchOptions={(q) => fetchMakes(q, vehicleType)}
                      placeholder={vehicleType === "car" ? "Fiat" : "Ducati"}
                    />
                  )}
                />
              </Field>
              <Field label={t("bike.model")} hint={t("bike.optional")}>
                <Controller
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <Combobox
                      id="bike-model"
                      value={(field.value as string) ?? ""}
                      onChange={field.onChange}
                      fetchOptions={(q) => fetchModels(form.getValues("make") || "", q, vehicleType)}
                      placeholder={vehicleType === "car" ? "Egea" : "Monster 937"}
                      emptyText={form.getValues("make") ? undefined : t("bike.make")}
                    />
                  )}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("bike.year")} hint={t("bike.optional")}>
                <Controller
                  control={form.control}
                  name="year"
                  render={({ field }) => (
                    <Combobox
                      id="bike-year"
                      value={field.value != null ? String(field.value) : ""}
                      onChange={(v) => field.onChange(v === "" ? "" : Number(v))}
                      options={yearOptions()}
                      allowCustom={false}
                      placeholder="2023"
                    />
                  )}
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
              <Controller
                control={form.control}
                name="color"
                render={({ field }) => (
                  <Combobox
                    id="bike-color"
                    value={(field.value as string) ?? ""}
                    onChange={field.onChange}
                    options={COLOR_OPTIONS}
                    placeholder="Kırmızı"
                  />
                )}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("bike.fuelType")} hint={t("bike.optional")}>
                <Controller
                  control={form.control}
                  name="fuelType"
                  render={({ field }) => (
                    <Combobox
                      id="bike-fuel"
                      value={(field.value as string) ?? ""}
                      onChange={field.onChange}
                      options={FUEL_OPTIONS}
                      placeholder="Benzin"
                    />
                  )}
                />
              </Field>
              <Field
                label={t("bike.firstRegistrationDate")}
                hint={t("bike.optional")}
                error={form.formState.errors.firstRegistrationDate?.message}
              >
                <Input type="date" {...form.register("firstRegistrationDate")} />
              </Field>
            </div>
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
          {isEdit && id && <DocumentWalletSection bikeId={id} />}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function VehiclePhotoSection({ bikeId, photoUrl }: { bikeId: string; photoUrl: string | null }) {
  const { t } = useTranslation();
  const upload = useUploadBikePhoto(bikeId);
  const remove = useDeleteBikePhoto(bikeId);
  const inputRef = useRef<HTMLInputElement>(null);
  const src = photoUrl ? `${env.VITE_API_URL}${photoUrl}` : null;

  const pick = () => inputRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      await upload.mutateAsync(f);
    } catch (err) {
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: friendlyError(err, t) });
    }
  };

  return (
    <div className="mb-4">
      {src ? (
        <div className="relative overflow-hidden rounded-2xl border border-border dark:border-border-dark">
          <img src={src} alt={t("bike.photo")} className="block h-44 w-full object-cover" />
          <div className="absolute bottom-2 right-2 flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={pick} disabled={upload.isPending}>
              <Camera className="h-3.5 w-3.5" /> {t("bike.changePhoto")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-danger border-danger/40 hover:bg-danger/10"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              aria-label={t("bike.removePhoto")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          disabled={upload.isPending}
          className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-muted transition hover:border-text/30 hover:text-text dark:border-border-dark dark:text-muted-dark"
        >
          <Camera className="h-6 w-6" strokeWidth={1.6} />
          <span className="text-[13px] font-medium">
            {upload.isPending ? t("common.loading") : t("bike.addPhoto")}
          </span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </div>
  );
}

function DocumentWalletSection({ bikeId }: { bikeId: string }) {
  const { t } = useTranslation();
  const docs = useDocumentsForBike(bikeId);
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (!docs.data || docs.data.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 dark:border-border-dark">
      <span className="label-micro text-muted dark:text-muted-dark">{t("bike.scannedDocs")}</span>
      <div className="grid grid-cols-3 gap-2">
        {docs.data.map((d) => {
          const url = `${env.VITE_API_URL}/api/documents/${d.id}/file`;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setLightbox(url)}
              className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-border dark:border-border-dark"
            >
              <img src={url} alt="" className="h-full w-full object-cover" />
              {d.docType && (
                <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                  {d.docType}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            aria-label={t("review.close")}
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox}
            alt={t("bike.scannedDocs")}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
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
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <Link
                to={`/bikes/${bikeId}/dated-items/new?type=${type}`}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
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
