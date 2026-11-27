import { CHANGE, activateOfflineOwner, checkOfflineTrip, deleteOffline, offlineRevision, offlineSignoutPending, readOffline } from "./offline-store.js";

const content = document.querySelector("#offline-content");
const status = document.querySelector("#offline-status");
let renderVersion = 0;
const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const bookingLabels = { CANCELLED: "취소됨", CONFIRMED: "예약 완료", PENDING: "예약 진행 중", NEEDS_BOOKING: "예약 필요" };
// The service worker serves this shell at a trip URL when the network fails. Read the trip from either form.
const pathTrip = location.pathname.match(/^\/trips\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
const shellAtTripUrl = location.pathname !== "/offline.html";

if (shellAtTripUrl) {
  const note = document.createElement("p");
  note.className = "offline-banner";
  note.textContent = "인터넷 연결이 없어 이 기기에 저장한 수첩을 보여 드려요. 다시 연결되면 원래 화면으로 돌아가요.";
  status.before(note);
}
const noneSaved = "이 기기에 저장된 수첩이 없습니다." + (shellAtTripUrl ? " 인터넷에 연결한 뒤 여행 화면의 오프라인 수첩에서 미리 저장해 두세요." : "");

function dateText(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "";
  const [year, month, day] = value.split("-").map(Number);
  return `${year}. ${month}. ${day}. (${weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]})`;
}

function dayNumber(start, value) {
  if (!start || !value) return null;
  const days = Math.round((Date.parse(value + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000);
  return days >= 0 ? days + 1 : null;
}

function element(tag, label, parent) {
  const node = document.createElement(tag);
  if (label) node.textContent = label;
  parent.append(node);
  return node;
}

function placeDetails(place, parent) {
  if (!place) return;
  element("p", [place.name, place.address].filter(Boolean).join(" · "), parent);
  const query = place.latitude != null && place.longitude != null
    ? place.latitude + "," + place.longitude : [place.name, place.address].filter(Boolean).join(" ");
  const url = new URL("https://www.google.com/maps/search/");
  url.search = new URLSearchParams({ api: "1", query });
  element("a", "외부 지도에서 열기 (인터넷 필요)", parent).href = url.href;
}

function scheduleTime(item) {
  return item.fixed_local_time?.slice(0, 5)
    ?? ({ MORNING: "00:00", AFTERNOON: "12:00", EVENING: "18:00" }[item.period] ?? "24:00");
}

function showTrip(entry, freshness) {
  const trip = entry.snapshot;
  element("h2", trip.title, content);
  element("p", [trip.destination, trip.startDate && trip.endDate ? dateText(trip.startDate) + " – " + dateText(trip.endDate) : ""].filter(Boolean).join(" · "), content);
  element("p", "마지막 저장 " + new Date(entry.savedAt).toLocaleString("ko-KR"), content);
  if (freshness === "stale") element("p", "저장 이후 수첩 내용이 바뀌었어요.", content);
  if (freshness === "current") element("p", "저장한 수첩이 최신이에요.", content);
  if (freshness === "unknown") element("p", "최신 여부를 확인하지 못했어요.", content);
  if (freshness === "stale" || freshness === "current") {
    element("a", "최신 수첩으로 갱신하기", content).href = "/trips/" + encodeURIComponent(entry.tripId) + "/offline";
  }
  let currentDate;
  let day;
  const schedule = [...trip.schedule].sort((first, second) =>
    first.date.localeCompare(second.date) || scheduleTime(first).localeCompare(scheduleTime(second)));
  const days = [...new Set(schedule.map((item) => item.date))];
  if (days.length > 1) {
    const jump = element("nav", null, content);
    jump.className = "offline-days";
    jump.setAttribute("aria-label", "날짜로 이동");
    days.forEach((value) => {
      const number = dayNumber(trip.startDate, value);
      const link = element("a", number ? "Day " + number : dateText(value), jump);
      link.href = "#day-" + value;
    });
  }
  for (const item of schedule) {
    if (item.date !== currentDate) {
      currentDate = item.date;
      day = element("section", null, content);
      day.id = "day-" + currentDate;
      const number = dayNumber(trip.startDate, currentDate);
      element("h3", (number ? "Day " + number + " · " : "") + dateText(currentDate), day);
    }
    const range = item.fixed_local_time?.slice(0, 5) ?? ({ MORNING: "오전", AFTERNOON: "오후", EVENING: "저녁" }[item.period] ?? "시간 미정");
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const duration = item.fixed_local_time && item.end_local_time ? minutes(item.end_local_time) - minutes(item.fixed_local_time) : 0;
    const row = element("p", null, day);
    row.className = "offline-item";
    element("span", range + (duration > 0 ? "–" + item.end_local_time.slice(0, 5) + " · " + duration + "분" : ""), row).className = "offline-time";
    element("strong", item.title, row);
    placeDetails(item.place, day);
    if (item.note) element("p", item.note, day);
  }
  if (!day) element("p", "저장된 날짜별 일정이 없습니다.", content);
  if (trip.bookings.length) {
    const section = element("section", null, content);
    element("h3", "예약 일정", section);
    for (const { kind, title, status: bookingStatus, detail } of trip.bookings) {
      const heading = [title, bookingLabels[bookingStatus]].filter(Boolean).join(" · ");
      element("h4", heading, section);
      if (!detail) continue;
      if (kind === "STAY") {
        element("p", [detail.address, "체크인", dateText(detail.checkInDate), detail.checkInTime?.slice(0, 5), "체크아웃", dateText(detail.checkOutDate), detail.checkOutTime?.slice(0, 5)].filter(Boolean).join(" "), section);
      } else if (kind === "FLIGHT") {
        for (const flight of detail) element("p", [
          [flight.departureAirport, dateText(flight.departureDate), flight.departureTime?.slice(0, 5), flight.departureZone].filter(Boolean).join(" "),
          [flight.arrivalAirport, dateText(flight.arrivalDate), flight.arrivalTime?.slice(0, 5), flight.arrivalZone].filter(Boolean).join(" "),
        ].join(" → "), section);
      } else {
        element("p", [dateText(detail.date), detail.time?.slice(0, 5), detail.meetingTime ? "집합 " + detail.meetingTime.slice(0, 5) : "", detail.meetingName, detail.meetingAddress].filter(Boolean).join(" "), section);
      }
    }
  }
  if (trip.places.length) {
    const section = element("section", null, content);
    element("h3", "저장된 장소", section);
    trip.places.forEach((place) => placeDetails(place, section));
  }
  const remove = element("button", "이 기기에서 수첩 삭제", content);
  remove.addEventListener("click", async () => {
    // Two-step confirmation in the page, matching the online app.
    if (remove.dataset.armed !== "1") {
      remove.dataset.armed = "1";
      remove.textContent = "한 번 더 누르면 이 기기에서 삭제돼요";
      setTimeout(() => { remove.dataset.armed = ""; remove.textContent = "이 기기에서 수첩 삭제"; }, 6000);
      return;
    }
    try {
      await deleteOffline(entry.tripId, entry.owner);
      location.replace("/offline.html");
    } catch {
      status.textContent = "수첩을 삭제하지 못했습니다. 다시 시도해 주세요.";
    }
  });
}

async function render() {
  const version = ++renderVersion;
  content.replaceChildren();
  status.textContent = "저장된 수첩 확인 중…";
  try {
    let verifiedOwner;
    if (navigator.onLine) {
      const revision = offlineRevision();
      const response = await fetch("/api/offline/identity", {
        cache: "no-store", signal: AbortSignal.timeout(4000),
      }).catch(() => null);
      if (version !== renderVersion) return;
      if (response && response.status < 500) {
        if (!response.ok && response.status !== 401) throw new Error("Identity unavailable");
        verifiedOwner = response.ok ? (await response.json()).owner : null;
        await activateOfflineOwner(verifiedOwner, revision);
      }
    }
    const { owner, entries } = await readOffline();
    if (version !== renderVersion) return;
    if (!entries.length || offlineSignoutPending() || (verifiedOwner !== undefined && owner !== verifiedOwner)) {
      status.textContent = noneSaved;
      return;
    }
    const id = new URLSearchParams(location.search).get("trip") ?? pathTrip;
    const saved = [];
    let checkedSelected;
    if (verifiedOwner) {
      const revision = offlineRevision();
      const signal = AbortSignal.timeout(4000);
      const checked = await Promise.all(entries.map(async (entry) =>
        [entry, await checkOfflineTrip(entry, signal, entry.tripId !== id)]));
      if (version !== renderVersion || offlineRevision() !== revision || offlineSignoutPending()) return;
      if (checked.some(([, result]) => result === "unverified")) {
        status.textContent = "로그인 상태를 확인하지 못했어요. 다시 연결해 주세요.";
        return;
      }
      for (const [entry, result] of checked) {
        if (result === "missing") await deleteOffline(entry.tripId, verifiedOwner, entry.savedAt);
        else {
          saved.push(entry);
          if (entry.tripId === id) checkedSelected = result;
        }
      }
    } else saved.push(...entries);
    if (version !== renderVersion || offlineSignoutPending()) return;
    if (!saved.length) {
      status.textContent = noneSaved;
      return;
    }
    status.textContent = verifiedOwner ? "이 기기에 저장된 여행" : "인터넷 연결 없이 보고 있습니다.";
    const selected = saved.find((entry) => entry.tripId === id);
    if (id && !selected) element("p", "이 여행은 이 기기에 저장된 수첩이 없어요. 아래의 저장된 여행을 열 수 있어요.", content);
    if (selected) {
      element("a", "저장된 여행 모두 보기", content).href = "/offline.html";
      showTrip(selected, checkedSelected);
    } else for (const entry of saved) {
      const row = element("p", null, content);
      element("a", entry.snapshot.title, row).href = "/offline.html?" + new URLSearchParams({ trip: entry.tripId });
    }
  } catch {
    if (version === renderVersion) status.textContent = "저장된 수첩을 확인하지 못했습니다. 연결을 확인해 주세요.";
  }
}

addEventListener("pageshow", render);
// At a trip URL this shell only stands in for the real page. Load the real page when the connection returns.
addEventListener("online", () => shellAtTripUrl ? location.reload() : render());
addEventListener("offline", render);
addEventListener("storage", (event) => { if (event.key === CHANGE) void render(); });
addEventListener("pagehide", () => { renderVersion++; content.replaceChildren(); });
