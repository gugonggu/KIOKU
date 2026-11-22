import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { emptyTripForm } from "@/lib/trip-details";
import { createTrip } from "../mutations";
import { TripForm } from "../trip-form";

export const metadata = { title: "새 여행 만들기" };

export default async function NewTripPage() {
  await requireUser();
  const submit = createTrip.bind(null, crypto.randomUUID());
  return (
    <>
      <Link href="/trips" className="quiet-link"><ArrowLeft size={17} aria-hidden="true" />내 여행으로</Link>
      <h1>새 여행 만들기</h1>
      <p className="intro">여행 이름과 일본에서 머물 도시나 지역을 적어 주세요.</p>
      <TripForm action={submit} initial={emptyTripForm} cancelHref="/trips" submitLabel="여행 만들기" />
    </>
  );
}
