import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Settings2, Bike as BikeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/hooks/useDashboard";
import { StatusChip } from "@/components/StatusChip";
import { BikeSwitcher } from "@/components/BikeSwitcher";
import { TYPE_ORDER } from "@/lib/datedItems";
import { CaptureFab } from "@/components/CaptureFab";
import { MaintenancePanel } from "@/components/MaintenancePanel";

export function DashboardPage() {
  const dash = useDashboard();
  const [activeBikeId, setActiveBikeId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (dash.data && dash.data.length > 0 && !activeBikeId) {
      setActiveBikeId(dash.data[0]!.bike.id);
    }
  }, [dash.data, activeBikeId]);

  if (dash.isLoading) {
    return <p className="text-center text-muted dark:text-muted-dark">Yükleniyor...</p>;
  }
  if (dash.isError || !dash.data) {
    return <p className="text-center text-danger">Yüklenemedi.</p>;
  }

  if (dash.data.length === 0) {
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
          <Link to="/bikes/new">
            <Plus className="h-4 w-4" /> Bir motosiklet ekle
          </Link>
        </Button>
        <CaptureFab />
      </motion.div>
    );
  }

  const active = (dash.data.find((e) => e.bike.id === activeBikeId) ?? dash.data[0])!;

  return (
    <div className="flex flex-col gap-5">
      <BikeSwitcher
        entries={dash.data}
        activeBikeId={active.bike.id}
        onSelect={setActiveBikeId}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={active.bike.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
          className="flex flex-col gap-4"
        >
          <header className="flex items-end justify-between">
            <div>
              <div className="text-sm uppercase tracking-wider text-muted dark:text-muted-dark">
                Aktif motosiklet
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{active.bike.nickname}</h1>
              <p className="text-sm text-muted dark:text-muted-dark">
                {[active.bike.make, active.bike.model, active.bike.year]
                  .filter(Boolean)
                  .join(" · ") || "—"}
                {active.bike.plate && (
                  <span className="ml-2 font-mono">· {active.bike.plate}</span>
                )}
              </p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to={`/bikes/${active.bike.id}/edit`}>
                <Settings2 className="h-4 w-4" />
              </Link>
            </Button>
          </header>

          <div className="grid gap-3 sm:grid-cols-3">
            {TYPE_ORDER.map((t) => (
              <StatusChip key={t} type={t} bikeId={active.bike.id} item={active.items[t]} />
            ))}
          </div>

          <MaintenancePanel bikeId={active.bike.id} />
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex items-center justify-end">
        <Button asChild size="sm" variant="outline">
          <Link to="/bikes">
            <Plus className="h-4 w-4" /> Motosikletleri yönet
          </Link>
        </Button>
      </div>
      <CaptureFab bikeId={active.bike.id} />
    </div>
  );
}
