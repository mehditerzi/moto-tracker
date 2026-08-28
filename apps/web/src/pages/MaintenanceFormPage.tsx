import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import {
  useCreateMaintenance,
  useDeleteMaintenance,
  useMaintenanceItem,
  useUpdateMaintenance,
} from "@/hooks/useMaintenanceItems";
import { useConfirm } from "@/components/ConfirmSheet";

const KINDS = ["engine_oil", "brakes", "tires", "battery", "coolant", "air_filter", "chain", "custom"] as const;

const schema = z.object({
  kind: z.enum(KINDS),
  customLabel: z.string().max(120).optional().or(z.literal("")),
  lastDoneOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG").optional().or(z.literal("")),
  lastDoneKm: z.union([z.coerce.number().int().nonnegative(), z.literal("")]).optional(),
  intervalMonths: z.union([z.coerce.number().int().positive(), z.literal("")]).optional(),
  intervalKm: z.union([z.coerce.number().int().positive(), z.literal("")]).optional(),
  // Money, so not an integer — and never negative. The empty literal is listed
  // FIRST on purpose: `z.coerce.number()` turns "" into 0, so with the usual
  // ordering a blank box would submit a cost of ₺0 and claim a free service job
  // instead of leaving the cost unrecorded.
  cost: z.union([z.literal(""), z.coerce.number().nonnegative()]).optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  mode: "new" | "edit";
}

export function MaintenanceFormPage({ mode }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const params = useParams();
  const navigate = useNavigate();
  const bikeId = params.bikeId!;
  const itemId = mode === "edit" ? params.id : undefined;

  const item = useMaintenanceItem(itemId);
  const createMut = useCreateMaintenance(bikeId);
  const updateMut = useUpdateMaintenance(itemId ?? "");
  const deleteMut = useDeleteMaintenance();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { kind: "engine_oil" },
  });
  const kind = form.watch("kind");

  useEffect(() => {
    if (mode === "edit" && item.data) {
      form.reset({
        kind: item.data.kind,
        customLabel: item.data.customLabel ?? "",
        lastDoneOn: item.data.lastDoneOn ?? "",
        lastDoneKm: item.data.lastDoneKm ?? "",
        intervalMonths: item.data.intervalMonths ?? "",
        intervalKm: item.data.intervalKm ?? "",
        cost: item.data.cost ?? "",
        notes: item.data.notes ?? "",
      });
    }
  }, [mode, item.data, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const payload = {
      kind: v.kind,
      customLabel: v.customLabel || null,
      lastDoneOn: v.lastDoneOn || null,
      lastDoneKm: typeof v.lastDoneKm === "number" ? v.lastDoneKm : null,
      intervalMonths: typeof v.intervalMonths === "number" ? v.intervalMonths : null,
      intervalKm: typeof v.intervalKm === "number" ? v.intervalKm : null,
      cost: typeof v.cost === "number" ? v.cost : null,
      notes: v.notes || null,
    };
    try {
      if (mode === "edit" && itemId) {
        await updateMut.mutateAsync(payload);
      } else {
        await createMut.mutateAsync(payload);
      }
      pushToast({ variant: "success", title: t("items.saved") });
      navigate("/dashboard");
    } catch (e) {
      pushToast({
        variant: "danger",
        title: t("items.saveFailed"),
        description: friendlyError(e, t),
      });
    }
  });

  const onDelete = async () => {
    if (!itemId) return;
    if (!(await confirm({ title: t("maintenance.deleteConfirm"), confirmLabel: t("items.delete"), destructive: true }))) return;
    try {
      await deleteMut.mutateAsync(itemId);
      pushToast({ variant: "success", title: t("items.deleted") });
      navigate("/dashboard");
    } catch (e) {
      pushToast({ variant: "danger", title: t("common.error"), description: friendlyError(e, t) });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {mode === "edit" ? t("maintenance.editTitle") : t("maintenance.newTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Field id="kind" label={t("items.type")}>
              <select
                id="kind"
                {...form.register("kind")}
                // text-base on phones so iOS doesn't zoom on focus — see ui/input.tsx.
                className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-base transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-border-dark dark:bg-surface-dark dark:text-text-dark sm:text-sm"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`maintenance.kinds.${k}`)}
                  </option>
                ))}
              </select>
            </Field>
            {/* Only "Diğer" has anything to label. Shown for every kind it read
                as a field you were supposed to fill in for engine oil too. */}
            {kind === "custom" && (
              <Field
                label={t("maintenance.customLabel")}
                error={form.formState.errors.customLabel?.message}
              >
                <Input {...form.register("customLabel")} autoCapitalize="sentences" />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t("maintenance.lastDoneOn")}
                error={form.formState.errors.lastDoneOn?.message}
              >
                <Input type="date" {...form.register("lastDoneOn")} />
              </Field>
              <Field
                label={t("maintenance.lastDoneKm")}
                error={form.formState.errors.lastDoneKm?.message}
              >
                <Input type="number" inputMode="numeric" {...form.register("lastDoneKm")} />
              </Field>
            </div>
            {/* Sits with "last done" rather than with the interval fields: it is
                what THAT job cost, and the fleet cost rollup buckets it by
                last_done_on. Optional — most people just log the service. */}
            <Field
              label={t("maintenance.cost")}
              hint={t("bike.optional")}
              error={form.formState.errors.cost?.message}
            >
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0"
                {...form.register("cost")}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t("maintenance.intervalMonths")}
                error={form.formState.errors.intervalMonths?.message}
              >
                <Input type="number" inputMode="numeric" {...form.register("intervalMonths")} />
              </Field>
              <Field
                label={t("maintenance.intervalKm")}
                error={form.formState.errors.intervalKm?.message}
              >
                <Input type="number" inputMode="numeric" {...form.register("intervalKm")} />
              </Field>
            </div>
            <Field id="notes" label={t("items.note")} error={form.formState.errors.notes?.message}>
              <textarea
                id="notes"
                rows={3}
                aria-invalid={form.formState.errors.notes ? true : undefined}
                aria-describedby={form.formState.errors.notes ? "notes-error" : undefined}
                {...form.register("notes")}
                className="rounded-xl border border-border bg-surface p-2 text-base transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-border-dark dark:bg-surface-dark dark:text-text-dark sm:text-sm"
              />
            </Field>
            <div className="mt-2 flex gap-2">
              <Button asChild variant="ghost" className="flex-1">
                <Link to="/dashboard">{t("common.cancel")}</Link>
              </Button>
              <Button type="submit" variant="accent" className="flex-1" disabled={createMut.isPending || updateMut.isPending}>
                {t("common.save")}
              </Button>
            </div>
            {mode === "edit" && (
              <Button
                type="button"
                variant="outline"
                className="mt-1 text-danger border-danger/40 hover:bg-danger/10 hover:border-danger/60"
                onClick={onDelete}
                disabled={deleteMut.isPending}
              >
                <Trash2 className="h-4 w-4" /> {t("items.delete")}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
