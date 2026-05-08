import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Bike as BikeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBikes } from "@/hooks/useBikes";

export function BikesPage() {
  const { data, isLoading, isError } = useBikes();

  if (isLoading) return <p className="text-center text-muted dark:text-muted-dark">Yükleniyor...</p>;
  if (isError) return <p className="text-center text-danger">Yüklenemedi.</p>;

  if (!data || data.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center"
      >
        <BikeIcon className="h-12 w-12 text-muted dark:text-muted-dark" />
        <div>
          <h1 className="text-xl font-semibold">Henüz motosiklet eklemedin</h1>
          <p className="mt-1 text-sm text-muted dark:text-muted-dark">
            İlk motosikletini ekleyerek başla.
          </p>
        </div>
        <Button asChild variant="accent">
          <Link to="/bikes/new"><Plus className="h-4 w-4" /> Bir motosiklet ekle</Link>
        </Button>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Motosikletlerim</h1>
        <Button asChild size="sm" variant="accent">
          <Link to="/bikes/new"><Plus className="h-4 w-4" /> Ekle</Link>
        </Button>
      </div>
      <div className="grid gap-3">
        {data.map((b) => (
          <motion.div key={b.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <Link to={`/bikes/${b.id}/edit`}>
              <Card className="flex items-center justify-between hover:border-accent">
                <div>
                  <div className="font-semibold">{b.nickname}</div>
                  <div className="text-sm text-muted dark:text-muted-dark">
                    {[b.make, b.model, b.year].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {b.plate && <div className="mt-1 font-mono text-xs">{b.plate}</div>}
                </div>
                <BikeIcon className="h-6 w-6 text-muted dark:text-muted-dark" />
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
