import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link, Navigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Trash2, Pencil, Plus, Camera, X, ChevronDown, Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
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
import { ApiError } from "@/lib/api";
import { env } from "@/env";
import { useConfirm } from "@/components/ConfirmSheet";
import { ErrorState } from "@/components/ErrorState";
import { PaywallSheet } from "@/components/PaywallSheet";
import type { OrgMembership } from "@/hooks/useOrgs";
import { deniedRedirect, useVehicleTarget } from "@/pages/fleet/vehicleTarget";
import { ensureFleetLocale } from "@/lib/fleetLocale";

/** The ruhsat-only fields hidden behind the "registration details" disclosure. */
const DETAIL_FIELDS = [
  "color",
  "fuelType",
  "firstRegistrationDate",
  "chassisNo",
  "engineNo",
  "cylinderCc",
] as const;

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
  const [orgLimit, setOrgLimit] = useState(false);
  const [searchParams] = useSearchParams();

  /**
   * WHICH GARAGE. The fleet inventory links here as `/bikes/new?orgId=…`.
   *
   * A query parameter rather than navigation state because this is the one
   * piece of context that must survive a reload, a shared link and the back
   * button: state is dropped on refresh, and a form that silently forgot it was
   * a company vehicle would file the van in the manager's personal garage —
   * where the organization can neither see nor delete it. A route param was not
   * available (routes.tsx is owned elsewhere) and would have meant a second
   * URL for the same screen anyway.
   *
   * Read only when CREATING. Editing ignores it completely: `bikeUpdateSchema`
   * omits `orgId` and PATCH drops it, because moving a vehicle between garages
   * changes both who can see it and which subscription pays for it.
   */
  const targetOrgId = isEdit ? null : searchParams.get("orgId");
  const target = useVehicleTarget(targetOrgId);
  const org = target.kind === "org" ? target.org : null;

  // The manager-facing vocabulary is lazy (lib/fleetLocale.ts) so a consumer
  // never downloads it. Nothing org-shaped renders until it has arrived — the
  // banner below is a "this is not your garage" warning and must not appear as
  // a raw key path.
  const [fleetStrings, setFleetStrings] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [localeAttempt, setLocaleAttempt] = useState(0);
  useEffect(() => {
    if (!targetOrgId) return;
    let alive = true;
    setFleetStrings("loading");
    ensureFleetLocale().then(
      () => alive && setFleetStrings("ready"),
      () => alive && setFleetStrings("error"),
    );
    return () => {
      alive = false;
    };
    // `localeAttempt` is the retry: fleetLocale clears its memo on failure, so
    // re-running this actually re-fetches the chunk.
  }, [targetOrgId, localeAttempt]);

  const schema = z.object({
    vehicleType: z.enum(["motorcycle", "car"]).default("motorcycle"),
    // Was borrowed from the auth screen ("Ad gerekli" — "Name required"), which
    // reads as if the form wants the owner's name, not the vehicle's.
    nickname: z.string().min(1, t("bike.nicknameRequired")).max(80),
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

  // Whether the collapsed ruhsat group already holds data. Safe to read at the
  // disclosure's mount because the edit path renders the skeleton until
  // `bike.data` has arrived.
  const hasDetailValues =
    isEdit &&
    !!bike.data &&
    DETAIL_FIELDS.some((k) => {
      const v = (bike.data as Record<string, unknown>)[k];
      return v !== null && v !== undefined && v !== "";
    });

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
    setOrgLimit(false);
    try {
      if (isEdit && id) {
        await updateMut.mutateAsync(payload);
        pushToast({ variant: "success", title: t("bike.updated") });
        navigate("/bikes");
      } else if (org) {
        await createMut.mutateAsync({ ...payload, orgId: org.orgId });
        pushToast({ variant: "success", title: t("fleet.newVehicle.added", { org: org.name }) });
        navigate("/fleet/vehicles");
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
        // One machine code, two ceilings. A personal vehicle hit the consumer
        // entitlement, and the paywall is the honest next step. An ORG vehicle
        // hit `organization.max_vehicles`, which is sold offline: there is no
        // price to show and no purchase to offer (docs/fleet-design.md §1), so
        // say what happened and who can raise it — never the paywall.
        if (org) setOrgLimit(true);
        else setPaywall(true);
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
    // "Archive" doesn't say what it costs you. Spelling out that the history
    // survives is the difference between a confident tap and an abandoned one.
    const ok = await confirm({
      title: t("bike.archiveConfirm"),
      message: t("bike.archiveConfirmBody"),
      confirmLabel: t("bike.archive"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await archiveMut.mutateAsync(id);
      navigate("/bikes");
    } catch (e) {
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(e, t) });
    }
  };

  // A garage this user may not add to — a staff member or a driver who followed
  // a link, or a stranger who typed an org id. The server answers 403/404; the
  // client simply never shows the form, and sends them somewhere ordinary
  // rather than to a page that implies a locked door.
  if (target.kind === "denied") return <Navigate to={deniedRedirect(target.role)} replace />;

  // The org's name and the "this is a company vehicle" note are the whole point
  // of this screen; a failed chunk fetch must not degrade into a form that
  // looks personal. Retrying re-imports (fleetLocale clears its memo on error).
  if (targetOrgId && fleetStrings === "error") {
    return (
      <ErrorState onRetry={() => setLocaleAttempt((n) => n + 1)}>
        <Button asChild variant="ghost" className="text-muted dark:text-muted-dark">
          <Link to="/fleet/vehicles">{t("common.cancel")}</Link>
        </Button>
      </ErrorState>
    );
  }

  // Waiting on membership or on the fleet vocabulary. Same treatment as the
  // edit path's load: the form's shape, never a half-labelled form.
  if (target.kind === "pending" || (targetOrgId && fleetStrings !== "ready")) {
    return <FormSkeleton />;
  }

  if (isEdit && bike.isLoading && !bike.data) return <FormSkeleton />;

  // An archived or deleted vehicle reached from a stale link used to fall
  // straight through to a blank form, and saving it PATCHed an id that no longer
  // exists — a guaranteed error with no explanation. A 404 gets no retry button:
  // the record is gone, and the only useful move is back to the garage.
  if (isEdit && !bike.data) {
    const gone = bike.error instanceof ApiError && bike.error.status === 404;
    return (
      <ErrorState
        onRetry={gone ? undefined : () => void bike.refetch()}
        title={gone ? t("common.notFound") : undefined}
        description={gone ? t("errors.bike_not_found") : undefined}
      >
        <Button asChild variant={gone ? "accent" : "ghost"} className={gone ? "" : "text-muted dark:text-muted-dark"}>
          <Link to="/bikes">{t("dashboard.manageBikes")}</Link>
        </Button>
      </ErrorState>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md"
    >
      {/* Not mounted at all in an org context: the fleet UI contains no
          acquisition affordance anywhere (docs/fleet-design.md §1). */}
      {!org && <PaywallSheet open={paywall} onClose={() => setPaywall(false)} />}
      <Card>
        <CardHeader>
          <CardTitle>
            {isEdit ? t("bike.editTitle") : org ? t("fleet.newVehicle.title") : t("bike.newTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {org && <OrgGarageBanner org={org} />}
          {isEdit && id && (
            <VehiclePhotoSection bikeId={id} photoUrl={bike.data?.photoUrl ?? null} />
          )}
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            {/* Vehicle type — scopes the make/model dropdowns below. A segmented
                control rather than a labelled input, so it gets a named radio
                group instead of a <Field>: nothing here can own a label's `for`. */}
            <div className="flex flex-col gap-1.5">
              <Label id="vehicleType-label">{t("bike.vehicleType")}</Label>
              <div
                role="radiogroup"
                aria-labelledby="vehicleType-label"
                className="grid grid-cols-2 gap-1.5 rounded-2xl bg-surface-elev p-1 dark:bg-surface-elev-dark"
              >
                {(["motorcycle", "car"] as const).map((vt) => (
                  <button
                    key={vt}
                    type="button"
                    role="radio"
                    aria-checked={vehicleType === vt}
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
            </div>
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
                      value={(field.value as string) ?? ""}
                      onChange={field.onChange}
                      fetchOptions={(q) => fetchModels(form.getValues("make") || "", q, vehicleType)}
                      placeholder={vehicleType === "car" ? "Egea" : "Monster 937"}
                      // Used to render the bare word "Marka" in the dropdown,
                      // which reads as an option rather than an instruction.
                      emptyText={form.getValues("make") ? undefined : t("bike.selectMakeFirst")}
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
            {/* Everything below is copied off the ruhsat and is exactly what the
                scanner fills in for you. Someone typing a vehicle in by hand
                almost never has the paperwork open, so eleven always-visible
                optional fields read as eleven chores. Collapsed by default —
                but expanded on sight if the record already carries any of them,
                so nothing a user (or a scan) already saved is hidden from them. */}
            <DetailsDisclosure
              defaultOpen={hasDetailValues}
              summary={t("bike.moreDetails")}
              hint={t("bike.moreDetailsSub")}
            >
              <Field label={t("bike.color")} hint={t("bike.optional")}>
                <Controller
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <Combobox
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
            </DetailsDisclosure>
            {/* The org's ceiling, refused by the API. No price, no plan, no
                link out — an organization's allowance is agreed in its contract
                and raised by the operator, exactly as /fleet/import says when a
                CSV would overflow it. */}
            {orgLimit && org && (
              <p
                role="alert"
                className="rounded-xl border border-warning/40 bg-warning/5 px-3.5 py-3 text-[13px] text-warning"
              >
                {t("fleet.newVehicle.limitReached", { org: org.name })}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Button asChild variant="ghost" className="flex-1">
                <Link to={org ? "/fleet/vehicles" : "/bikes"}>{t("common.cancel")}</Link>
              </Button>
              <Button
                type="submit"
                variant="accent"
                className="min-w-0 flex-1"
                disabled={createMut.isPending || updateMut.isPending}
              >
                {/* The commit names the garage: this is the last moment before a
                    company van could land in someone's personal garage. */}
                <span className="truncate">
                  {isEdit
                    ? t("common.save")
                    : org
                      ? t("fleet.newVehicle.submit", { org: org.name })
                      : t("dashboard.add")}
                </span>
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

/**
 * The form's shape while something it needs is still in flight: the vehicle
 * being edited, or — on the fleet path — the membership and the org vocabulary
 * that name the garage this vehicle is going into.
 */
function FormSkeleton() {
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

/**
 * Collapsible field group. A real button with aria-expanded/aria-controls rather
 * than <details>, so the chevron, focus ring and type scale match the rest of
 * the form.
 *
 * The panel is hidden with `display:none` rather than unmounted: these are
 * registered react-hook-form inputs, and keeping them mounted means a value the
 * user typed (or a scan wrote) cannot be affected by collapsing the group. It
 * also keeps the collapsed fields out of the tab order and the a11y tree, which
 * an opacity/height transition would not.
 */
function DetailsDisclosure({
  defaultOpen,
  summary,
  hint,
  children,
}: {
  defaultOpen: boolean;
  summary: string;
  hint: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="rounded-2xl border border-border dark:border-border-dark">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl px-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] font-medium">{summary}</span>
          <span className="truncate text-[12px] text-muted dark:text-muted-dark">{hint}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted transition-transform dark:text-muted-dark ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {/* The layout classes are applied only while open: a `flex` utility would
          out-specify preflight's `[hidden] { display: none }` and leave the
          collapsed panel visible. */}
      <div
        id={panelId}
        hidden={!open}
        className={open ? "flex flex-col gap-3 px-3.5 pb-3.5 pt-1" : undefined}
      >
        {children}
      </div>
    </div>
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

/**
 * Which garage this vehicle is being filed in — the one thing on the screen a
 * fleet manager must not be able to miss.
 *
 * An org vehicle is visible to the whole fleet and counts against the
 * organization's allowance; a personal one is invisible to the organization,
 * which means a company van created by mistake in a member's own garage is data
 * the operator can neither see nor delete. So the target is stated in words,
 * not implied by the route, and repeated on the submit button.
 *
 * There is no picker: the target comes from where the manager tapped "add
 * vehicle" (the fleet inventory), and offering a choice here would invite
 * exactly the mistake this banner exists to prevent.
 */
function OrgGarageBanner({ org }: { org: OrgMembership }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-border bg-surface-elev px-3.5 py-3 dark:border-border-dark dark:bg-surface-elev-dark">
      <Building2
        className="mt-0.5 h-5 w-5 shrink-0 text-muted dark:text-muted-dark"
        strokeWidth={1.8}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="label-micro text-muted dark:text-muted-dark">
          {t("fleet.newVehicle.garageLabel")}
        </p>
        <p className="mt-0.5 break-words text-[15px] font-semibold">{org.name}</p>
        <p className="mt-1 text-[12px] leading-snug text-muted dark:text-muted-dark">
          {t("fleet.newVehicle.garageNote")}
        </p>
      </div>
    </div>
  );
}
