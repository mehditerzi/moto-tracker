import { useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBike, useCreateBike, useUpdateBike, useArchiveBike } from "@/hooks/useBikes";
import { pushToast } from "@/hooks/useToast";

const schema = z.object({
  nickname: z.string().min(1, "Ad gerekli").max(80),
  plate: z.string().max(20).optional().or(z.literal("")),
  make: z.string().max(60).optional().or(z.literal("")),
  model: z.string().max(60).optional().or(z.literal("")),
  year: z
    .union([z.coerce.number().int().min(1900).max(2100), z.literal("")])
    .optional(),
  currentKm: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  color: z.string().max(40).optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

export function BikeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const bike = useBike(id);
  const createMut = useCreateBike();
  const updateMut = useUpdateBike(id ?? "");
  const archiveMut = useArchiveBike();

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { nickname: "" } });

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
      });
    }
  }, [isEdit, bike.data, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const payload = {
      nickname: v.nickname,
      plate: v.plate || null,
      make: v.make || null,
      model: v.model || null,
      year: typeof v.year === "number" ? v.year : null,
      currentKm: typeof v.currentKm === "number" ? v.currentKm : null,
      color: v.color || null,
    };
    try {
      if (isEdit && id) {
        await updateMut.mutateAsync(payload);
        pushToast({ variant: "success", title: "Güncellendi" });
      } else {
        await createMut.mutateAsync(payload);
        pushToast({ variant: "success", title: "Eklendi" });
      }
      navigate("/bikes");
    } catch (e) {
      pushToast({ variant: "danger", title: "Kaydedilemedi", description: String(e) });
    }
  });

  const onArchive = async () => {
    if (!id) return;
    if (!confirm("Bu motosikleti arşivlemek istiyor musun?")) return;
    await archiveMut.mutateAsync(id);
    navigate("/bikes");
  };

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? "Motosikleti düzenle" : "Yeni motosiklet"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Field label="Takma ad" error={form.formState.errors.nickname?.message}>
              <Input {...form.register("nickname")} placeholder="ör. Monster" />
            </Field>
            <Field label="Plaka">
              <Input {...form.register("plate")} placeholder="34 ABC 123" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Marka">
                <Input {...form.register("make")} placeholder="Ducati" />
              </Field>
              <Field label="Model">
                <Input {...form.register("model")} placeholder="Monster 937" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Yıl">
                <Input type="number" {...form.register("year")} placeholder="2023" />
              </Field>
              <Field label="Şu anki km">
                <Input type="number" {...form.register("currentKm")} placeholder="12000" />
              </Field>
            </div>
            <Field label="Renk">
              <Input {...form.register("color")} placeholder="Kırmızı" />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="accent" className="flex-1">
                {isEdit ? "Kaydet" : "Ekle"}
              </Button>
              <Button asChild variant="ghost" className="flex-1"><Link to="/bikes">İptal</Link></Button>
            </div>
            {isEdit && (
              <Button type="button" variant="danger" onClick={onArchive}>
                <Trash2 className="h-4 w-4" /> Arşivle
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
