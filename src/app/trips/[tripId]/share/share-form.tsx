"use client";

import { ConfirmButton } from "@/components/confirm-button";
import { Copy, Link2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { planCalendar } from "@/lib/trip-plan";
import type { ShareSettings } from "@/lib/trip-share-types";
import type { ShareActionState } from "./actions";

export function ShareForm({ settings, configured, save, reveal }: {
  settings: Omit<ShareSettings, "encryptedToken">; configured: boolean;
  save: (state: ShareActionState, form: FormData) => Promise<ShareActionState>;
  reveal: () => Promise<{ url?: string; error?: string }>;
}) {
  const [state, dispatch, pending] = useActionState(save, {});
  const [revealed, setRevealed] = useState<{ revision: number; url: string }>();
  const [notice, setNotice] = useState("");
  const [revealing, startReveal] = useTransition();
  const active = settings.enabled && !settings.expired;
  const url = active && revealed?.revision === settings.revision ? revealed.url : undefined;
  return <div className="share-settings-layout">
    <div className="editorial-paper share-settings-card">
      <div className="share-card-heading"><h2>공유 링크</h2>
        <span className="booking-badge" data-status={active ? "CONFIRMED" : "CANCELLED"}>
          {active ? "공유 중" : settings.expired ? "링크 만료" : "공유 꺼짐"}
        </span>
      </div>
      <p className="plan-meta">{active ? "링크를 받은 동행자는 로그인 없이 여행을 볼 수 있어요." : "공유를 켜면 읽기 전용 링크가 발급돼요."}</p>
      {active && <div className="state-actions">
        <button type="button" className="quiet-link" disabled={revealing || pending} onClick={() => startReveal(async () => {
          const result = await reveal();
          if (result.url) setRevealed({ revision: settings.revision, url: result.url });
          setNotice(result.error ?? "");
        })}><Link2 size={17} aria-hidden />링크 확인</button>
        {url && <button type="button" className="quiet-link" onClick={async () => {
          try { await navigator.clipboard.writeText(url); setNotice("링크를 복사했어요."); }
          catch { setNotice("주소를 선택해 직접 복사해 주세요."); }
        }}><Copy size={17} aria-hidden />링크 복사</button>}
      </div>}
      {url && <Input aria-label="동행자 공유 링크" value={url} readOnly onFocus={(event) => event.target.select()} />}
      {notice && <p role="status" className="plan-meta">{notice}</p>}
      {!configured && <p className="notice">링크를 발급하려면 서버의 공유 암호화 키가 필요해요.</p>}
    </div>
    <form action={dispatch} className="editorial-paper share-settings-card">
      <h2>공개할 정보</h2>
      <p className="plan-meta">여행 제목·일정·장소는 기본으로 표시돼요. 예약번호, 결제금액, 개인 메모는 동행자 화면에 포함되지 않아요.</p>
      <fieldset key={settings.revision} disabled={pending} className="plan-fields">
        <label className="share-option"><input type="checkbox" name="bookings" defaultChecked={settings.bookings} />항공·숙소·투어 일정</label>
        <label className="share-option"><input type="checkbox" name="notes" defaultChecked={settings.notes} />공유용 메모</label>
        <label className="form-field"><span>만료일 (일본 현지 날짜)</span>
          <Input name="expiry" {...planCalendar} defaultValue={settings.expiresOn ?? ""} />
        </label>
        <p className="plan-meta">만료일을 비우면 직접 중지할 때까지 열 수 있어요. 기한을 정하면 선택한 날짜가 끝날 때 만료돼요.</p>
        <button className="quiet-link" name="mode" value="settings">공유 설정 저장</button>
        <div className="state-actions">
          {settings.enabled ? <ConfirmButton className="primary-button" label="새 링크 발급" confirmLabel="새 링크 발급 확인"
            message="이전 링크는 즉시 만료돼요." name="mode" value="issue" disabled={!configured} />
            : <button className="primary-button" name="mode" value="issue" disabled={!configured}>링크 공유 켜기</button>}
          {settings.enabled && <ConfirmButton label="공유 중지" confirmLabel="공유 중지 확인"
            message="이전 링크로는 다시 열 수 없어요." name="mode" value="stop" formNoValidate />}
        </div>
      </fieldset>
      {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
      {state.message && <p className="plan-meta" role="status">{state.message}</p>}
    </form>
  </div>;
}
