import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Flag, Send, Trash2 } from "lucide-react";
import type { FeedPost } from "@mototracker/shared";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/BackLink";
import { ErrorState } from "@/components/ErrorState";
import { useConfirm } from "@/components/ConfirmSheet";
import { FeedPostCard } from "@/components/social/FeedPostCard";
import { PostMenu } from "@/components/social/PostMenu";
import { RiderAvatar } from "@/components/social/RiderAvatar";
import { relTime } from "@/components/social/relTime";
import { useProfileGate } from "@/components/social/ProfileGate";
import { useComment, useDeleteComment, usePost, useReport } from "@/hooks/useSocial";
import { pushToast } from "@/hooks/useToast";
import { ApiError } from "@/lib/api";

export function PostPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const gate = useProfileGate();
  const post = usePost(id);
  const comment = useComment(id ?? "");
  const del = useDeleteComment();
  const report = useReport();
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<FeedPost | null>(null);
  const commentsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (post.data && window.location.hash === "#comments") commentsRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [post.data]);

  if (post.isLoading) return <Skeleton className="h-[420px] rounded-2xl" />;
  if (post.isError || !post.data) {
    const missing = post.error instanceof ApiError && post.error.status === 404;
    return (
      <div className="flex flex-col gap-5">
        <BackLink to="/rides" />
        {missing ? <Card className="p-6 text-center text-[15px] font-semibold">{t("social.postNotFound")}</Card> : <ErrorState onRetry={() => void post.refetch()} />}
      </div>
    );
  }
  const p = post.data;

  const send = () =>
    gate(async () => {
      const body = text.trim();
      if (!body) return;
      try {
        await comment.mutateAsync(body);
        setText("");
      } catch (e) {
        const code = e instanceof ApiError ? (e.body as { error?: string } | undefined)?.error : null;
        pushToast({ variant: "danger", title: code === "objectionable" ? t("social.objectionable") : t("errors.generic") });
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <BackLink to="/rides" />
      <FeedPostCard post={p} linkToDetail={false} onMenu={setMenu} />

      {p.kudosBy.length > 0 && (
        <p className="px-1 text-[13px] text-muted dark:text-muted-dark">
          🔥{" "}
          {p.kudosBy.slice(0, 3).map((k, i) => (
            <span key={k.handle}>
              {i > 0 && ", "}
              <Link to={`/u/${k.handle}`} className="font-medium text-text dark:text-text-dark">
                {k.displayName}
              </Link>
            </span>
          ))}
          {p.kudosBy.length > 3 && ` ${t("social.andOthers", { count: p.kudosBy.length - 3 })}`}
        </p>
      )}

      <section ref={commentsRef} id="comments" className="flex flex-col gap-2.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">
          {t("social.comments")}
        </h2>
        {p.commentList.length > 0 && (
          <Card className="divide-y divide-border p-0 dark:divide-border-dark">
            {p.commentList.map((c) => (
              <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                <Link to={`/u/${c.author.handle}`}>
                  <RiderAvatar name={c.author.displayName} handle={c.author.handle} className="h-8 w-8 text-[13px]" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]">
                    <Link to={`/u/${c.author.handle}`} className="font-semibold">{c.author.displayName}</Link>
                    <span className="ml-1.5 text-muted dark:text-muted-dark">{relTime(c.createdAt, i18n.language)}</span>
                  </div>
                  <p className="whitespace-pre-line text-[14.5px] leading-snug">{c.body}</p>
                </div>
                {c.isMine || p.isMine ? (
                  <button
                    type="button"
                    aria-label={t("common.delete")}
                    className="grid h-9 w-9 place-items-center rounded-full text-muted dark:text-muted-dark"
                    onClick={async () => {
                      if (await confirm({ title: t("social.deleteCommentConfirm"), confirmLabel: t("common.delete"), destructive: true })) del.mutate(c.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={t("rides.report")}
                    className="grid h-9 w-9 place-items-center rounded-full text-muted dark:text-muted-dark"
                    onClick={async () => {
                      if (!(await confirm({ title: t("social.reportCommentConfirm"), message: t("social.reportConfirmSub"), confirmLabel: t("rides.report"), destructive: true }))) return;
                      await report.mutateAsync({ kind: "comment", targetId: c.id, reason: "inappropriate" });
                      pushToast({ variant: "success", title: t("rides.reported") });
                    }}
                  >
                    <Flag className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </Card>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Input
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("social.commentPlaceholder")}
            enterKeyHint="send"
          />
          <Button type="submit" variant="accent" size="icon" className="h-11 w-11 shrink-0" disabled={!text.trim() || comment.isPending} aria-label={t("social.send")}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </section>
      <PostMenu post={menu} onClose={() => setMenu(null)} onDeleted={() => navigate("/rides", { replace: true })} />
    </div>
  );
}
