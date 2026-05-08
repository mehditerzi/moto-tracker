import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="text-2xl font-semibold">Sayfa bulunamadı</h1>
      <p className="mt-2 text-muted dark:text-muted-dark">Aradığın sayfa burada değil.</p>
      <Link to="/bikes" className="mt-4 inline-block underline">Anasayfaya dön</Link>
    </div>
  );
}
