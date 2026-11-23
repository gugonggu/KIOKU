"use client";

import { Copy, Navigation } from "lucide-react";
import { useState } from "react";

export function BookingLocation({ address, directions }: { address?: string | null; directions?: string | null }) {
  const [message, setMessage] = useState("");
  return <div className="booking-location">
    <div className="state-actions">
      {address && <button type="button" className="quiet-link" onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setMessage("주소를 복사했어요.");
        } catch {
          setMessage("복사할 수 없어요. 주소를 선택해 주세요.");
        }
      }}><Copy size={16} aria-hidden />주소 복사</button>}
      {directions && <a className="quiet-link" href={directions} target="_blank" rel="noopener noreferrer">
        <Navigation size={16} aria-hidden />Google Maps 길찾기
      </a>}
    </div>
    {message && <p className="plan-meta" role="status">{message}</p>}
  </div>;
}
