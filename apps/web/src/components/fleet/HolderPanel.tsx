import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRightLeft, UserPlus } from "lucide-react";
import type { OrgMode, OrgRole } from "@mototracker/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ConfirmSheet";
import { pushToast } from "@/hooks/useToast";
import { friendlyError } from "@/lib/apiError";
import {
  useAssignVehicle,
  useCloseContract,
  useCancelContract,
  useCreateContract,
  useEndAssignment,
  useFleetContracts,
  useFleetCustomers,
  useFleetMembers,
  useOpenAssignmentFor,
} from "@/hooks/useFleetData";
import { canManageFleet } from "@/hooks/useOrgs";

/**
 * "Who has this vehicle, and hand it over."
 *
 * ONE panel for both modes, per docs/fleet-design.md §4: in `fleet` mode the
 * holder is a driver on a `vehicle_assignment`, in `rental` mode a customer on a
 * `rental_contract`. Two parallel UIs would have been the easy thing to write
 * and the wrong thing to maintain, so what changes is which relationship the
 * panel opens and closes — not the shape of the screen.
 *
 * Staff see the current holder and no controls: §2 puts assignments and
 * contracts with owners and managers. The server enforces that; this only keeps
 * the UI from offering a button that is guaranteed to 403.
 */
export function HolderPanel({
  orgId,
  mode,
  role,
  bikeId,
  currentKm,
}: {
  orgId: string;
  mode: OrgMode;
  role: OrgRole;
  bikeId: string;
  currentKm: number | null;
}) {
  const { t } = useTranslation();
  const manages = canManageFleet(role);

  return (
    <section className="rounded-2xl border border-border bg-surface/70 p-4 dark:border-border-dark dark:bg-surface-dark/60">
      <h2 className="label-micro mb-3 text-muted dark:text-muted-dark">
        {t(`fleet.detail.holder.${mode}`)}
      </h2>
      {mode === "fleet" ? (
        <AssignmentControls orgId={orgId} bikeId={bikeId} manages={manages} currentKm={currentKm} />
      ) : (
        <ContractControls orgId={orgId} bikeId={bikeId} manages={manages} currentKm={currentKm} />
      )}
    </section>
  );
}

// ─── fleet mode ───────────────────────────────────────────────────────────────

function AssignmentControls({
  orgId,
  bikeId,
  manages,
  currentKm,
}: {
  orgId: string;
  bikeId: string;
  manages: boolean;
  currentKm: number | null;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const open = useOpenAssignmentFor(orgId, bikeId, true);
  // The member list is an owner/manager route, so staff never ask for it.
  const members = useFleetMembers(orgId, manages);
  const assign = useAssignVehicle(orgId);
  const end = useEndAssignment(orgId);

  const [userId, setUserId] = useState("");
  const [startKm, setStartKm] = useState("");
  const [endKm, setEndKm] = useState("");

  const current = open.data?.[0] ?? null;

  const doAssign = async () => {
    if (!userId) return;
    try {
      await assign.mutateAsync({
        bikeId,
        userId,
        startKm: startKm ? Number(startKm) : null,
      });
      setUserId("");
      setStartKm("");
      pushToast({ variant: "success", title: t("fleet.detail.assigned") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("fleet.detail.actionFailed"), description: friendlyError(e, t) });
    }
  };

  const doEnd = async () => {
    if (!current) return;
    const ok = await confirm({
      title: t("fleet.detail.endConfirm", { name: current.user.name ?? current.user.email ?? "" }),
      confirmLabel: t("fleet.detail.endAssignment"),
    });
    if (!ok) return;
    try {
      await end.mutateAsync({ id: current.id, endKm: endKm ? Number(endKm) : null });
      setEndKm("");
      pushToast({ variant: "success", title: t("fleet.detail.ended") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("fleet.detail.actionFailed"), description: friendlyError(e, t) });
    }
  };

  if (open.isPending) {
    return <p className="text-[13px] text-muted dark:text-muted-dark">{t("common.loading")}</p>;
  }

  if (current) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] font-semibold">
          {current.user.name ?? current.user.email ?? current.userId}
        </p>
        <p className="text-[12px] text-muted dark:text-muted-dark">
          {t("fleet.detail.since", { date: current.startedAt.slice(0, 10) })}
          {current.startKm != null && ` · ${t("fleet.detail.startKm", { km: current.startKm })}`}
        </p>
        {manages && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Field label={t("fleet.detail.endKm")} hint={t("fleet.optional")}>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={endKm}
                  onChange={(e) => setEndKm(e.target.value)}
                  placeholder={currentKm != null ? String(currentKm) : ""}
                />
              </Field>
            </div>
            <Button variant="outline" onClick={doEnd} disabled={end.isPending}>
              <ArrowRightLeft className="h-4 w-4" /> {t("fleet.detail.endAssignment")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-muted dark:text-muted-dark">{t("fleet.holder.idle")}</p>
      {manages && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Field label={t("fleet.detail.assignTo")} id="assign-user">
              <select
                id="assign-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="h-11 w-full rounded-xl border border-border bg-surface px-2.5 text-[15px] dark:border-border-dark dark:bg-surface-elev-dark"
              >
                <option value="">{t("fleet.detail.pickMember")}</option>
                {(members.data ?? [])
                  .filter((m) => m.status === "active")
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name ?? m.email ?? m.userId} · {t(`fleet.roles.${m.role}`)}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div className="w-40">
            <Field label={t("fleet.detail.startKm2")} hint={t("fleet.optional")}>
              <Input
                type="number"
                inputMode="numeric"
                value={startKm}
                onChange={(e) => setStartKm(e.target.value)}
                placeholder={currentKm != null ? String(currentKm) : ""}
              />
            </Field>
          </div>
          <Button variant="accent" onClick={doAssign} disabled={!userId || assign.isPending}>
            <UserPlus className="h-4 w-4" /> {t("fleet.detail.assign")}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── rental mode ──────────────────────────────────────────────────────────────

function ContractControls({
  orgId,
  bikeId,
  manages,
  currentKm,
}: {
  orgId: string;
  bikeId: string;
  manages: boolean;
  currentKm: number | null;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const open = useFleetContracts(orgId, { status: "open", bikeId });
  const customers = useFleetCustomers(orgId, "", manages);
  const create = useCreateContract(orgId);
  const close = useCloseContract(orgId);
  const cancel = useCancelContract(orgId);

  const [customerId, setCustomerId] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [handoverKm, setHandoverKm] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [returnKm, setReturnKm] = useState("");

  const current = open.data?.[0] ?? null;

  const doCreate = async () => {
    if (!customerId) return;
    try {
      await create.mutateAsync({
        bikeId,
        customerId,
        endsAt: endsAt || null,
        handoverKm: handoverKm ? Number(handoverKm) : null,
        dailyRate: dailyRate ? Number(dailyRate) : null,
      });
      setCustomerId("");
      setEndsAt("");
      setHandoverKm("");
      setDailyRate("");
      pushToast({ variant: "success", title: t("fleet.detail.contractOpened") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("fleet.detail.actionFailed"), description: friendlyError(e, t) });
    }
  };

  const doClose = async () => {
    if (!current) return;
    const ok = await confirm({
      title: t("fleet.detail.returnConfirm", { name: current.customer.name ?? "" }),
      confirmLabel: t("fleet.detail.markReturned"),
    });
    if (!ok) return;
    try {
      await close.mutateAsync({ id: current.id, returnKm: returnKm ? Number(returnKm) : null });
      setReturnKm("");
      pushToast({ variant: "success", title: t("fleet.detail.returned") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("fleet.detail.actionFailed"), description: friendlyError(e, t) });
    }
  };

  const doCancel = async () => {
    if (!current) return;
    // Cancelling is not returning: the vehicle never went out. Saying so in the
    // confirm keeps a rental company's books honest.
    const ok = await confirm({
      title: t("fleet.detail.cancelConfirm"),
      message: t("fleet.detail.cancelExplain"),
      confirmLabel: t("fleet.detail.cancelContract"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await cancel.mutateAsync(current.id);
      pushToast({ variant: "success", title: t("fleet.detail.cancelled") });
    } catch (e) {
      pushToast({ variant: "danger", title: t("fleet.detail.actionFailed"), description: friendlyError(e, t) });
    }
  };

  if (open.isPending) {
    return <p className="text-[13px] text-muted dark:text-muted-dark">{t("common.loading")}</p>;
  }

  if (current) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] font-semibold">{current.customer.name ?? current.customerId}</p>
        <p className="text-[12px] text-muted dark:text-muted-dark">
          {t("fleet.detail.since", { date: current.startedAt.slice(0, 10) })}
          {current.endsAt && ` · ${t("fleet.detail.dueBack", { date: current.endsAt.slice(0, 10) })}`}
          {current.handoverKm != null && ` · ${t("fleet.detail.handoverKm", { km: current.handoverKm })}`}
        </p>
        {manages && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Field label={t("fleet.detail.returnKm")} hint={t("fleet.optional")}>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={returnKm}
                  onChange={(e) => setReturnKm(e.target.value)}
                  placeholder={currentKm != null ? String(currentKm) : ""}
                />
              </Field>
            </div>
            <Button variant="accent" onClick={doClose} disabled={close.isPending}>
              <ArrowRightLeft className="h-4 w-4" /> {t("fleet.detail.markReturned")}
            </Button>
            <Button variant="ghost" onClick={doCancel} disabled={cancel.isPending}>
              {t("fleet.detail.cancelContract")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-muted dark:text-muted-dark">{t("fleet.holder.idle")}</p>
      {manages && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Field label={t("fleet.detail.rentTo")} id="contract-customer">
              <select
                id="contract-customer"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="h-11 w-full rounded-xl border border-border bg-surface px-2.5 text-[15px] dark:border-border-dark dark:bg-surface-elev-dark"
              >
                <option value="">{t("fleet.detail.pickCustomer")}</option>
                {(customers.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-44">
            <Field label={t("fleet.detail.endsAt")} hint={t("fleet.optional")}>
              <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
          </div>
          <div className="w-36">
            <Field label={t("fleet.detail.handoverKmLabel")} hint={t("fleet.optional")}>
              <Input
                type="number"
                inputMode="numeric"
                value={handoverKm}
                onChange={(e) => setHandoverKm(e.target.value)}
                placeholder={currentKm != null ? String(currentKm) : ""}
              />
            </Field>
          </div>
          <div className="w-36">
            <Field label={t("fleet.detail.dailyRate")} hint={t("fleet.optional")}>
              <Input
                type="number"
                inputMode="decimal"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
              />
            </Field>
          </div>
          <Button variant="accent" onClick={doCreate} disabled={!customerId || create.isPending}>
            <UserPlus className="h-4 w-4" /> {t("fleet.detail.openContract")}
          </Button>
        </div>
      )}
    </div>
  );
}
