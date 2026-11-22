import { CalendarDays, MapPin, UsersRound } from "lucide-react";
import { dateLabel, durationLabel, type Trip } from "@/lib/trip-details";

export function TripSummary({ trip }: { trip: Trip }) {
  const { start_date: start, end_date: end } = trip;

  return (
    <div className="trip-summary">
      <p><MapPin size={17} aria-hidden="true" /><span>{trip.destination_label}</span></p>
      <p>
        <CalendarDays size={17} aria-hidden="true" />
        {start && end ? (
          <span>
            <time dateTime={start}>{dateLabel(start)}</time>
            {start !== end && <> – <time dateTime={end}>{dateLabel(end)}</time></>}
            <span className="trip-duration">{durationLabel(start, end)}</span>
          </span>
        ) : <span>날짜 미정</span>}
      </p>
      {trip.traveler_count !== null && <p><UsersRound size={17} aria-hidden="true" /><span>{trip.traveler_count}명</span></p>}
    </div>
  );
}
