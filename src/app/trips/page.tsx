import { ArrowUpRight, Ellipsis, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Cover, DefaultTripCover } from "@/components/cover";
import { OfflineLibraryCleanup } from "@/components/offline-controls";
import { requireUser } from "@/lib/auth";
import { japanDate, tripStatus, tripStatuses, type Trip } from "@/lib/trip-details";
import { memoryPhotoHref } from "@/lib/trip-memory";
import { loadMemoryCovers } from "@/lib/trip-memory-data";
import { listTrips } from "@/lib/trips";
import { TripLoadError } from "./trip-load-error";
import { TripSummary } from "./trip-summary";

export const metadata = { title: "내 여행" };

function TripCard({ trip, cover }: { trip: Trip; cover?: { id: string; title: string } }) {
  const href = `/trips/${trip.id}`;
  return (
    <article className="trip-card">
      <Link className="trip-card-link" href={href} aria-labelledby={`trip-title-${trip.id}`}>
        {cover ? <div className="cover cover-compact trip-card-photo"><Image unoptimized fill
          src={memoryPhotoHref(trip.id, cover.id)} alt={cover.title} sizes="(max-width: 600px) 100vw, 340px" /></div>
          : <DefaultTripCover compact theme={trip.cover_theme} destination={trip.destination_label} />}
        <div className="trip-card-body">
          <h3 id={`trip-title-${trip.id}`}>{trip.title}</h3>
          <TripSummary trip={trip} />
          <span className="trip-card-open">여행 수첩 열기 <ArrowUpRight size={16} aria-hidden="true" /></span>
        </div>
      </Link>
      <details className="trip-card-menu">
        <summary aria-label={`${trip.title} 더보기`}><Ellipsis size={20} aria-hidden="true" /></summary>
        <div>
          <Link href={`${href}/edit`}>여행 편집</Link>
          <Link href={`${href}/delete`}>여행 삭제</Link>
        </div>
      </details>
    </article>
  );
}

export default async function TripsPage() {
  const { data: trips, error } = await listTrips();
  if (error) return <TripLoadError />;
  const owner = await requireUser();

  if (!trips.length) {
    return (
      <>
        <OfflineLibraryCleanup owner={owner} />
        <h1>내 여행</h1>
        <section className="empty-trips" aria-labelledby="empty-heading">
          <Cover compact />
          <div className="empty-trips-body">
            <h2 id="empty-heading">첫 여행을 준비해 볼까요?</h2>
            <p>아직 등록된 여행이 없어요.</p>
            <Link href="/trips/new" className="primary-button"><Plus size={18} aria-hidden="true" />첫 여행 만들기</Link>
          </div>
        </section>
      </>
    );
  }

  const covers = await loadMemoryCovers(trips.map(({ id }) => id));
  const today = japanDate();
  const groups: Record<keyof typeof tripStatuses, Trip[]> = { active: [], upcoming: [], unscheduled: [], past: [] };
  for (const trip of trips) groups[tripStatus(trip, today)].push(trip);
  groups.active.sort((a, b) => (a.end_date ?? "").localeCompare(b.end_date ?? ""));
  groups.upcoming.sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));
  groups.past.sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""));

  return (
    <>
      <OfflineLibraryCleanup owner={owner} />
      <div className="trips-heading">
        <h1>내 여행</h1>
        <Link href="/trips/new" className="primary-button"><Plus size={18} aria-hidden="true" />새 여행 만들기</Link>
      </div>
      {(Object.keys(groups) as Array<keyof typeof groups>).map((status) => groups[status].length > 0 && (
        <section key={status} className="trip-group" aria-labelledby={`trips-${status}`}>
          <h2 id={`trips-${status}`}>{tripStatuses[status].section}</h2>
          <div className="trip-card-grid">
            {groups[status].map((trip) => <TripCard key={trip.id} trip={trip} cover={covers.get(trip.id)} />)}
          </div>
        </section>
      ))}
    </>
  );
}
