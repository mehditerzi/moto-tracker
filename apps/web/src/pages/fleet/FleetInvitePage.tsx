import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Building2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyError } from "@/lib/apiError";
import { pushToast } from "@/hooks/useToast";
import { useMe } from "@/hooks/useMe";
import { ORGS_KEY } from "@/hooks/useOrgs";
import { acceptInvite, previewInvite, type InvitePreview } from "@/hooks/useFleetData";

/**
 * `/fleet/invite#token=…` — the invitee's side of joining an organization.
 *
 * THE TOKEN RIDES IN THE URL FRAGMENT, not a query string, and that is the whole
 * reason this route exists separately. A fragment is never sent to any server,
 * so the link cannot end up in our access log, a proxy's, or a `Referer` header
 * on the way to a third party. It is read once into component state and then
 * scrubbed from the address bar, so it also stops sitting in browser history.
 *
 * With no token this is not a fleet screen at all: it redirects to the consumer
 * dashboard, so a curious consumer who types the URL learns nothing (§1). And it
 * lives OUTSIDE the fleet layout's membership gate on purpose — the whole point
 * is that the caller is not a member yet.
 */
export function FleetInvitePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();

  const [token] = useState(() => readTokenFromFragment());
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    // Take the capability out of the address bar as soon as it is in memory.
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      /* non-browser / blocked history — harmless */
    }
    let cancelled = false;
    setLoading(true);
    previewInvite(token)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e) => {
        if (!cancelled) setError(friendlyError(e, t));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  if (!token) return <Navigate to="/dashboard" replace />;

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const res = await acceptInvite(token);
      await qc.invalidateQueries({ queryKey: ORGS_KEY });
      pushToast({ variant: "success", title: t("fleet.invite.joined", { name: res.name }) });
      // A driver gets no fleet UI (§3) — send them to the consumer dashboard,
      // which is their entire experience of the organization.
      navigate(res.role === "driver" ? "/dashboard" : "/fleet", { replace: true });
    } catch (e) {
      setError(friendlyError(e, t));
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5 py-6">
      {loading ? (
        <>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-32 rounded-2xl" />
        </>
      ) : preview ? (
        <>
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-elev ring-1 ring-border dark:bg-surface-elev-dark dark:ring-border-dark">
              <Building2 className="h-6 w-6 text-muted dark:text-muted-dark" strokeWidth={1.7} aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="label-micro text-muted dark:text-muted-dark">{t("fleet.invite.title")}</p>
              <h1 className="mt-1 truncate text-[24px] font-semibold leading-none tracking-tight">
                {preview.orgName}
              </h1>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface/70 p-4 dark:border-border-dark dark:bg-surface-dark/60">
            <dl className="flex flex-col gap-2 text-[14px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted dark:text-muted-dark">{t("fleet.invite.role")}</dt>
                <dd className="font-medium">{t(`fleet.roles.${preview.role}`)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted dark:text-muted-dark">{t("fleet.invite.invitedEmail")}</dt>
                <dd className="truncate font-medium">{preview.email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted dark:text-muted-dark">{t("fleet.invite.expires")}</dt>
                <dd className="num">{preview.expiresAt.slice(0, 10)}</dd>
              </div>
            </dl>
          </div>

          <p className="flex items-start gap-2 text-pretty text-[13px] text-muted dark:text-muted-dark">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{t(`fleet.invite.explain.${preview.role === "driver" ? "driver" : "manager"}`)}</span>
          </p>

          {!preview.emailMatches ? (
            <p role="alert" className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-[13px]">
              {t("fleet.invite.wrongAccount", {
                invited: preview.email,
                current: me.data?.user.email ?? "",
              })}
            </p>
          ) : (
            <Button variant="accent" size="lg" onClick={accept} disabled={accepting}>
              {t("fleet.invite.join", { name: preview.orgName })}
            </Button>
          )}

          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <h1 className="text-[20px] font-semibold tracking-tight">{t("fleet.invite.unusable")}</h1>
          <p className="text-pretty text-[14px] text-muted dark:text-muted-dark">
            {error ?? t("fleet.invite.unusableSub")}
          </p>
          <Button variant="outline" onClick={() => navigate("/dashboard", { replace: true })}>
            {t("fleet.invite.backHome")}
          </Button>
        </div>
      )}
    </div>
  );
}

function readTokenFromFragment(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const token = new URLSearchParams(hash).get("token");
  return token && token.length > 0 ? token : null;
}
