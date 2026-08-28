import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { useConfirm } from "@/components/ConfirmSheet";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import { useFleetContext } from "@/components/fleet/FleetLayout";
import { canManageFleet } from "@/hooks/useOrgs";
import {
  useCreateCustomer,
  useDeleteCustomer,
  useFleetContracts,
  useFleetCustomers,
} from "@/hooks/useFleetData";
import { Km, Plate, SectionHeading } from "@/components/fleet/bits";
import { RowCard, TableShell, Td, Th, Tr } from "@/components/fleet/table";

/**
 * `/fleet/customers` — rental mode only (docs/fleet-design.md §7.6).
 *
 * `fleet_customer` holds the personal data of people who are NOT app users, so
 * the delete button here is an ERASURE control, not a tidy-up: `DELETE /api/me`
 * cannot reach a renter's record because there is no user row to cascade from,
 * and the privacy policy promises erasure anyway. The API deletes
 * unconditionally — including while a contract is open — so the confirmation
 * says exactly what goes with it rather than pretending the record can be
 * "archived".
 */
export function FleetCustomersPage() {
  const { t } = useTranslation();
  const { org } = useFleetContext();
  const manages = canManageFleet(org.role);

  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQuery(rawQuery.trim()), 220);
    return () => clearTimeout(h);
  }, [rawQuery]);

  const customers = useFleetCustomers(org.orgId, query, org.mode === "rental");
  const contracts = useFleetContracts(org.orgId, { status: "open" }, org.mode === "rental");

  // A fleet-mode org has no customers and every write here answers
  // `mode_mismatch`. Send them back rather than render a screen that cannot work.
  if (org.mode !== "rental") return <Navigate to="/fleet" replace />;

  return (
    <div className="flex flex-col gap-6">
      {manages && <NewCustomerForm orgId={org.orgId} />}

      <section aria-label={t("fleet.customers.title")}>
        <SectionHeading title={t("fleet.customers.title")} count={customers.data?.length}>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted dark:text-muted-dark"
              aria-hidden
            />
            <input
              type="search"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              aria-label={t("fleet.customers.search")}
              placeholder={t("fleet.customers.search")}
              className="h-8 w-48 rounded-lg border border-border bg-surface pl-8 pr-2 text-[12px] dark:border-border-dark dark:bg-surface-elev-dark"
            />
          </div>
        </SectionHeading>

        {customers.isPending ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : customers.isError || !customers.data ? (
          <ErrorState onRetry={() => void customers.refetch()} />
        ) : customers.data.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-[13px] text-muted dark:border-border-dark dark:text-muted-dark">
            {query ? t("fleet.customers.noMatches") : t("fleet.customers.empty")}
          </p>
        ) : (
          <CustomerList orgId={org.orgId} manages={manages} customers={customers.data} />
        )}
      </section>

      <section aria-label={t("fleet.customers.openContracts")}>
        <SectionHeading title={t("fleet.customers.openContracts")} count={contracts.data?.length} />
        {contracts.isPending ? (
          <Skeleton className="h-24 rounded-2xl" />
        ) : (contracts.data ?? []).length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-[13px] text-muted dark:border-border-dark dark:text-muted-dark">
            {t("fleet.customers.noOpenContracts")}
          </p>
        ) : (
          <TableShell label={t("fleet.customers.openContracts")}>
            <thead>
              <tr>
                <Th>{t("fleet.cols.plate")}</Th>
                <Th>{t("fleet.cols.vehicle")}</Th>
                <Th>{t("fleet.customers.customer")}</Th>
                <Th>{t("fleet.customers.from")}</Th>
                <Th>{t("fleet.customers.until")}</Th>
                <Th align="right">{t("fleet.customers.handoverKm")}</Th>
                <Th align="right">{t("fleet.customers.dailyRate")}</Th>
              </tr>
            </thead>
            <tbody>
              {contracts.data!.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link to={`/fleet/vehicles/${c.bikeId}`} className="hover:underline">
                      <Plate plate={c.bike.plate} />
                    </Link>
                  </Td>
                  <Td>{c.bike.nickname}</Td>
                  <Td className="font-medium">{c.customer.name ?? t("common.dash")}</Td>
                  <Td className="num text-muted dark:text-muted-dark">{c.startedAt.slice(0, 10)}</Td>
                  <Td className="num">{c.endsAt?.slice(0, 10) ?? t("common.dash")}</Td>
                  <Td align="right">
                    <Km value={c.handoverKm} />
                  </Td>
                  <Td align="right" className="num">
                    {c.dailyRate != null ? `${c.dailyRate} ${c.currency}` : t("common.dash")}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}

        <ul className="flex flex-col gap-2 lg:hidden">
          {(contracts.data ?? []).map((c) => (
            <li key={c.id}>
              <Link to={`/fleet/vehicles/${c.bikeId}`} className="block rounded-2xl">
                <RowCard>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Plate plate={c.bike.plate} />
                        <span className="truncate text-[14px] font-semibold">{c.bike.nickname}</span>
                      </div>
                      <p className="mt-1 truncate text-[13px]">{c.customer.name}</p>
                    </div>
                    <span className="num shrink-0 text-right text-[12px] text-muted dark:text-muted-dark">
                      {c.startedAt.slice(0, 10)}
                      <br />→ {c.endsAt?.slice(0, 10) ?? t("common.dash")}
                    </span>
                  </div>
                </RowCard>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NewCustomerForm({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const create = useCreateCustomer(orgId);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (!name.trim()) {
      setError(t("fleet.customers.nameRequired"));
      return;
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
      });
      setName("");
      setPhone("");
      setEmail("");
      pushToast({ variant: "success", title: t("fleet.customers.created") });
    } catch (err) {
      setError(friendlyError(err, t));
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface/70 p-4 dark:border-border-dark dark:bg-surface-dark/60"
    >
      <div className="min-w-[180px] flex-1">
        <Field label={t("fleet.customers.name")} error={error}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <div className="w-44">
        <Field label={t("fleet.customers.phone")} hint={t("fleet.optional")}>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>
      <div className="w-56">
        <Field label={t("fleet.customers.email")} hint={t("fleet.optional")}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      <Button type="submit" variant="accent" disabled={create.isPending}>
        <UserPlus className="h-4 w-4" /> {t("fleet.customers.add")}
      </Button>
    </form>
  );
}

function CustomerList({
  orgId,
  manages,
  customers,
}: {
  orgId: string;
  manages: boolean;
  customers: NonNullable<ReturnType<typeof useFleetCustomers>["data"]>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const remove = useDeleteCustomer(orgId);

  const onDelete = async (id: string, name: string, open: number) => {
    const ok = await confirm({
      title: t("fleet.customers.deleteConfirm", { name }),
      message:
        open > 0
          ? t("fleet.customers.deleteWithOpen", { count: open })
          : t("fleet.customers.deleteExplain"),
      confirmLabel: t("fleet.customers.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(id);
      pushToast({ variant: "success", title: t("fleet.customers.deleted") });
    } catch (e) {
      pushToast({
        variant: "danger",
        title: t("fleet.customers.deleteFailed"),
        description: friendlyError(e, t),
      });
    }
  };

  return (
    <>
      <TableShell label={t("fleet.customers.title")}>
        <thead>
          <tr>
            <Th>{t("fleet.customers.name")}</Th>
            <Th>{t("fleet.customers.phone")}</Th>
            <Th>{t("fleet.customers.email")}</Th>
            <Th align="right">{t("fleet.customers.open")}</Th>
            <Th align="right">{t("fleet.customers.total")}</Th>
            <Th align="right">
              <span className="sr-only">{t("fleet.people.actions")}</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <Tr key={c.id}>
              <Td className="font-medium">{c.name}</Td>
              <Td className="num text-muted dark:text-muted-dark">{c.phone ?? t("common.dash")}</Td>
              <Td className="text-muted dark:text-muted-dark">{c.email ?? t("common.dash")}</Td>
              <Td align="right" className="num">
                {c.openContracts}
              </Td>
              <Td align="right" className="num">
                {c.totalContracts}
              </Td>
              <Td align="right">
                {manages && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(c.id, c.name, c.openContracts)}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">{t("fleet.customers.delete")}</span>
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      <ul className="flex flex-col gap-2 lg:hidden">
        {customers.map((c) => (
          <li key={c.id}>
            <RowCard>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{c.name}</p>
                  <p className="num truncate text-[12px] text-muted dark:text-muted-dark">
                    {[c.phone, c.email].filter(Boolean).join(" · ") || t("common.dash")}
                  </p>
                  <p className="mt-1 text-[12px] text-muted dark:text-muted-dark">
                    {t("fleet.customers.contractCounts", {
                      open: c.openContracts,
                      total: c.totalContracts,
                    })}
                  </p>
                </div>
                {manages && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(c.id, c.name, c.openContracts)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">{t("fleet.customers.delete")}</span>
                  </Button>
                )}
              </div>
            </RowCard>
          </li>
        ))}
      </ul>
    </>
  );
}
