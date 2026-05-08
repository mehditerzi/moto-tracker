import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function MagicLinkSentPage() {
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Bağlantı gönderildi</CardTitle>
          <CardDescription>E-postanı kontrol et ve giriş bağlantısına tıkla.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted dark:text-muted-dark">
            Bağlantı 15 dakika geçerli. Spam kutusunu da kontrol etmeyi unutma.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
