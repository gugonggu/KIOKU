import Link from "next/link";

export default function TripNotFound() {
  return (
    <section className="trip-load-error">
      <h1>여행을 찾을 수 없어요</h1>
      <p className="intro">주소를 확인하거나 내 여행 목록으로 돌아가 주세요.</p>
      <Link href="/trips" className="primary-button">내 여행으로</Link>
    </section>
  );
}
