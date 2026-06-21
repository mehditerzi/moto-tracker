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
import { Label } from "@/components/ui/label";
import { pushToast } from "@/hooks/useToast";
import {
  useCreateMaintenance,
  useDeleteMaintenance,
  useMaintenanceItem,
  useUpdateMaintenance,
} from "@/hooks/useMaintenanceItems";

const KINDS = ["engine_oil", "brakes", "tires", "battery", "coolant", "air_filter", "chain", "custom"] as const;

const schema = z.object({
  kind: z.enum(KINDS),
  customLabel: z.string().max(120).optional().or(z.literal("")),
  lastDoneOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG").optional().or(z.literal("")),
  lastDoneKm: z.union([z.coerce.number().int().nonnegative(), z.literal("")]).optional(),
  intervalMonths: z.union([z.coerce.number().int().positive(), z.literal("")]).optional(),
  intervalKm: z.union([z.coerce.number().int().positive(), z.literal("")]).optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  mode: "new" | "edit";
}

export function MaintenanceFormPage({ mode }: Props) {
  const { t } = useTranslation();
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

  useEffect(() => {
    if (mode === "edit" && item.data) {
      form.reset({
        kind: item.data.kind,
        customLabel: item.data.customLabel ?? "",
        lastDoneOn: item.data.lastDoneOn ?? "",
        lastDoneKm: item.data.lastDoneKm ?? "",
        intervalMonths: item.data.intervalMonths ?? "",
        intervalKm: item.data.intervalKm ?? "",
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
        description: String(e),
      });
    }
  });

  const onDelete = async () => {
    if (!itemId) return;
    if (!confirm(t("maintenance.deleteConfirm"))) return;
    await deleteMut.mutateAsync(itemId);
    navigate("/dashboard");
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kind">{t("items.type")}</Label>
              <select
                id="kind"
                {...form.register("kind")}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`maintenance.kinds.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customLabel">{t("maintenance.customLabel")}</Label>
              <Input id="customLabel" {...form.register("customLabel")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lastDoneOn">{t("maintenance.lastDoneOn")}</Label>
                <Input id="lastDoneOn" type="date" {...form.register("lastDoneOn")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lastDoneKm">{t("maintenance.lastDoneKm")}</Label>
                <Input
                  id="lastDoneKm"
                  type="number"
                  inputMode="numeric"
                  {...form.register("lastDoneKm")}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="intervalMonths">{t("maintenance.intervalMonths")}</Label>
                <Input
                  id="intervalMonths"
                  type="number"
                  inputMode="numeric"
                  {...form.register("intervalMonths")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="intervalKm">{t("maintenance.intervalKm")}</Label>
                <Input
                  id="intervalKm"
                  type="number"
                  inputMode="numeric"
                  {...form.register("intervalKm")}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes">{t("items.note")}</Label>
              <textarea
                id="notes"
                rows={3}
                {...form.register("notes")}
                className="rounded-xl border border-border bg-surface p-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Button asChild variant="ghost" className="flex-1">
                <Link to="/dashboard">{t("common.cancel")}</Link>
              </Button>
              <Button type="submit" variant="accent" className="flex-1">
                {t("common.save")}
              </Button>
            </div>
            {mode === "edit" && (
              <Button
                type="button"
                variant="outline"
                className="mt-1 text-danger border-danger/40 hover:bg-danger/10 hover:border-danger/60"
                onClick={onDelete}
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
