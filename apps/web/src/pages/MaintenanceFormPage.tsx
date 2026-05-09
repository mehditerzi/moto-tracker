import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
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

const KINDS = ["engine_oil", "chain", "brakes", "tires", "coolant", "custom"] as const;

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
      pushToast({ variant: "success", title: "Kaydedildi" });
      navigate("/dashboard");
    } catch (e) {
      pushToast({ variant: "danger", title: "Kaydedilemedi", description: String(e) });
    }
  });

  const onDelete = async () => {
    if (!itemId) return;
    if (!confirm("Sil?")) return;
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
          <CardTitle>{mode === "edit" ? "Bakım kaydını düzenle" : "Yeni bakım kaydı"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="kind">Tür</Label>
              <select
                id="kind"
                {...form.register("kind")}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              >
                <option value="engine_oil">Motor yağı</option>
                <option value="chain">Zincir</option>
                <option value="brakes">Fren</option>
                <option value="tires">Lastik</option>
                <option value="coolant">Soğutma</option>
                <option value="custom">Diğer</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="customLabel">Etiket (Diğer için)</Label>
              <Input id="customLabel" {...form.register("customLabel")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="lastDoneOn">Son yapım tarihi</Label>
                <Input id="lastDoneOn" type="date" {...form.register("lastDoneOn")} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="lastDoneKm">Son yapım km</Label>
                <Input id="lastDoneKm" type="number" {...form.register("lastDoneKm")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="intervalMonths">Periyot (ay)</Label>
                <Input id="intervalMonths" type="number" {...form.register("intervalMonths")} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="intervalKm">Periyot (km)</Label>
                <Input id="intervalKm" type="number" {...form.register("intervalKm")} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="notes">Not</Label>
              <textarea
                id="notes"
                rows={3}
                {...form.register("notes")}
                className="rounded-xl border border-border bg-surface p-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="accent" className="flex-1">
                Kaydet
              </Button>
              <Button asChild variant="ghost" className="flex-1">
                <Link to="/dashboard">İptal</Link>
              </Button>
            </div>
            {mode === "edit" && (
              <Button type="button" variant="danger" onClick={onDelete}>
                <Trash2 className="h-4 w-4" /> Sil
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
