import Link from "next/link";

export function ErrorState({ retry }: { retry: () => void }) {
  return (
    <main id="main-content" className="route-state safe-page" tabIndex={-1}>
      <h1>잠시 문제가 생겼어요</h1>
      <p>화면을 다시 불러와 주세요.</p>
      <div className="state-actions">
        <button type="button" className="primary-button" onClick={retry}>다시 시도</button>
        <Link className="quiet-link" href="/">처음으로 돌아가기</Link>
      </div>
    </main>
  );
}
