"use client";

import { startTransition, useActionState, type ReactNode } from "react";

export function BudgetForm({ action, children, label, confirmDelete = false }: {
  action: (state: string, fields: FormData) => Promise<string>;
  children?: ReactNode; label: string; confirmDelete?: boolean;
}) {
  const [message, submit, pending] = useActionState(async (state: string, fields: FormData) => {
    const connectionError = "연결을 확인한 뒤 다시 시도해 주세요. 입력한 내용은 그대로예요.";
    if (!navigator.onLine) return connectionError;
    try {
      return await action(state, fields);
    } catch (error) {
      if (error instanceof TypeError) return connectionError;
      throw error;
    }
  }, "");
  return <form className="suite-form" action={submit} aria-busy={pending} onSubmit={(event) => {
    // Dispatch manually so a returned validation message does not auto-reset the form.
    event.preventDefault();
    if (pending || (confirmDelete && !window.confirm("이 지출을 삭제할까요?"))) return;
    const fields = new FormData(event.currentTarget);
    startTransition(() => submit(fields));
  }}>
    {children}
    <button type="submit" className="primary-button" disabled={pending}>{pending ? "처리 중…" : label}</button>
    {message && <p className="notice notice-error" role="alert">{message}</p>}
  </form>;
}
