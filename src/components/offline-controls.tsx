"use client";

import { useEffect, useState } from "react";
import { activateOfflineOwner, deleteOffline, offlineRevision, readOffline, saveOffline } from "../../public/offline-store.js";

type InstallEvent = Event & { prompt: () => Promise<void> };

export function OfflineAccount({ owner }: { owner: string }) {
  useEffect(() => {
    const revision = offlineRevision();
    void fetch("/api/offline/identity", { cache: "no-store" }).then(async (response) => {
      if (response.ok && (await response.json()).owner === owner) await activateOfflineOwner(owner, revision);
    }).catch(() => {});
    void navigator.serviceWorker?.register("/kioku-worker.js").catch(() => {});
  }, [owner]);
  return null;
}

export function OfflineControls({ owner, tripId }: { owner: string; tripId: string }) {
  const [savedAt, setSavedAt] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    let active = true;
    void readOffline().then((library) => {
      if (active && library.owner === owner) {
        setSavedAt(library.entries.find((entry: { tripId: string }) => entry.tripId === tripId)?.savedAt ?? "");
      }
    }).catch(() => {});
    let registration: ServiceWorkerRegistration | undefined;
    function checkUpdate() {
      if (active && registration?.waiting) setUpdate(registration.waiting);
    }
    function watchWorker() {
      registration?.installing?.addEventListener("statechange", checkUpdate);
    }
    function rememberInstall(event: Event) {
      event.preventDefault();
      setInstall(event as InstallEvent);
    }
    window.addEventListener("beforeinstallprompt", rememberInstall);
    void navigator.serviceWorker?.register("/kioku-worker.js").then((result) => {
      if (!active) return;
      registration = result;
      registration.addEventListener("updatefound", watchWorker);
      watchWorker();
      checkUpdate();
    }).catch(() => {});
    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", rememberInstall);
      registration?.removeEventListener("updatefound", watchWorker);
    };
  }, [owner, tripId]);

  async function save() {
    setPending(true);
    setMessage("");
    try {
      if (!navigator.serviceWorker || !globalThis.indexedDB) throw new Error("Offline storage unsupported");
      const response = await fetch("/api/offline/" + encodeURIComponent(tripId), { cache: "no-store" });
      if (!response.ok) throw new Error("Snapshot unavailable");
      const entry = await response.json();
      if (entry.owner !== owner || entry.tripId !== tripId) throw new Error("Snapshot mismatch");
      const registration = await navigator.serviceWorker.register("/kioku-worker.js");
      if (!registration.active) {
        const worker = registration.installing ?? registration.waiting;
        if (!worker) throw new Error("Offline shell unavailable");
        await new Promise<void>((resolve, reject) => {
          function check() {
            if (worker?.state === "activated") resolve();
            if (worker?.state === "redundant") reject(new Error("Offline shell installation failed"));
          }
          worker.addEventListener("statechange", check);
          check();
        });
      }
      const revision = offlineRevision();
      const identity = await fetch("/api/offline/identity", { cache: "no-store" });
      if (!identity.ok || (await identity.json()).owner !== owner) throw new Error("Offline account changed");
      await activateOfflineOwner(owner, revision);
      await saveOffline(entry);
      setSavedAt(entry.savedAt);
      setMessage("이 기기에 수첩을 저장했어요.");
    } catch {
      setMessage("수첩을 저장하지 못했어요. 로그인과 인터넷 연결을 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return <div className="editorial-paper suite-stack">
    <p>연결이 끊겨도 날짜별 일정, 장소 주소와 예약 일정을 읽을 수 있어요.</p>
    <p>수첩은 이 기기에 남아 원격으로 철회할 수 없어요. 공용 기기에서는 저장하지 마세요.</p>
    {savedAt && <p>마지막 저장 <time dateTime={savedAt}>{new Date(savedAt).toLocaleString("ko-KR")}</time> · 최근 변경사항은 다시 저장해 주세요.</p>}
    <div className="suite-row">
      <button className="quiet-link" type="button" disabled={pending} onClick={save}>{savedAt ? "최신 수첩으로 갱신" : "오프라인 수첩 저장"}</button>
      {savedAt && <a className="quiet-link" href={"/offline.html?trip=" + encodeURIComponent(tripId)}>저장된 수첩 열기</a>}
      {savedAt && <button className="quiet-link" type="button" disabled={pending} onClick={async () => {
        if (!window.confirm("이 기기에 저장한 수첩을 삭제할까요?")) return;
        try {
          await deleteOffline(tripId, owner);
          setSavedAt("");
          setMessage("기기에 저장된 수첩을 삭제했어요.");
        } catch { setMessage("삭제하지 못했어요. 다시 시도해 주세요."); }
      }}>저장한 수첩 삭제</button>}
    </div>
    <p role="status">{message}</p>
    <details>
      <summary className="quiet-link">홈 화면에 설치</summary>
      <p>Android Chrome은 브라우저 메뉴에서 앱 설치를 선택하세요. iPhone Safari는 공유 메뉴에서 홈 화면에 추가를 선택하세요.</p>
      {install && <button className="quiet-link" type="button" onClick={() => { void install.prompt(); setInstall(null); }}>KIOKU 설치</button>}
    </details>
    {update && <button className="quiet-link" type="button" onClick={() => {
      update.postMessage("activate-update");
      setUpdate(null);
      setMessage("다음에 수첩을 열면 새 버전을 사용해요.");
    }}>새 앱 버전 적용</button>}
  </div>;
}
