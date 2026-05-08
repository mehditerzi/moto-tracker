import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/authClient";
import { pushToast } from "@/hooks/useToast";

const schema = z.object({
  name: z.string().min(1, "Ad gerekli"),
  email: z.string().email("Geçerli e-posta girin"),
  password: z.string().min(8, "En az 8 karakter"),
});
type FormValues = z.infer<typeof schema>;

export function SignUpPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (v) => {
    setBusy(true);
    const res = await signUp.email({ email: v.email, password: v.password, name: v.name });
    setBusy(false);
    if (res.error) {
      pushToast({ variant: "danger", title: "Kayıt başarısız", description: res.error.message });
      return;
    }
    navigate("/bikes");
  });

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Hesap oluştur</CardTitle>
          <CardDescription>MotoTracker ile motosikletini takip etmeye başla.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div>
              <Label htmlFor="name">Ad</Label>
              <Input id="name" {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-danger">{form.formState.errors.name.message}</p>}
            </div>
            <div>
              <Label htmlFor="email">E-posta</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
              {form.formState.errors.email && <p className="text-xs text-danger">{form.formState.errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="password">Şifre</Label>
              <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
              {form.formState.errors.password && <p className="text-xs text-danger">{form.formState.errors.password.message}</p>}
            </div>
            <Button type="submit" disabled={busy}>Hesap oluştur</Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted dark:text-muted-dark">
            Zaten hesabın var mı? <Link to="/sign-in" className="underline">Giriş yap</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
