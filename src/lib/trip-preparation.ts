export const preparationCategories = {
  entry: "여권 및 입국 준비", flight: "항공권", stay: "숙박", transport: "교통",
  tour: "관광 및 투어 예약", online: "통신 및 인터넷", money: "환전 및 결제",
  insurance: "여행 보험", packing: "짐 싸기", other: "기타",
} as const;

export type PreparationCategory = keyof typeof preparationCategories;
export type PreparationRow = {
  id: string;
  trip_id: string;
  title: string;
  category: PreparationCategory;
  done: boolean;
  due_date: string | null;
  note: string | null;
  sort_order: number;
  source: string | null;
};

const templates: Record<"japan" | "winter", [PreparationCategory, string][]> = {
  japan: [
    ["entry", "여권 유효기간 확인"], ["entry", "Visit Japan Web 이용 검토"], ["flight", "항공권 예약"],
    ["stay", "숙소 예약"], ["transport", "공항 이동 확인"], ["tour", "예약 내역 확인"],
    ["online", "eSIM 또는 로밍 준비"], ["money", "엔화 환전"], ["money", "해외 결제 카드 확인"],
    ["insurance", "여행자보험 가입 확인"], ["packing", "충전기"], ["packing", "보조배터리"],
    ["packing", "상비약"], ["packing", "여행용 어댑터"],
  ],
  winter: ["방한복", "장갑", "목도리", "방한 신발", "미끄럼 방지 용품", "핫팩", "보습용품"].map((title) => ["packing", title]),
};

export function preparationTemplate(name: keyof typeof templates) {
  return templates[name].map(([category, title], index) => ({ category, title, source: name + "-" + index }));
}

export function preparationProgress(items: readonly { done: boolean }[]) {
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  return { total, done, percent: total ? Math.round(100 * done / total) : 0 };
}
