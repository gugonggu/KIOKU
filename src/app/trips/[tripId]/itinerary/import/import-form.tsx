"use client";

import { useActionState, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { importLimits, normalizeTripImportText, parseTripImport } from "@/lib/trip-import";
import { periods } from "@/lib/trip-plan";
import type { ScheduleImportState } from "./actions";

const label = { new: "추가 예정", duplicate: "중복 · 건너뜀", outside: "여행 기간 밖" } as const;
const subscribeToHydration = () => () => {};

export function ScheduleImportForm({ action }: { action: (state: ScheduleImportState, form: FormData) => Promise<ScheduleImportState> }) {
  const [state, submit, pending] = useActionState(action, {});
  const [input, setInput] = useState("");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const preview = !reading && !readError && state.input === input ? state.preview : undefined;
  const canSave = preview?.some(({ status }) => status === "new") && !preview.some(({ status }) => status === "outside");

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    event.currentTarget.value = "";
    if (!/\.json$/i.test(file.name)) {
      setReadError(".json 파일을 선택해 주세요.");
      return;
    }
    if (file.size > importLimits.fileBytes) {
      setReadError("80KB 이하의 JSON 파일을 선택해 주세요.");
      return;
    }
    setReadError("");
    setReading(true);
    try {
      const text = normalizeTripImportText(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
      const result = parseTripImport(text);
      if ("error" in result) {
        setReadError(result.error);
        return;
      }
      setInput(text);
    } catch {
      setReadError("파일을 읽을 수 없어요. UTF-8 JSON 파일인지 확인해 주세요.");
    } finally {
      setReading(false);
    }
  }

  return <form className="editorial-paper suite-form" action={submit}>
    <label>JSON 파일 선택<input type="file" accept=".json,application/json" disabled={!hydrated || reading || pending}
      aria-invalid={readError ? true : undefined} aria-describedby={readError ? "schedule-import-file-error" : undefined}
      onChange={readFile} /></label>
    <label>일정 JSON<textarea name="schedule_json" required rows={8} maxLength={importLimits.text}
      value={input} readOnly={reading} onChange={(event) => { setInput(normalizeTripImportText(event.target.value)); setReadError(""); }}
      placeholder={'[{"title":"오타루 운하","date":"2027-02-19","time":"14:00"},{"title":"여유 시간"}]'} /></label>
    <p className="plan-meta">제목만 쓰면 후보함에 들어가요. 날짜는 연-월-일이고 시각은 일본 현지 기준이에요.</p>
    <button className="quiet-link" type="submit" name="intent" value="preview" disabled={pending || reading}>가져오기 미리보기</button>
    {reading && <p role="status">JSON 파일을 읽고 있어요.</p>}
    {readError && <p id="schedule-import-file-error" className="notice notice-error" role="alert">{readError}</p>}
    {!reading && !readError && state.message && <p className={state.complete ? "notice" : "notice notice-error"} role={state.complete ? "status" : "alert"}>{state.message}</p>}
    {preview && <section aria-label="가져오기 결과 미리보기" className="suite-stack">
      <h2>저장 전 확인</h2>
      <ul className="suite-stack">{preview.map((row, index) => <li className="suite-entry" key={index}>
        <strong>{row.title}</strong>
        <p className="plan-meta">{row.local_date ?? "후보함"} · {row.fixed_local_time ?? (row.period ? periods[row.period] : "시간 미정")}{row.end_local_time && "–" + row.end_local_time} · {label[row.status]}</p>
      </li>)}</ul>
      {preview.some(({ status }) => status === "outside") && <p className="plan-meta">여행 기간 밖 날짜를 고친 뒤 다시 미리보기 해 주세요.</p>}
      {canSave && <button className="primary-button" type="submit" name="intent" value="apply" disabled={pending}>확인하고 일정 추가</button>}
    </section>}
  </form>;
}
