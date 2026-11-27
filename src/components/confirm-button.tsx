"use client";

import { useState } from "react";

/**
 * Two-step destructive action shown inline in KIOKU's style instead of a browser confirm dialog.
 * Without onConfirm the second button submits its form with the given name and value.
 */
export function ConfirmButton({ label, confirmLabel, message, className = "quiet-link danger-link", name, value, disabled,
  onConfirm, formNoValidate }: {
  label: string; confirmLabel: string; message: string; className?: string; name?: string; value?: string;
  disabled?: boolean; onConfirm?: () => void; formNoValidate?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
  return <span className="confirm-inline" role="group" aria-label={label}>
    <span className="confirm-inline-message" role="status">{message}</span>
    <span className="confirm-inline-actions">
      <button type={onConfirm ? "button" : "submit"} name={onConfirm ? undefined : name} value={onConfirm ? undefined : value}
        className="quiet-link danger-link" disabled={disabled} formNoValidate={formNoValidate} autoFocus
        onClick={onConfirm ? () => { setArmed(false); onConfirm(); } : undefined}>{confirmLabel}</button>
      <button type="button" className="quiet-link" onClick={() => setArmed(false)}>취소</button>
    </span>
  </span>;
}
