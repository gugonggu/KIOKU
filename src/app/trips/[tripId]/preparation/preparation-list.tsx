"use client";

import { useActionState, useState } from "react";
import { preparationCategories, preparationProgress, type PreparationRow } from "@/lib/trip-preparation";
import { dateLabel } from "@/lib/trip-details";
import { updatePreparation } from "./actions";

function Fields({ item }: { item?: PreparationRow }) {
  return <>
    <label>항목 이름<input name="title" required maxLength={120} defaultValue={item?.title} /></label>
    <label>분류<select name="category" defaultValue={item?.category ?? "other"}>
      {Object.entries(preparationCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <label>준비 마감일<input name="due_date" type="date" defaultValue={item?.due_date ?? ""} /></label>
    <label>메모<textarea name="note" maxLength={600} defaultValue={item?.note ?? ""} placeholder="개인식별정보는 적지 마세요" /></label>
  </>;
}

export function PreparationList({ tripId, items }: { tripId: string; items: PreparationRow[] }) {
  const [message, action, pending] = useActionState(updatePreparation.bind(null, tripId), "");
  const [unfinished, setUnfinished] = useState(false);
  const progress = preparationProgress(items);
  return <>
    <section className="editorial-paper suite-stack" aria-label="여행 준비 진행률">
      <strong>{progress.total}개 중 {progress.done}개 완료 · {progress.percent}%</strong>
      <progress value={progress.done} max={progress.total || 1} aria-label="준비 완료율" />
      <label className="suite-check"><input type="checkbox" checked={unfinished} onChange={(e) => setUnfinished(e.target.checked)} /> 미완료만 보기</label>
    </section>
    <details className="editorial-paper suite-stack">
      <summary>준비 항목 추가</summary>
      <form action={action} className="suite-form">
        <input type="hidden" name="command" value="add" />
        <Fields />
        <button className="primary-button" disabled={pending}>항목 추가</button>
      </form>
    </details>
    <details className="editorial-paper suite-stack">
      <summary>여행 준비 템플릿</summary>
      <p className="plan-meta">여행에 맞게 추가하거나 수정할 수 있는 준비 예시예요.</p>
      <form action={action} className="state-actions">
        <button name="command" value="japan" className="quiet-link" disabled={pending}>일본 기본 템플릿</button>
        <button name="command" value="winter" className="quiet-link" disabled={pending}>겨울 여행 템플릿</button>
      </form>
    </details>
    {message && <p role="status" className="plan-meta">{message}</p>}
    {!items.length && <p className="plan-empty">준비 항목을 추가하거나 템플릿을 적용해 보세요.</p>}
    {unfinished && items.length > 0 && progress.done === progress.total && <p className="plan-empty">남은 준비 항목이 없어요.</p>}
    {Object.entries(preparationCategories).map(([category, label]) => {
      const group = items.filter((item) => item.category === category);
      const visible = unfinished ? group.filter((item) => !item.done) : group;
      if (!visible.length) return null;
      const { done, total } = preparationProgress(group);
      return <details key={category} open className="editorial-paper suite-stack">
        <summary>{label} <small>{done}/{total} 완료</small></summary>
        <ul className="suite-stack">{visible.map((item) => <li className="suite-entry" key={item.id}>
          <form action={action} className="suite-row">
            <input type="hidden" name="id" value={item.id} />
            <button className="quiet-link" aria-label={item.title + (item.done ? " 미완료로 변경" : " 완료")} name="command" value={item.done ? "open" : "done"} disabled={pending}>{item.done ? "✓ 완료" : "○ 미완료"}</button>
            <strong>{item.title}</strong>
          </form>
          {item.due_date && <p className="plan-meta">마감 {dateLabel(item.due_date)}</p>}
          {item.note && <p className="plan-meta">{item.note}</p>}
          <details>
            <summary>{item.title} 편집</summary>
            <form action={action} className="suite-form">
              <input type="hidden" name="id" value={item.id} />
              <Fields item={item} />
              <button className="primary-button" name="command" value="edit" disabled={pending}>변경 저장</button>
            </form>
            <form action={action} className="state-actions" onSubmit={(event) => {
              const button = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
              if (button?.value === "delete" && !confirm("이 준비 항목을 삭제할까요?")) event.preventDefault();
            }}>
              <input type="hidden" name="id" value={item.id} />
              <button className="quiet-link" name="command" value="up" disabled={pending}>위로</button>
              <button className="quiet-link" name="command" value="down" disabled={pending}>아래로</button>
              <button className="quiet-link danger-link" name="command" value="delete" disabled={pending}>삭제</button>
            </form>
          </details>
        </li>)}</ul>
      </details>;
    })}
  </>;
}
