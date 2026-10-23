import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { VehicleAvatar } from "@/components/VehicleAvatar";
import type { Bike } from "@mototracker/shared";

/**
 * The vehicle a per-vehicle screen (fuel, costs, glovebox) is about. Stated even
 * with a single vehicle — a figure like "₺/km" has to be attached to something
 * the reader can name — and a picker when there is more than one.
 */
export function VehicleBar({
  bike,
  bikes,
  onChange,
}: {
  bike: Bike;
  bikes: Bike[];
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const many = bikes.length > 1;
  return (
    <Card className="p-3 sm:p-3">
      <div className="flex items-center gap-3">
        <VehicleAvatar vehicle={bike} size="thumb" className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="label-micro text-muted dark:text-muted-dark">{t("fuel.vehicle")}</div>
          {many ? (
            <Select
              className="mt-1 font-medium"
              value={bike.id}
              onChange={(e) => onChange(e.target.value)}
              aria-label={t("fuel.switchVehicle")}
            >
              {bikes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nickname}
                  {b.plate ? ` · ${b.plate}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="truncate text-[16px] font-semibold leading-tight">
                {bike.nickname}
              </span>
              {bike.plate && (
                <span className="num shrink-0 text-[12px] text-muted dark:text-muted-dark">
                  {bike.plate}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

