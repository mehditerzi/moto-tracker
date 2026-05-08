import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/authClient";
import { pushToast } from "@/hooks/useToast";

const schema = z.object({
  email: z.string().email("Geçerli e-posta girin"),
  password: z.string().min(8, "En az 8 karakter"),
});
type FormValues = z.infer<typeof schema>;

export function SignInPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (v) => {
    setBusy(true);
    const res = await signIn.email({ email: v.email, password: v.password });
    setBusy(false);
    if (res.error) {
      pushToast({ variant: "danger", title: "Giriş başarısız", description: res.error.message });
      return;
    }
    navigate("/bikes");
  });

  const onMagic = async () => {
    const email = form.getValues("email");
    if (!email) {
      form.setError("email", { message: "Önce e-posta girin" });
      return;
    }
    setBusy(true);
    const res = await signIn.magicLink({ email, callbackURL: "/auth/callback" });
    setBusy(false);
    if (res.error) {
      pushToast({ variant: "danger", title: "Bağlantı gönderilemedi", description: res.error.message });
      return;
    }
    navigate("/magic-link-sent");
  };

  const onGoogle = async () => {
    setBusy(true);
    await signIn.social({ provider: "google", callbackURL: "/auth/callback" });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Tekrar hoş geldin</CardTitle>
          <CardDescription>Hesabınla giriş yap.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="email">E-posta</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
              {form.formState.errors.email && (
                <p className="text-xs text-danger">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="password">Şifre</Label>
              <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
              {form.formState.errors.password && (
                <p className="text-xs text-danger">{form.formState.errors.password.message}</p>
              )}
            </div>
            <Button type="submit" disabled={busy}>Giriş yap</Button>
          </form>
          <div className="my-4 flex items-center gap-2 text-xs text-muted dark:text-muted-dark">
            <div className="h-px flex-1 bg-border dark:bg-border-dark" /> veya <div className="h-px flex-1 bg-border dark:bg-border-dark" />
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={onMagic} disabled={busy}>Sihirli bağlantı gönder</Button>
            <Button variant="outline" onClick={onGoogle} disabled={busy}>Google ile giriş</Button>
          </div>
          <p className="mt-4 text-center text-sm text-muted dark:text-muted-dark">
            Hesabın yok mu? <Link to="/sign-up" className="underline">Kayıt ol</Link>
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
