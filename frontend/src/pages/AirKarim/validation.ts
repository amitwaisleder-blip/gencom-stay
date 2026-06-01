import type { Trip } from "./types";

export type Warning = {
  id: string;
  category: "missing" | "overlap" | "logistics";
  message: string;
};

export function validateTrip(t: Trip): Warning[] {
  const out: Warning[] = [];

  // Missing confirmations / reservations.
  t.flights.forEach((f) => {
    if (!f.confirmation) out.push({ id: `mc_${f.id}`, category: "missing", message: `Flight ${f.airline} ${f.flightNumber} is missing a confirmation number.` });
  });
  t.lodging.forEach((l) => {
    if (!l.confirmation) out.push({ id: `mc_${l.id}`, category: "missing", message: `Lodging at ${l.hotel} is missing a confirmation number.` });
  });
  t.dining.forEach((d) => {
    if (!d.reservation) out.push({ id: `mc_${d.id}`, category: "missing", message: `Dining at ${d.restaurant} is missing a reservation reference.` });
  });

  // Overlapping time windows across any two blocks.
  type Span = { id: string; label: string; start: number; end: number };
  const spans: Span[] = [];
  t.flights.forEach((f) => spans.push({ id: f.id, label: `${f.airline} ${f.flightNumber}`, start: +new Date(f.departAt), end: +new Date(f.arriveAt) }));
  t.meetings.forEach((m) => spans.push({ id: m.id, label: m.title, start: +new Date(m.startAt), end: +new Date(m.endAt) }));
  t.dining.forEach((d) => spans.push({ id: d.id, label: d.restaurant, start: +new Date(d.time), end: +new Date(d.time) + 90 * 60 * 1000 }));
  t.ground.forEach((g) => spans.push({ id: g.id, label: `${g.transportKind} ${g.provider ?? ""}`.trim(), start: +new Date(g.time), end: +new Date(g.time) + 30 * 60 * 1000 }));
  spans.sort((a, b) => a.start - b.start);
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[j].start >= spans[i].end) break;
      if (spans[i].end > spans[j].start) {
        out.push({
          id: `ol_${spans[i].id}_${spans[j].id}`,
          category: "overlap",
          message: `Time overlap: "${spans[i].label}" and "${spans[j].label}" share a window.`,
        });
      }
    }
  }

  // Flight arrival city should match next meeting / lodging city.
  const sortedFlights = [...t.flights].sort((a, b) => +new Date(a.arriveAt) - +new Date(b.arriveAt));
  for (const f of sortedFlights) {
    const arriveCity = (f.arriveCity ?? "").toLowerCase();
    if (!arriveCity) continue;
    const nextEvents = [
      ...t.meetings.filter((m) => +new Date(m.startAt) > +new Date(f.arriveAt)),
      ...t.dining.filter((d) => +new Date(d.time) > +new Date(f.arriveAt)),
      ...t.lodging.filter((l) => +new Date(l.checkInAt) > +new Date(f.arriveAt)),
    ].sort((a, b) => {
      const at = "startAt" in a ? a.startAt : "time" in a ? a.time : a.checkInAt;
      const bt = "startAt" in b ? b.startAt : "time" in b ? b.time : b.checkInAt;
      return +new Date(at) - +new Date(bt);
    })[0];
    if (!nextEvents) continue;
    const nextCity = (nextEvents.city ?? "").toLowerCase();
    if (nextCity && !nextCity.includes(arriveCity) && !arriveCity.includes(nextCity.split(",")[0]?.trim() ?? "")) {
      out.push({
        id: `city_${f.id}`,
        category: "logistics",
        message: `Flight arrives in "${f.arriveCity}" but next scheduled item is in "${nextEvents.city ?? "—"}". Check ground transport.`,
      });
    }
  }

  return out;
}
