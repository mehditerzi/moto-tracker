import * as React from "react";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";

type ToastVariant = "default" | "danger" | "success";
export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

type Listener = (toasts: Toast[]) => void;
let toasts: Toast[] = [];
const listeners: Listener[] = [];

function emit() {
  for (const l of listeners) l(toasts);
}

export function pushToast(t: Omit<Toast, "id">) {
  const id = Math.random().toString(36).slice(2, 9);
  const toast: Toast = { id, durationMs: 4000, ...t };
  // A subtle tactile confirmation on meaningful outcomes (native only).
  if (toast.variant === "success") hapticSuccess();
  else if (toast.variant === "danger") hapticWarning();
  toasts = [...toasts, toast];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    emit();
  }, toast.durationMs);
}

export function useToasts(): Toast[] {
  const [state, setState] = React.useState<Toast[]>(toasts);
  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const i = listeners.indexOf(setState);
      if (i >= 0) listeners.splice(i, 1);
    };
  }, []);
  return state;
}
