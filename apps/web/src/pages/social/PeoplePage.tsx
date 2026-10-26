import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/BackLink";
import { PersonRow } from "@/components/social/PersonRow";
import { usePeople, useSearchRiders, useSuggestions } from "@/hooks/useSocial";

/** /people — find riders: search by name or @handle, plus suggestions. */
export function PeoplePage() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const search = useSearchRiders(debounced);
  const sugg = useSuggestions();
  const searching = debounced.length >= 2;
  const list = searching ? search.data : sugg.data;

  return (
    <div className="flex flex-col gap-4">
      <BackLink to="/rides" />
      <h1 className="text-[26px] font-semibold leading-none tracking-tight">{t("social.findRiders")}</h1>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted dark:text-muted-dark" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("social.searchPlaceholder")}
          className="pl-10"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="search"
        />
      </div>
      {!searching && <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">{t("social.suggested")}</h2>}
      {(searching ? search.isLoading : sugg.isLoading) ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !list || list.length === 0 ? (
        <Card className="p-6 text-center text-[13.5px] text-muted dark:text-muted-dark">
          {searching ? t("social.noResults") : t("social.noSuggestions")}
        </Card>
      ) : (
        <Card className="divide-y divide-border p-0 dark:divide-border-dark">
          {list.map((p) => (
            <PersonRow key={p.userId} person={p} />
          ))}
        </Card>
      )}
    </div>
  );
}

/** /u/:handle/followers and /u/:handle/following. */
export function PeopleListPage() {
  const { handle } = useParams();
  const { t } = useTranslation();
  const which = useLocation().pathname.endsWith("/following") ? "following" : "followers";
  const people = usePeople(handle, which);
  return (
    <div className="flex flex-col gap-4">
      <BackLink to={`/u/${handle}`} />
      <h1 className="text-[24px] font-semibold leading-none tracking-tight">
        {which === "followers" ? t("social.followers") : t("social.followingCount")}
      </h1>
      {people.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !people.data?.length ? (
        <Card className="p-6 text-center text-[13.5px] text-muted dark:text-muted-dark">{t("social.nobodyYet")}</Card>
      ) : (
        <Card className="divide-y divide-border p-0 dark:divide-border-dark">
          {people.data.map((p) => (
            <PersonRow key={p.userId} person={p} />
          ))}
        </Card>
      )}
    </div>
  );
}
