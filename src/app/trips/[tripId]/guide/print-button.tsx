"use client";

export function PrintButton() {
  return <button className="primary-button" type="button" onClick={() => window.print()}>인쇄 / PDF로 저장</button>;
}
