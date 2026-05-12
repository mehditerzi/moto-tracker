import { useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
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

const datedItemTypeValues = ["sigorta", "kasko", "muayene"] as const;

interface Props {
  mode: "new" | "edit";
}

export function DatedItemFormPage({ mode }: Props) {
  const { t } = useTranslation();
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

  const schema = z.object({
    type: z.enum(datedItemTypeValues),
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG"),
    provider: z.string().max(120).optional().or(z.literal("")),
    policyNo: z.string().max(80).optional().or(z.literal("")),
    cost: z.union([z.coerce.number().nonnegative(), z.literal("")]).optional(),
    notes: z.string().max(2000).optional().or(z.literal("")),
  });
  type FormValues = z.infer<typeof schema>;

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
        pushToast({ variant: "success", title: t("items.saved") });
        navigate(`/dated-items/${itemId}`);
      } else {
        const created = await createMut.mutateAsync(payload);
        pushToast({ variant: "success", title: t("items.saved") });
        navigate(`/dated-items/${created.id}`);
      }
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
    if (!confirm(t("items.confirmDelete"))) return;
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
            {isEdit
              ? t("items.editRecord")
              : t("items.newRecord", { type: t(`items.${initialType}`) })}
          </CardTitle>
          <CardDescription>{t("items.expiresOn")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type">{t("items.type")}</Label>
              <select
                id="type"
                {...form.register("type")}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              >
                {datedItemTypeValues.map((tt) => (
                  <option key={tt} value={tt}>
                    {t(`items.${tt}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expiresOn">{t("items.expiresOn")}</Label>
              <Input id="expiresOn" type="date" {...form.register("expiresOn")} />
              {form.formState.errors.expiresOn && (
                <p className="text-xs text-danger">{form.formState.errors.expiresOn.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider">{t("items.provider")}</Label>
              <Input id="provider" {...form.register("provider")} placeholder="Acme" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="policyNo">{t("items.policyNo")}</Label>
              <Input id="policyNo" {...form.register("policyNo")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cost">{t("items.amount")} (TL)</Label>
              <Input
                id="cost"
                type="number"
                inputMode="decimal"
                step="0.01"
                {...form.register("cost")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes">{t("items.note")}</Label>
              <textarea
                id="notes"
                {...form.register("notes")}
                rows={3}
                className="rounded-xl border border-border bg-surface p-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Button asChild variant="ghost" className="flex-1">
                <Link to={isEdit && itemId ? `/dated-items/${itemId}` : "/dashboard"}>
                  {t("common.cancel")}
                </Link>
              </Button>
              <Button type="submit" variant="accent" className="flex-1">
                {isEdit ? t("common.save") : t("dashboard.add")}
              </Button>
            </div>
            {isEdit && (
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
