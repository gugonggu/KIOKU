export function Blossom({ className }: { className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 120 58" fill="none">
    <path d="M119 3C87 16 79 35 45 42c-12 2-22 3-36 12m82-29L68 16m-8 22L39 23m45 5 7 14" stroke="#9b7566" strokeWidth="1.7" strokeLinecap="round" />
    {[[66, 15], [38, 22], [91, 42], [51, 39], [26, 48], [100, 12], [78, 30]].map(([x, y]) =>
      <g key={x} transform={`translate(${x} ${y})`} fill="#edb6bd">
        <path d="M0-2C-7-5-8 1-3 2c-4 5 1 8 3 3 4 5 8 1 4-3 5-2 2-8-2-4 0-5-5-6-4 0Z" />
        <circle r="1.35" fill="#b66f5e" />
      </g>)}
  </svg>;
}

export function Brand() {
  return <div className="brand">
    <svg className="brand-illustration" aria-hidden="true" viewBox="0 0 72 45" fill="none">
      <circle cx="34" cy="17" r="13" fill="#edb6bd" />
      <path d="m1 42 14-7 14-13 7-10 10 12 10 10 15 8-19-4-12-4-4 6-5-6-9 3-21 5Z" fill="#738077" />
      <path d="m26 25 10-13 13 15-8-3-4 4-4-5-7 2Z" fill="#fcfaf6" />
      <path d="M70 12 54 26l-9 4m14-8-2-7" stroke="#996956" strokeWidth="1.2" />
      <g fill="#e8a4ad"><circle cx="65" cy="14" r="3.2" /><circle cx="57" cy="15" r="2.8" /><circle cx="53" cy="24" r="2.8" /><circle cx="48" cy="28" r="2.2" /></g>
    </svg>
    <span className="brand-type"><span className="brand-wordmark">KIOKU</span><span className="brand-subtitle">Japan Travel Planner</span></span>
  </div>;
}
