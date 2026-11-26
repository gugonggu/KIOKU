import { defaultCoverTheme } from "@/lib/trip-cover";

export function DefaultTripCover({ compact = false, theme, destination }: { compact?: boolean; theme?: string | null; destination: string }) {
  return <Cover compact={compact} theme={defaultCoverTheme(theme,destination)} label="기본 여행 표지" />;
}

export function Cover({ compact = false, label, theme }: { compact?: boolean; label?: string; theme?: string }) {
  return (
    <div
      className={compact ? "cover cover-compact" : "cover"}
      data-theme={theme}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <div className="cover-sun" />
      <div className="cover-ridge ridge-distant" />
      <div className="cover-ridge ridge-middle" />
      <div className="cover-ridge ridge-near" />
      <div className="cover-frame" />
    </div>
  );
}
