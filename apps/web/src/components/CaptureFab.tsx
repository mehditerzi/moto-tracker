import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Camera } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  bikeId?: string;
}

export function CaptureFab({ bikeId }: Props) {
  const { t } = useTranslation();
  const to = bikeId ? `/capture?bikeId=${bikeId}` : "/capture";
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 400, damping: 24 }}
      className="fixed right-5 z-40"
      style={{ bottom: "max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))" }}
    >
      <Link
        to={to}
        aria-label={t("capture.title")}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-black shadow-lg shadow-accent/40 ring-1 ring-black/10 transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg dark:focus-visible:ring-offset-bg-dark"
      >
        <Camera className="h-6 w-6" />
      </Link>
    </motion.div>
  );
}
