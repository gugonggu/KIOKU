"use client";

import { useActionState, useState, type ReactNode } from "react";
import { memoryPhotoInputError, selectedMemoryPhotos } from "@/lib/memory-photo-input";

export function MemoryForm({ action, label, children, confirm, photoUpload }: {
  action: (state: string, form: FormData) => Promise<string>;
  label: string; children?: ReactNode; confirm?: string; photoUpload?: boolean;
}) {
  const [message, submit, pending] = useActionState(action, "");
  const [inputError, setInputError] = useState("");
  const alert = inputError || message;
  return <form className={children ? "suite-form" : "memory-command"} action={submit} onSubmit={(event) => {
    if (confirm && !window.confirm(confirm)) event.preventDefault();
    if (photoUpload) {
      const error = memoryPhotoInputError(selectedMemoryPhotos(new FormData(event.currentTarget)));
      setInputError(error);
      if (error) event.preventDefault();
    }
  }}>
    {children}
    <button className={children ? "primary-button" : "quiet-link"} disabled={pending} type="submit">
      {pending ? "처리 중…" : label}
    </button>
    {alert && <p className="notice notice-error" role="alert">{alert}</p>}
  </form>;
}
