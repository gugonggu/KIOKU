export const coverThemes = { auto: "지역에 맞게", mountain: "초록 산", sea: "푸른 바다", dusk: "노을", winter: "겨울 거리" } as const;
export type CoverTheme = keyof typeof coverThemes;
export function defaultCoverTheme(theme: string | null | undefined, destination: string): Exclude<CoverTheme,"auto"> {
  if (theme && theme !== "auto" && Object.hasOwn(coverThemes,theme)) return theme as Exclude<CoverTheme,"auto">;
  return /삿포로|홋카이도|札幌|北海道|sapporo|hokkaido/i.test(destination) ? "winter" : "mountain";
}
