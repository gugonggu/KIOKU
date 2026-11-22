import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="route-state safe-page" tabIndex={-1}>
      <h1>페이지를 찾을 수 없어요</h1>
      <p>주소를 확인하거나 처음 화면으로 돌아가 주세요.</p>
      <Link className="primary-button" href="/">처음으로 돌아가기</Link>
    </main>
  );
}
