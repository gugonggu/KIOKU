"use client";

import { useActionState, type ReactNode } from "react";

export function BudgetForm({ action, children, label, confirmDelete = false }: {
  action: (state: string, fields: FormData) => Promise<string>;
  children?: ReactNode; label: string; confirmDelete?: boolean;
}) {
  const [message, submit, pending] = useActionState(action, "");
  return <form className="suite-stack" action={submit} onSubmit={(event) => {
    if (confirmDelete && !window.confirm("이 지출을 삭제할까요?")) event.preventDefault();
  }}>
    {children}
    <button type="submit" className="primary-button" disabled={pending}>{pending ? "처리 중…" : label}</button>
    {message && <p className="notice notice-error" role="alert">{message}</p>}
  </form>;
}
