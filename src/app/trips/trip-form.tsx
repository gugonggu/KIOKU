"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { MAX_TRAVELERS, TRIP_TEXT_LIMIT, type TripFormValues } from "@/lib/trip-details";
import type { TripMutationState } from "./mutations";

type Props = {
  action: (state: TripMutationState, data: FormData) => Promise<TripMutationState>;
  initial: TripFormValues;
  cancelHref: string;
  submitLabel: string;
};

export function TripForm({ action, initial, cancelHref, submitLabel }: Props) {
  const [state, dispatch, pending] = useActionState<TripMutationState, FormData>(action, {});
  const [values, setValues] = useState(initial);

  function field(name: keyof TripFormValues, label: string, type: "text" | "date" | "number", required = false) {
    const error = state.errors?.[name];
    return (
      <div className="form-field">
        <label htmlFor={name}>{label}</label>
        <Input
          id={name}
          name={name}
          type={type}
          required={required}
          maxLength={type === "text" ? TRIP_TEXT_LIMIT : undefined}
          min={type === "date" ? "0001-01-01" : type === "number" ? 1 : undefined}
          max={type === "date" ? "9999-12-31" : type === "number" ? MAX_TRAVELERS : undefined}
          step={type === "number" ? 1 : undefined}
          inputMode={type === "number" ? "numeric" : undefined}
          value={values[name]}
          onChange={(event) => setValues({ ...values, [name]: event.target.value })}
          readOnly={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${name}-error` : undefined}
        />
        {error && <p id={`${name}-error`} className="field-error">{error}</p>}
      </div>
    );
  }

  return (
    <form className="trip-form" action={dispatch}>
      {field("title", "여행 이름", "text", true)}
      {field("destination_label", "목적지", "text", true)}
      <fieldset id="trip-dates" className="trip-dates">
        <legend>여행 기간 <span className="optional-label">선택</span></legend>
        <p>일정이 정해지면 나중에 입력해도 돼요.</p>
        <div className="trip-date-inputs">
          {field("start_date", "출발일", "date")}
          {field("end_date", "돌아오는 날", "date")}
        </div>
      </fieldset>
      {field("traveler_count", "여행 인원 (선택)", "number")}
      {state.message && !pending && <p className="notice notice-error" role="alert">{state.message}</p>}
      <div className="state-actions">
        <button type="submit" className="primary-button" disabled={pending || state.conflict}>
          {pending ? "저장 중…" : submitLabel}
        </button>
        <Link href={state.savedTripHref ?? cancelHref} className="quiet-link">
          {state.savedTripHref ? "저장된 여행 보기" : state.conflict ? "최신 여행 정보 보기" : "취소"}
        </Link>
      </div>
      {pending && <p className="sr-only" role="status">여행을 저장하는 중이에요.</p>}
    </form>
  );
}
