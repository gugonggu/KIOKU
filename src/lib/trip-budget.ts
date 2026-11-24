export const expenseCategories = {
  flight: "항공", stay: "숙박", transit: "교통", food: "식비", cafe: "카페 및 간식",
  sightseeing: "관광", shopping: "쇼핑", tour: "투어", internet: "통신", insurance: "보험", other: "기타",
} as const;

export type ExpenseCategory = keyof typeof expenseCategories;
export type Budget = { trip_id: string; budget_krw: number; rate: number; people: string[] };
export type ExpenseFields = {
  title: string; amount: number; refund: number; currency: "KRW" | "JPY"; rate: number;
  spent_on: string; category: ExpenseCategory; payer: number; shares: number[];
  method: string | null; prepaid: boolean; note: string | null; booking_id: string | null;
};
export type Expense = ExpenseFields & { id: string; trip_id: string; revision: number };

export function parseRate(value: string) {
  const match = /^(\d{1,2})(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) return null;
  const rate = Number(match[1]) * 10000 + Number((match[2] ?? "").padEnd(4, "0"));
  return rate > 0 ? rate : null;
}

type SettlementInput = Pick<ExpenseFields, "amount" | "refund" | "currency" | "rate" | "payer" | "shares" | "category" | "prepaid">;

export function expenseWon(expense: SettlementInput) {
  const net = BigInt(expense.amount - expense.refund);
  return expense.currency === "KRW" ? net : (net * BigInt(expense.rate) + BigInt(5000)) / BigInt(10000);
}

export function expenseTotals(expenses: SettlementInput[]) {
  const totals = { total: BigInt(0), prepaid: BigInt(0), local: BigInt(0), krw: BigInt(0), jpy: BigInt(0),
    categories: new Map<ExpenseCategory, bigint>() };
  for (const expense of expenses) {
    const won = expenseWon(expense);
    totals.total += won;
    totals[expense.prepaid ? "prepaid" : "local"] += won;
    totals[expense.currency === "JPY" ? "jpy" : "krw"] += BigInt(expense.amount - expense.refund);
    totals.categories.set(expense.category, (totals.categories.get(expense.category) ?? BigInt(0)) + won);
  }
  return totals;
}

export function settleExpenses(personCount: number, expenses: SettlementInput[]) {
  const people = Array.from({ length: personCount }, (_, index) => ({ id: index + 1, paid: BigInt(0), due: BigInt(0) }));
  for (const expense of expenses) {
    const won = expenseWon(expense);
    people[expense.payer - 1].paid += won;
    const shares = [...expense.shares].sort((a, b) => a - b);
    const count = BigInt(shares.length);
    shares.forEach((id, index) => {
      people[id - 1].due += won / count + BigInt(index < Number(won % count) ? 1 : 0);
    });
  }
  const balances = people.map(({ id, paid, due }) => ({ id, balance: paid - due }));
  const receivers = balances.filter(({ balance }) => balance > BigInt(0));
  const payers = balances.filter(({ balance }) => balance < BigInt(0));
  const transfers: { from: number; to: number; amount: bigint }[] = [];
  let receiverIndex = 0;
  for (const payer of payers) {
    while (payer.balance < BigInt(0)) {
      const receiver = receivers[receiverIndex];
      const amount = receiver.balance < -payer.balance ? receiver.balance : -payer.balance;
      transfers.push({ from: payer.id, to: receiver.id, amount });
      payer.balance += amount;
      receiver.balance -= amount;
      if (receiver.balance === BigInt(0)) receiverIndex++;
    }
  }
  return { people, transfers };
}

export function wonLabel(value: bigint | number) {
  return value.toLocaleString("ko-KR") + "원";
}
