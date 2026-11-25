"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CHANGE, activateOfflineOwner, checkOfflineTrip, deleteOffline, offlineRevision, offlineSignoutPending, readOffline, saveOffline,
} from "../../public/offline-store.js";

type InstallEvent = Event & { prompt: () => Promise<void> };
type SavedStatus = "checking" | "unsaved" | "unknown" | "current" | "stale";
type OfflineState = { savedAt: string; status: SavedStatus };
const unopened: OfflineState = { savedAt: "", status: "checking" };
const unsaved: OfflineState = { savedAt: "", status: "unsaved" };
const freshnessLabel = {
  checking: "최신 여부 확인 중…", unsaved: "", unknown: "최신 여부를 확인하지 못했어요.",
  current: "저장한 수첩이 최신이에요.", stale: "저장 이후 수첩 내용이 바뀌었어요.",
};

function useOfflineStatus(owner: string, tripId: string) {
  const key = owner + ":" + tripId;
  const [state, setState] = useState<OfflineState & { key: string }>({ ...unopened, key });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let controller: AbortController | undefined;
    async function read() {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      function show(next: OfflineState) {
        if (!signal.aborted) setState({ ...next, key });
      }
      try {
        const library = await readOffline();
        const entry = library.owner === owner && !offlineSignoutPending()
          ? library.entries.find((item: { tripId: string }) => item.tripId === tripId) : undefined;
        if (!entry) return show(unsaved);
        if (!navigator.onLine) return show({ savedAt: entry.savedAt, status: "unknown" });
        show({ savedAt: entry.savedAt, status: "checking" });
        const request = new AbortController();
        const abortRequest = () => request.abort();
        signal.addEventListener("abort", abortRequest, { once: true });
        const timer = window.setTimeout(abortRequest, 5000);
        const status = await checkOfflineTrip(entry, request.signal);
        window.clearTimeout(timer);
        signal.removeEventListener("abort", abortRequest);
        if (signal.aborted) return;
        if (status === "missing") {
          await deleteOffline(tripId, owner, entry.savedAt);
          show(unsaved);
        } else if (status === "unverified") show({ savedAt: "", status: "unknown" });
        else show({ savedAt: entry.savedAt, status });
      } catch {
        show({ savedAt: "", status: "unknown" });
      }
    }
    function storageChanged(event: StorageEvent) {
      if (event.key === CHANGE) void read();
    }
    function visible() {
      if (!document.hidden) void read();
    }
    void read();
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    window.addEventListener("storage", storageChanged);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller?.abort();
      window.removeEventListener("online", read);
      window.removeEventListener("offline", read);
      window.removeEventListener("storage", storageChanged);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [key, owner, revision, tripId]);
  return {
    ...(state.key === key ? state : unopened),
    refresh: (next: OfflineState) => {
      setState({ ...next, key });
      setRevision((value) => value + 1);
    },
  };
}

function SavedDetails({ savedAt, status }: OfflineState) {
  return <>마지막 저장 <time dateTime={savedAt}>{new Date(savedAt).toLocaleString("ko-KR")}</time> · {freshnessLabel[status]}</>;
}

export function OfflineHomeStatus({ owner, tripId, upcoming }: { owner: string; tripId: string; upcoming: boolean }) {
  const state = useOfflineStatus(owner, tripId);
  const { savedAt, status } = state;
  return <section className="editorial-paper suite-stack">
    <h2>오프라인 수첩</h2>
    <p role="status">{savedAt ? <SavedDetails {...state} /> : status === "checking" ? "기기에 저장한 수첩 확인 중…"
      : status === "unknown" ? "기기의 저장 상태를 확인하지 못했어요."
      : upcoming ? "출발 전에 이 기기에 수첩을 저장해 두세요." : "이 기기에 저장된 수첩이 없어요."}</p>
    <div className="suite-row">
      <Link className="quiet-link" href={`/trips/${tripId}/offline`}>
        {status === "stale" ? "최신 수첩으로 갱신하기" : savedAt ? "수첩 관리" : "수첩 저장하기"}
      </Link>
      {savedAt && <a className="quiet-link" href={"/offline.html?trip=" + encodeURIComponent(tripId)}>저장된 수첩 열기</a>}
    </div>
  </section>;
}

export function OfflineLibraryCleanup({ owner }: { owner: string }) {
  useEffect(() => {
    const controller = new AbortController();
    async function removeDeletedCopies() {
      if (!navigator.onLine || offlineSignoutPending()) return;
      const library = await readOffline();
      if (library.owner !== owner) return;
      await Promise.all(library.entries.map(async (entry: { tripId: string; savedAt: string }) => {
        const status = await checkOfflineTrip(entry, controller.signal, true);
        if (status === "missing" && !controller.signal.aborted) await deleteOffline(entry.tripId, owner, entry.savedAt);
      }));
    }
    function check() {
      void removeDeletedCopies().catch(() => {});
    }
    check();
    window.addEventListener("online", check);
    return () => {
      controller.abort();
      window.removeEventListener("online", check);
    };
  }, [owner]);
  return null;
}

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
  const state = useOfflineStatus(owner, tripId);
  const { savedAt, refresh } = state;
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    let active = true;
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
  }, []);

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
      refresh({ savedAt: entry.savedAt, status: "current" });
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
    {savedAt && <p role="status"><SavedDetails {...state} /></p>}
    <div className="suite-row">
      <button className="quiet-link" type="button" disabled={pending} onClick={save}>{savedAt ? "최신 수첩으로 갱신" : "오프라인 수첩 저장"}</button>
      {savedAt && <a className="quiet-link" href={"/offline.html?trip=" + encodeURIComponent(tripId)}>저장된 수첩 열기</a>}
      {savedAt && <button className="quiet-link" type="button" disabled={pending} onClick={async () => {
        if (!window.confirm("이 기기에 저장한 수첩을 삭제할까요?")) return;
        try {
          await deleteOffline(tripId, owner);
          refresh(unsaved);
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
