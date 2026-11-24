"use client";

export function PrintButton({ budget }: { budget: boolean }) {
  return <button className="primary-button" type="button" onClick={() => {
    if (budget && !window.confirm("이 PDF에 소유자 전용 경비 요약을 포함할까요?")) return;
    window.print();
  }}>인쇄 / PDF로 저장</button>;
}
