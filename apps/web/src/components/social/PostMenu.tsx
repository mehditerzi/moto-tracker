import { useTranslation } from "react-i18next";
import { Ban, Flag, Trash2 } from "lucide-react";
import type { FeedPost } from "@mototracker/shared";
import { Sheet } from "@/components/share/ShareSheet";
import { useConfirm } from "@/components/ConfirmSheet";
import { useBlock, useDeletePost, useReport } from "@/hooks/useSocial";
import { pushToast } from "@/hooks/useToast";

/** The "…" on a post: delete your own; report the post or block its author. */
export function PostMenu({ post, onClose, onDeleted }: { post: FeedPost | null; onClose: () => void; onDeleted?: () => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const report = useReport();
  const block = useBlock();
  const del = useDeletePost();

  const run = async (what: "report" | "block" | "delete") => {
    if (!post) return;
    onClose();
    if (what === "delete") {
      if (!(await confirm({ title: t("social.deleteConfirm"), confirmLabel: t("common.delete"), destructive: true }))) return;
      await del.mutateAsync(post.id);
      onDeleted?.();
      return;
    }
    if (what === "report") {
      if (!(await confirm({ title: t("social.reportConfirm"), message: t("social.reportConfirmSub"), confirmLabel: t("rides.report"), destructive: true }))) return;
      await report.mutateAsync({ kind: "post", targetId: post.id, reason: "inappropriate" });
      pushToast({ variant: "success", title: t("rides.reported") });
      onDeleted?.();
      return;
    }
    if (!(await confirm({ title: t("social.blockConfirm", { name: post.author.displayName }), message: t("social.blockConfirmSub"), confirmLabel: t("social.block"), destructive: true }))) return;
    await block.mutateAsync({ userId: post.author.userId, block: true });
    pushToast({ variant: "success", title: t("social.blocked", { name: post.author.displayName }) });
    onDeleted?.();
  };

  const row = "flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium transition hover:bg-surface dark:hover:bg-surface-elev-dark";
  return (
    <Sheet open={!!post} onClose={onClose} title={t("social.postOptions")}>
      <div className="flex flex-col">
        {post?.isMine ? (
          <button type="button" className={`${row} text-danger`} onClick={() => void run("delete")}>
            <Trash2 className="h-5 w-5" /> {t("social.deletePost")}
          </button>
        ) : (
          <>
            <button type="button" className={row} onClick={() => void run("report")}>
              <Flag className="h-5 w-5" /> {t("social.reportPost")}
            </button>
            <button type="button" className={`${row} text-danger`} onClick={() => void run("block")}>
              <Ban className="h-5 w-5" /> {t("social.blockUser", { name: post?.author.displayName ?? "" })}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
