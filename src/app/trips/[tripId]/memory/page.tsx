import { randomUUID } from "node:crypto";
import Image from "next/image";
import Link from "next/link";
import { Blossom } from "@/components/brand";
import { expenseTotals, wonLabel } from "@/lib/trip-budget";
import { loadBudget } from "@/lib/trip-budget-data";
import { dateLabel, isCalendarDate, japanDate } from "@/lib/trip-details";
import { loadTripMemory } from "@/lib/trip-memory-data";
import { memoryPhotoHref, tripMemoryDays, visitStatuses, type MemoryEntry, type MemoryPhoto } from "@/lib/trip-memory";
import { loadTripPlan } from "@/lib/trip-plan-data";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { dayNumber, TripTabs } from "../editorial";
import { deleteMemoryEntry, deleteMemoryPhoto, organizePhoto, saveMemoryEntry, saveMemoryPhoto, saveVisit, sweepMemoryPhotos } from "./actions";
import { MemoryForm } from "./memory-form";
import { PhotoQueueForm } from "./photo-queue-form";
import { saveQueuedMemoryPhoto } from "./actions";

export const metadata = { title: "여행 기억", robots: { index: false, follow: false } };
const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" });
type TripPlan = NonNullable<Awaited<ReturnType<typeof loadTripPlan>>>;

function PlaceChoices({ plan, value }: { plan: TripPlan; value?: string | null }) {
  return <label>연결 장소<select name="place" defaultValue={value ?? ""}>
    <option value="">선택 안 함</option>
    {plan.places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
  </select></label>;
}

function EntryFields({ day, plan, entry }: { day: string; plan: TripPlan; entry?: MemoryEntry }) {
  return <>
    <label>기록 날짜<input type="date" required name="day" defaultValue={entry?.day ?? day} /></label>
    <label>일기 제목<input required name="title" maxLength={100} defaultValue={entry?.title} /></label>
    <label>일기 본문<textarea required name="body" rows={5} maxLength={4000} defaultValue={entry?.body} /></label>
    <PlaceChoices plan={plan} value={entry?.place_id} />
    <label>연결 일정<select name="schedule" defaultValue={entry?.schedule_id ?? ""}>
      <option value="">선택 안 함</option>
      {plan.schedule.map((item) => <option key={item.id} value={item.id}>{item.local_date ?? "날짜 미정"} · {item.title}</option>)}
    </select></label>
  </>;
}

function PhotoFields({ day, plan, entries, photo, batch }: { day: string; plan: TripPlan; entries: MemoryEntry[]; photo?: MemoryPhoto; batch?: boolean }) {
  return <>
    {!photo && !batch && <>
      <label>사진 파일<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" /></label>
      <label>카메라로 촬영<input type="file" name="camera" accept="image/jpeg" capture="environment" /></label>
      <p className="plan-meta">JPEG·PNG·WebP를 올릴 수 있어요. 위치 등 사진 메타데이터는 저장 전에 제거해요.</p>
      <p className="plan-meta">큰 사진은 이 기기에서 먼저 줄여요. HEIC·HEIF 사진은 JPEG로 내보낸 뒤 첨부해 주세요.</p>
    </>}
    <label>사진 날짜<input type="date" required name="day" defaultValue={photo?.day ?? day} /></label>
    {!batch && <label>사진 제목<input required name="title" maxLength={100} defaultValue={photo?.title} /></label>}
    <label>사진 설명<textarea name="caption" rows={2} maxLength={500} defaultValue={photo?.caption ?? ""} /></label>
    <PlaceChoices plan={plan} value={photo?.place_id} />
    <label>연결 일기<select name="entry" defaultValue={photo?.entry_id ?? ""}>
      <option value="">선택 안 함</option>
      {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.day} · {entry.title}</option>)}
    </select></label>
  </>;
}

function PhotoImage({ photo, priority = false }: { photo: MemoryPhoto; priority?: boolean }) {
  return <Image unoptimized priority={priority} className="memory-image"
    src={memoryPhotoHref(photo.trip_id, photo.id)} alt={photo.title}
    width={photo.width ?? 1440} height={photo.height ?? 960} />;
}

export default async function Page({ params, searchParams }: PageProps<"/trips/[tripId]/memory">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const { data: trip, error } = await getTrip(tripId);
  if (!trip || error) return <TripLoadError />;
  const [memory, plan, ledger] = await Promise.all([loadTripMemory(tripId), loadTripPlan(tripId), loadBudget(tripId)]);
  const href = "/trips/" + tripId;
  if (!memory || !plan) return <div className="editorial-page suite-page"><TripLoadError /><TripTabs href={href} active="more" /></div>;
  const date = typeof query.date === "string" && isCalendarDate(query.date) ? query.date : "";
  const day = date || japanDate();
  const quick = query.write === "1";
  const entries = memory.entries;
  const photos = memory.photos.filter((photo) => photo.phase === "ready");
  const hasPending = photos.length !== memory.photos.length;
  const cover = photos.find(({ is_cover }) => is_cover);
  const days = date ? [date] : tripMemoryDays(entries, photos);
  const placeById = new Map(plan.places.map((place) => [place.id, place.name]));
  const scheduleById = new Map(plan.schedule.map((item) => [item.id, item.title]));
  const entryById = new Map(entries.map(({ id, title }) => [id, title]));
  const marks = new Map(memory.visits.map(({ schedule_id, status }) => [schedule_id, status]));
  const visitedPlaces = [...new Set(plan.schedule.flatMap((item) =>
    marks.get(item.id) === "visited" && item.place_id && placeById.has(item.place_id) ? [placeById.get(item.place_id)!] : []))];
  const visibleVisits = plan.schedule.filter((item) => !date || date === item.local_date);
  const canUpload = Boolean(process.env.SUPABASE_STORAGE_SECRET_KEY?.trim().startsWith("sb_secret_"));

  return <div className="editorial-page suite-page memory-page">
    <header className="memory-cover editorial-paper">
      <Link className="quiet-link" href={href + "/more"}>더보기</Link>
      {cover && <PhotoImage photo={cover} priority />}
      <Blossom className="memory-sprig" />
      <p className="editorial-kicker">記憶 · 여행 기록</p>
      <h1>여행 기억</h1>
      <h2>{trip.title}</h2>
      <p>{trip.start_date && trip.end_date
        ? dateLabel(trip.start_date) + " ~ " + dateLabel(trip.end_date) + " · " + dayNumber(trip.start_date, trip.end_date) + "일"
        : "여행 날짜 미정"}</p>
      <div className="suite-row">
        <a className="quiet-link" href="#write-memory">일기 쓰기</a>
        <a className="quiet-link" href="#add-photo">사진 추가</a>
        <a className="quiet-link" href="#visit-log">방문 기록</a>
      </div>
    </header>
    <div className="editorial-paper suite-stack">
      <details id="write-memory" open={quick || undefined}>
        <summary className="quiet-link">새 일기</summary>
        <MemoryForm action={saveMemoryEntry.bind(null, tripId, randomUUID(), false)} label="일기 저장">
          <EntryFields day={day} plan={plan} />
        </MemoryForm>
      </details>
      <details id="add-photo">
        <summary className="quiet-link">새 사진</summary>
        {canUpload ? <>
          <p>소유자만 볼 수 있어요. 여행당 24장, 계정당 120장까지 보관할 수 있어요.</p>
          <PhotoQueueForm action={saveQueuedMemoryPhoto.bind(null, tripId)} remaining={Math.max(0, 24 - memory.photos.length)}>
            <PhotoFields day={day} plan={plan} entries={entries} batch />
          </PhotoQueueForm>
        </> : <p className="plan-meta">사진 저장소가 준비되면 여기서 사진을 추가할 수 있어요.</p>}
      </details>
      {hasPending && <MemoryForm action={sweepMemoryPhotos.bind(null, tripId)} label="실패한 업로드와 삭제 정리" />}
    </div>
    <nav className="editorial-paper suite-row memory-days" aria-label="기록 날짜">
      <Link className="quiet-link" href={href + "/memory"} aria-current={!date ? "page" : undefined}>전체 기록</Link>
      {tripMemoryDays(entries, photos).map((entryDay) =>
        <Link key={entryDay} className="quiet-link" href={href + "/memory?date=" + entryDay}
          aria-current={entryDay === date ? "date" : undefined}>{dateLabel(entryDay)}</Link>)}
    </nav>
    <section aria-labelledby="memory-timeline" className="suite-stack">
      <h2 id="memory-timeline">날짜별 일기와 사진</h2>
      {!days.length && <p className="plan-empty">첫 기록을 남겨 보세요. 일정이나 장소 없이도 일기를 쓸 수 있어요.</p>}
      {days.map((entryDay) => {
        const notes = entries.filter((entry) => entry.day === entryDay);
        const gallery = photos.filter((photo) => photo.day === entryDay);
        return <section className="editorial-paper suite-stack" key={entryDay} aria-label={dateLabel(entryDay) + " 기록"}>
          <h3>{dateLabel(entryDay)}</h3>
          {!notes.length && !gallery.length && <p className="plan-meta">이 날짜에 저장한 기억이 없어요.</p>}
          {notes.map((entry) => <article className="memory-note suite-stack" key={entry.id}>
            <h4>{entry.title}</h4>
            <p className="memory-body">{entry.body}</p>
            <p className="plan-meta"><time dateTime={entry.created_at}>{dateTime.format(new Date(entry.created_at))}</time>
              {entry.place_id && placeById.get(entry.place_id) && " · " + placeById.get(entry.place_id)}
              {entry.schedule_id && scheduleById.get(entry.schedule_id) && " · " + scheduleById.get(entry.schedule_id)}</p>
            <details><summary className="quiet-link">일기 편집</summary>
              <MemoryForm action={saveMemoryEntry.bind(null, tripId, entry.id, true)} label="일기 수정 저장">
                <EntryFields day={entryDay} plan={plan} entry={entry} />
              </MemoryForm>
              <MemoryForm action={deleteMemoryEntry.bind(null, tripId, entry.id, entry.day)}
                label="일기 삭제" confirm="이 일기만 삭제할까요? 연결된 사진은 앨범에 남아요." />
            </details>
          </article>)}
          {!!gallery.length && <ul className="memory-gallery">{gallery.map((photo, index) => <li className="memory-card" key={photo.id}>
            <figure><PhotoImage photo={photo} /><figcaption>
              <strong>{photo.title}</strong>{photo.is_cover && <span className="plan-meta"> · 대표 사진</span>}
              {photo.caption && <p className="memory-body">{photo.caption}</p>}
              <p className="plan-meta">
                {[photo.entry_id && entryById.get(photo.entry_id), photo.place_id && placeById.get(photo.place_id)].filter(Boolean).join(" · ")}
              </p>
            </figcaption></figure>
            <details><summary className="quiet-link">사진 관리</summary>
              {canUpload && <MemoryForm action={saveMemoryPhoto.bind(null, tripId, photo.id, true)} label="사진 정보 저장">
                <PhotoFields day={entryDay} plan={plan} entries={entries} photo={photo} />
              </MemoryForm>}
              <div className="suite-row">
                {index > 0 && <MemoryForm action={organizePhoto.bind(null, tripId, photo.id, "earlier")} label="앞으로" />}
                {index < gallery.length - 1 && <MemoryForm action={organizePhoto.bind(null, tripId, photo.id, "later")} label="뒤로" />}
                {!photo.is_cover && <MemoryForm action={organizePhoto.bind(null, tripId, photo.id, "cover")} label="대표 사진으로" />}
                {canUpload && <MemoryForm action={deleteMemoryPhoto.bind(null, tripId, photo.id)}
                  label="사진 삭제" confirm="이 사진을 비공개 저장소에서도 삭제할까요?" />}
              </div>
            </details>
          </li>)}</ul>}
        </section>;
      })}
    </section>
    <section id="visit-log" className="editorial-paper suite-stack">
      <h2>방문 기록</h2>
      <p className="plan-meta">{visitedPlaces.length ? "방문한 장소 · " + visitedPlaces.join(" · ") : "방문 상태는 직접 바꿀 때 기록돼요."}</p>
      {visibleVisits.length ? <ul className="suite-stack">{visibleVisits.map((item) => <li key={item.id} className="memory-note">
        <strong>{item.title}</strong> <span className="plan-meta">{item.local_date ?? "날짜 미정"}</span>
        <MemoryForm action={saveVisit.bind(null, tripId, item.id)} label="방문 상태 저장">
          <label>방문 상태<select name="status" defaultValue={marks.get(item.id) ?? "planned"}>
            {Object.entries(visitStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </MemoryForm>
      </li>)}</ul> : <p>이 범위에 방문 상태를 기록할 일정이 없어요.</p>}
    </section>
    <footer className="editorial-paper suite-row">
      {ledger?.budget && <p>총지출 {wonLabel(expenseTotals(ledger.expenses).total)}</p>}
      <Link className="quiet-link" href={href + "/budget"}>경비와 정산</Link>
      <Link className="quiet-link" href={href + "/itinerary"}>여행 일정</Link>
      <Link className="quiet-link" href={href + "/guide"}>여행 가이드 출력</Link>
    </footer>
    <TripTabs href={href} active="more" />
  </div>;
}
