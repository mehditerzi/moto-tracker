import { useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pushToast } from "@/hooks/useToast";
import {
  useCreateDatedItem,
  useDatedItem,
  useDeleteDatedItem,
  useUpdateDatedItem,
} from "@/hooks/useDatedItems";
import type { DatedItemType } from "@mototracker/shared";
import { TYPE_LABEL_TR } from "@/lib/datedItems";

const datedItemTypeValues = ["sigorta", "kasko", "muayene"] as const;

const schema = z.object({
  type: z.enum(datedItemTypeValues),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG formatında girin"),
  provider: z.string().max(120).optional().or(z.literal("")),
  policyNo: z.string().max(80).optional().or(z.literal("")),
  cost: z.union([z.coerce.number().nonnegative(), z.literal("")]).optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  mode: "new" | "edit";
}

export function DatedItemFormPage({ mode }: Props) {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const isEdit = mode === "edit";
  const itemId = isEdit ? params.id : undefined;
  const bikeId = !isEdit ? params.bikeId : undefined;

  const item = useDatedItem(itemId);
  const createMut = useCreateDatedItem(bikeId ?? "");
  const updateMut = useUpdateDatedItem(itemId ?? "");
  const deleteMut = useDeleteDatedItem();

  const initialType = (search.get("type") as DatedItemType | null) ?? "sigorta";

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: initialType, expiresOn: "" },
  });

  useEffect(() => {
    if (isEdit && item.data) {
      form.reset({
        type: item.data.type,
        expiresOn: item.data.expiresOn,
        provider: item.data.provider ?? "",
        policyNo: item.data.policyNo ?? "",
        cost: item.data.cost ?? "",
        notes: item.data.notes ?? "",
      });
    }
  }, [isEdit, item.data, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const payload = {
      type: v.type,
      expiresOn: v.expiresOn,
      provider: v.provider || null,
      policyNo: v.policyNo || null,
      cost: typeof v.cost === "number" ? v.cost : null,
      notes: v.notes || null,
    };
    try {
      if (isEdit && itemId) {
        await updateMut.mutateAsync(payload);
        pushToast({ variant: "success", title: "Güncellendi" });
        navigate(`/dated-items/${itemId}`);
      } else {
        const created = await createMut.mutateAsync(payload);
        pushToast({ variant: "success", title: "Eklendi" });
        navigate(`/dated-items/${created.id}`);
      }
    } catch (e) {
      pushToast({ variant: "danger", title: "Kaydedilemedi", description: String(e) });
    }
  });

  const onDelete = async () => {
    if (!itemId) return;
    if (!confirm("Bu kaydı silmek istiyor musun?")) return;
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
            {isEdit ? "Kaydı düzenle" : `Yeni ${TYPE_LABEL_TR[initialType]} kaydı`}
          </CardTitle>
          <CardDescription>Bitiş tarihini ve isteğe bağlı detayları gir.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="type">Tür</Label>
              <select
                id="type"
                {...form.register("type")}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              >
                {datedItemTypeValues.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL_TR[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="expiresOn">Bitiş tarihi</Label>
              <Input id="expiresOn" type="date" {...form.register("expiresOn")} />
              {form.formState.errors.expiresOn && (
                <p className="text-xs text-danger">{form.formState.errors.expiresOn.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="provider">Şirket</Label>
              <Input id="provider" {...form.register("provider")} placeholder="Acme Sigorta" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="policyNo">Poliçe no</Label>
              <Input id="policyNo" {...form.register("policyNo")} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cost">Tutar (TL)</Label>
              <Input id="cost" type="number" step="0.01" {...form.register("cost")} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="notes">Not</Label>
              <textarea
                id="notes"
                {...form.register("notes")}
                rows={3}
                className="rounded-xl border border-border bg-surface p-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="accent" className="flex-1">
                {isEdit ? "Kaydet" : "Ekle"}
              </Button>
              <Button asChild variant="ghost" className="flex-1">
                <Link to={isEdit && itemId ? `/dated-items/${itemId}` : "/dashboard"}>
                  İptal
                </Link>
              </Button>
            </div>
            {isEdit && (
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
