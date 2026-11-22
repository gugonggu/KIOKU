export function Cover({ compact = false, label }: { compact?: boolean; label?: string }) {
  return (
    <div
      className={compact ? "cover cover-compact" : "cover"}
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
