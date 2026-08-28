import { NavLink, Navigate, Outlet, useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Car, Wallet, Users, Contact, Upload } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { canManageFleet, useFleetAccess, type FleetOrgMembership } from "@/hooks/useOrgs";
import { cn } from "@/lib/cn";

/**
 * The gate and the chrome for every `/fleet` screen.
 *
 * THIS IS THE APP-STORE-CRITICAL COMPONENT. docs/fleet-design.md §1 forbids a
 * consumer from being able to tell that fleet exists, so:
 *
 *   • Nothing fleet-shaped renders until `GET /api/orgs` has answered.
 *   • A user with no owner/manager/staff membership — a consumer, or a DRIVER,
 *     whose membership is deliberately included in that response so we can
 *     exclude them here (§3) — is redirected to the consumer dashboard. They
 *     never see a word of fleet copy, not even "you don't have access".
 *   • There is no acquisition affordance anywhere below this component: no
 *     price, no plan, no "contact sales", no link out. Organizations are
 *     provisioned by the operator; the app has no path to buying one.
 *
 * A redirect rather than a 404 page is deliberate: a wrong-turn URL should land
 * a consumer somewhere ordinary, not on a page that implies a locked door.
 */
export function FleetLayout() {
  const { t } = useTranslation();
  const access = useFleetAccess();

  if (access.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-hidden>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-9 w-full max-w-lg rounded-xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (!access.canSeeFleet || !access.active) return <Navigate to="/dashboard" replace />;

  const org = access.active;
  const manages = canManageFleet(org.role);

  const tabs = [
    { to: "/fleet", label: t("fleet.tabs.board"), icon: LayoutGrid, end: true, show: true },
    { to: "/fleet/vehicles", label: t("fleet.tabs.vehicles"), icon: Car, show: true },
    { to: "/fleet/costs", label: t("fleet.tabs.costs"), icon: Wallet, show: true },
    {
      to: "/fleet/customers",
      label: t("fleet.tabs.customers"),
      icon: Contact,
      // Rental mode only: in a fleet-mode org every customer route answers
      // `mode_mismatch`, so offering the tab would only ever be a dead end.
      show: org.mode === "rental",
    },
    { to: "/fleet/people", label: t("fleet.tabs.people"), icon: Users, show: manages },
    { to: "/fleet/import", label: t("fleet.tabs.import"), icon: Upload, show: manages },
  ].filter((tab) => tab.show);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="label-micro text-muted dark:text-muted-dark">{t("fleet.nav")}</p>
          <h1 className="mt-1.5 truncate text-[26px] font-semibold leading-none tracking-tight">
            {org.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted dark:border-border-dark dark:text-muted-dark">
            {t(`fleet.mode.${org.mode}`)} · {t(`fleet.roles.${org.role}`)}
          </span>
          {access.fleetOrgs.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="sr-only">{t("fleet.switchOrg")}</span>
              <select
                value={org.orgId}
                onChange={(e) => access.setActiveOrgId(e.target.value)}
                className="h-9 rounded-xl border border-border bg-surface px-2 text-[13px] dark:border-border-dark dark:bg-surface-elev-dark"
              >
                {access.fleetOrgs.map((o) => (
                  <option key={o.orgId} value={o.orgId}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      <nav aria-label={t("fleet.nav")} className="-mx-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        <ul className="flex min-w-max items-center gap-1 px-1">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-[40px] items-center gap-2 rounded-xl px-3 text-[13px] font-medium transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    isActive
                      ? "bg-surface-elev text-text dark:bg-surface-elev-dark dark:text-text-dark"
                      : "text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark",
                  )
                }
              >
                <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet context={{ org } satisfies FleetContext} />
    </div>
  );
}

export interface FleetContext {
  /**
   * `FleetOrgMembership`, not `OrgMembership`: `OrgMode` now has a third value
   * ('personal', the consumer garage group) and nothing under /fleet can render
   * one. `useFleetAccess` does the narrowing, so every screen below this layout
   * gets a mode the compiler has already proved is a business fleet.
   */
  org: FleetOrgMembership;
}

/** Every fleet screen reads its org from here rather than re-deriving it. */
export function useFleetContext(): FleetContext {
  return useOutletContext<FleetContext>();
}
