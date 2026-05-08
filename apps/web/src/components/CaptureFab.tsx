import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Camera } from "lucide-react";

interface Props {
  bikeId?: string;
}

export function CaptureFab({ bikeId }: Props) {
  const to = bikeId ? `/capture?bikeId=${bikeId}` : "/capture";
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 24 }}
      className="fixed bottom-6 right-6 z-40"
    >
      <Link
        to={to}
        aria-label="Belge yükle"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-bg shadow-lg shadow-accent/30 ring-1 ring-black/10"
      >
        <Camera className="h-6 w-6" />
      </Link>
    </motion.div>
  );
}
