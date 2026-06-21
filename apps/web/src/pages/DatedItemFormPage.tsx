import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card, CardHeader, CardTitle, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { pushToast } from "@/hooks/useToast";
import {
  useCreateDatedItem,
  useDatedItem,
  useDeleteDatedItem,
  useUpdateDatedItem,
} from "@/hooks/useDatedItems";
import type { DatedItemType } from "@mototracker/shared";
import { useConfirm } from "@/components/ConfirmSheet";

const TYPES: DatedItemType[] = ["sigorta", "kasko", "muayene"];

interface Props {
  mode: "new" | "edit";
}

export function DatedItemFormPage({ mode }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
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

  const prefillType = (search.get("type") as DatedItemType | null);
  const prefillDate = search.get("expiresOn") ?? "";

  const [type, setType] = useState<DatedItemType>(
    TYPES.includes(prefillType as DatedItemType) ? (prefillType as DatedItemType) : "sigorta",
  );
  const [expiresOn, setExpiresOn] = useState(prefillDate);
  const [dateError, setDateError] = useState("");

  useEffect(() => {
    if (isEdit && item.data) {
      setType(item.data.type);
      setExpiresOn(item.data.expiresOn);
    }
  }, [isEdit, item.data]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
      setDateError("YYYY-AA-GG");
      return;
    }
    setDateError("");
    try {
      if (isEdit && itemId) {
        await updateMut.mutateAsync({ type, expiresOn });
        pushToast({ variant: "success", title: t("items.saved") });
        navigate(`/dated-items/${itemId}`);
      } else {
        const created = await createMut.mutateAsync({ type, expiresOn });
        pushToast({ variant: "success", title: t("items.saved") });
        navigate(`/dated-items/${created.id}`);
      }
    } catch (err) {
      pushToast({ variant: "danger", title: t("items.saveFailed"), description: String(err) });
    }
  };

  const onDelete = async () => {
    if (!itemId) return;
    if (!(await confirm({ title: t("items.confirmDelete"), confirmLabel: t("items.delete"), destructive: true }))) return;
    try {
      await deleteMut.mutateAsync(itemId);
      navigate("/dashboard");
    } catch (e) {
      pushToast({ variant: "danger", title: t("common.error"), description: (e as Error).message });
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;
  const backUrl = isEdit && itemId ? `/dated-items/${itemId}` : "/dashboard";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {isEdit ? t("items.editRecord") : t("items.newRecord", { type: t(`items.${type}`) })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            {/* Type selector — hidden in edit mode */}
            {!isEdit && (
              <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-surface-elev p-1 dark:bg-surface-elev-dark">
                {TYPES.map((tt) => (
                  <button
                    key={tt}
                    type="button"
                    onClick={() => setType(tt)}
                    className={`rounded-xl py-2 text-[13px] font-medium transition ${
                      type === tt
                        ? "bg-surface shadow-card text-text dark:bg-surface-dark dark:text-text-dark"
                        : "text-muted dark:text-muted-dark"
                    }`}
                  >
                    {t(`items.${tt}`)}
                  </button>
                ))}
              </div>
            )}

            {/* Date picker */}
            <div className="flex flex-col items-center gap-2 py-2">
              <label className="label-micro text-muted dark:text-muted-dark" htmlFor="expiresOn">
                {t("items.expiresOn")}
              </label>
              <input
                id="expiresOn"
                type="date"
                value={expiresOn}
                onChange={(e) => { setExpiresOn(e.target.value); setDateError(""); }}
                required
                className={`w-full rounded-2xl border bg-surface px-4 py-4 text-center text-[22px] font-semibold tracking-tight transition
                  focus:outline-none focus:ring-2 focus:ring-accent/50
                  dark:bg-surface-dark dark:text-text-dark
                  ${dateError
                    ? "border-danger text-danger dark:border-danger"
                    : "border-border dark:border-border-dark text-text"
                  }`}
              />
              {dateError && <p className="text-xs text-danger">{dateError}</p>}
            </div>

            <div className="flex gap-2">
              <Button asChild variant="ghost" className="flex-1">
                <Link to={backUrl}>{t("common.cancel")}</Link>
              </Button>
              <Button type="submit" variant="accent" className="flex-1" disabled={isPending}>
                {isEdit ? t("common.save") : t("dashboard.add")}
              </Button>
            </div>

            {isEdit && (
              <Button
                type="button"
                variant="outline"
                className="text-danger border-danger/40 hover:bg-danger/10 hover:border-danger/60"
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
