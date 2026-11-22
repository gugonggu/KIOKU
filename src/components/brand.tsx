import { BookOpen } from "lucide-react";

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><BookOpen aria-hidden="true" size={18} strokeWidth={1.7} /></span>
      <span className="brand-wordmark">KIOKU</span>
      <span className="brand-subtitle">Japan Travel Planner</span>
    </div>
  );
}
