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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { MoneyInput, NumberInput } from "@/components/ui/number-input";
import { Field, FormRow, FormSection } from "@/components/ui/field";
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
          {/* Three groups instead of one eight-field stack: what it is, what
              was done, and how often it is due. The interval pair in particular
              only makes sense read together, which the flat list never said. */}
          <form onSubmit={onSubmit} className="flex flex-col gap-6">
            <FormSection>
              <Field label={t("items.type")}>
                <Select {...form.register("kind")}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`maintenance.kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {/* Only "Diğer" has anything to label. Shown for every kind it read
                  as a field you were supposed to fill in for engine oil too. */}
              {kind === "custom" && (
                <Field
                  label={t("maintenance.customLabel")}
                  error={form.formState.errors.customLabel?.message}
                >
                  <Input
                    {...form.register("customLabel")}
                    autoCapitalize="sentences"
                    enterKeyHint="next"
                  />
                </Field>
              )}
            </FormSection>

            <FormSection title={t("maintenance.lastSection")}>
              <FormRow>
                <Field
                  label={t("maintenance.date")}
                  width="grow"
                  error={form.formState.errors.lastDoneOn?.message}
                >
                  <DateInput {...form.register("lastDoneOn")} enterKeyHint="next" />
                </Field>
                <Field
                  label={t("maintenance.km")}
                  width="short"
                  error={form.formState.errors.lastDoneKm?.message}
                >
                  <NumberInput suffix="km" {...form.register("lastDoneKm")} enterKeyHint="next" />
                </Field>
              </FormRow>
              {/* Sits with "last done" rather than with the interval fields: it is
                  what THAT job cost, and the fleet cost rollup buckets it by
                  last_done_on. Optional — most people just log the service. */}
              <Field
                label={t("maintenance.cost")}
                optional
                width="money"
                error={form.formState.errors.cost?.message}
              >
                <MoneyInput {...form.register("cost")} enterKeyHint="next" />
              </Field>
            </FormSection>

            <FormSection
              title={t("maintenance.intervalSection")}
              description={t("maintenance.intervalSectionSub")}
            >
              <FormRow>
                <Field
                  label={t("maintenance.months")}
                  width="tiny"
                  error={form.formState.errors.intervalMonths?.message}
                >
                  <NumberInput {...form.register("intervalMonths")} enterKeyHint="next" />
                </Field>
                <Field
                  label={t("maintenance.km")}
                  width="short"
                  error={form.formState.errors.intervalKm?.message}
                >
                  <NumberInput suffix="km" {...form.register("intervalKm")} enterKeyHint="next" />
                </Field>
              </FormRow>
            </FormSection>

            <FormSection>
              <Field
                label={t("items.note")}
                optional
                error={form.formState.errors.notes?.message}
              >
                <Textarea autoGrow showCount maxLength={2000} {...form.register("notes")} />
              </Field>
            </FormSection>

            <div className="flex gap-2">
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
