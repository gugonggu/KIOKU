"use client";
import Image from "next/image";
import { startTransition, useActionState, useState } from "react";
import { DefaultTripCover } from "@/components/cover";
import { coverThemes } from "@/lib/trip-cover";
import { memoryPhotoHref } from "@/lib/trip-memory";

export function CoverEditor({ action, tripId, destination, theme, photos, currentPhoto }: {
  action: (state: string, form: FormData) => Promise<string>; tripId: string; destination: string; theme?: string;
  photos: { id: string; title: string }[]; currentPhoto?: string;
}) {
  const [state, submit, pending] = useActionState(action, "");
  const [selected, setSelected] = useState(currentPhoto ? "photo:" + currentPhoto : "theme:" + (theme ?? "auto"));
  const photo = photos.find(row => "photo:" + row.id === selected);
  return <form action={submit} className="suite-form" onSubmit={event => {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "reset") fields.set("reset", "1");
    startTransition(() => submit(fields));
  }}>
    <fieldset disabled={pending} className="plan-fields">
      <label>表紙 · 여행 표지 선택<select name="cover" value={selected} onChange={event => setSelected(event.target.value)}>
        <optgroup label="기본 테마">{Object.entries(coverThemes).map(([key,label]) => <option key={key} value={"theme:" + key}>{label}</option>)}</optgroup>
        {photos.length > 0 && <optgroup label="여행 사진">{photos.map(row => <option key={row.id} value={"photo:" + row.id}>{row.title}</option>)}</optgroup>}
      </select></label>
      <div className="cover-editor-preview" aria-label="선택한 표지 미리보기">
        {photo ? <Image unoptimized src={memoryPhotoHref(tripId,photo.id)} alt={photo.title} width={480} height={240} className="memory-image" />
          : <DefaultTripCover destination={destination} theme={selected.slice(6)} />}
      </div>
      {!photo && <p>기본 표지를 사용 중이에요.</p>}
      <button className="primary-button" type="submit">{pending ? "저장 중…" : "표지 저장"}</button>
      <button className="quiet-link" type="submit" name="reset" value="1" onClick={()=>setSelected("theme:auto")}>기본 표지로 되돌리기</button>
    </fieldset>
    {state && <p role="status">{state}</p>}
  </form>;
}
