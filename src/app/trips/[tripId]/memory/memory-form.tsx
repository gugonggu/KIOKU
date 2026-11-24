"use client";

import { useActionState, type ReactNode } from "react";

export function MemoryForm({ action, label, children, confirm }: {
  action: (state: string, form: FormData) => Promise<string>;
  label: string; children?: ReactNode; confirm?: string;
}) {
  const [message, submit, pending] = useActionState(action, "");
  return <form className={children ? "suite-form" : "memory-command"} action={submit} onSubmit={(event) => {
    if (confirm && !window.confirm(confirm)) event.preventDefault();
  }}>
    {children}
    <button className={children ? "primary-button" : "quiet-link"} disabled={pending} type="submit">
      {pending ? "처리 중…" : label}
    </button>
    {message && <p className="notice notice-error" role="alert">{message}</p>}
  </form>;
}
