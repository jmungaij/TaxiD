/**
 * Cabin layout catalogue for the booking experience.
 *
 * Customers choose a seating arrangement (not just a seat) so operations can
 * configure the cabin before departure. Layouts are filtered by aircraft
 * capacity and each carries an image preview of the cabin experience.
 */
import jetInterior from "@/assets/charter/jet-interior.jpg";
import jetExterior from "@/assets/charter/jet-exterior.jpg";
import helicopterImg from "@/assets/charter/helicopter.jpg";
import turbopropImg from "@/assets/charter/turboprop.jpg";

export type CabinLayoutKey =
  | "club_four" | "executive_forward" | "conference" | "vip_lounge" | "open_view" | "cargo_split";

export interface CabinLayout {
  key: CabinLayoutKey;
  label: string;
  blurb: string;
  /** Seats per row used by the seat picker grid. */
  perRow: number;
  /** Minimum cabin seats needed for this arrangement. */
  minSeats: number;
  image: string;
  /** Aircraft keys this arrangement is offered on; empty means all. */
  restrictTo?: string[];
}

export const CABIN_LAYOUTS: CabinLayout[] = [
  {
    key: "club_four",
    label: "Club four",
    blurb: "Two facing pairs around a fold-out table — the default executive cabin.",
    perRow: 2,
    minSeats: 4,
    image: jetInterior,
  },
  {
    key: "executive_forward",
    label: "Forward-facing executive",
    blurb: "All seats forward-facing for guests who prefer not to fly backwards.",
    perRow: 2,
    minSeats: 2,
    image: jetInterior,
  },
  {
    key: "conference",
    label: "Conference group",
    blurb: "Club four plus a divan, configured for an in-flight working session.",
    perRow: 2,
    minSeats: 6,
    image: jetExterior,
  },
  {
    key: "vip_lounge",
    label: "VIP lounge",
    blurb: "Berthable seating and a private aft lounge for long sectors.",
    perRow: 2,
    minSeats: 8,
    image: jetInterior,
  },
  {
    key: "open_view",
    label: "Panoramic view",
    blurb: "Window-priority seating for sightseeing and photography sectors.",
    perRow: 2,
    minSeats: 2,
    image: helicopterImg,
    restrictTo: ["helicopter", "cessna_172", "cessna_206", "caravan_208b"],
  },
  {
    key: "cargo_split",
    label: "Cabin / cargo split",
    blurb: "Reduced seat count with the aft cabin reserved for freight and kit.",
    perRow: 1,
    minSeats: 2,
    image: turbopropImg,
    restrictTo: ["caravan_208b", "twin_otter", "king_air_350", "cessna_206"],
  },
];

/** Layouts offered for a given aircraft key and cabin capacity. */
export function layoutsFor(aircraftKey: string, seats: number): CabinLayout[] {
  const list = CABIN_LAYOUTS.filter(
    (l) => seats >= l.minSeats && (!l.restrictTo || l.restrictTo.includes(aircraftKey)),
  );
  return list.length ? list : [CABIN_LAYOUTS[1]];
}

export const layoutByKey = (key: string): CabinLayout | undefined =>
  CABIN_LAYOUTS.find((l) => l.key === key);

/** Deterministic seat ids for a layout at a given capacity. */
export function seatsForLayout(layout: CabinLayout, capacity: number): { seats: string[]; windows: string[] } {
  const letters = ["A", "B", "C", "D"];
  const seats: string[] = [];
  const windows: string[] = [];
  const rows = Math.max(1, Math.ceil(capacity / layout.perRow));
  for (let r = 1; r <= rows; r += 1) {
    for (let c = 0; c < layout.perRow; c += 1) {
      if (seats.length >= capacity) break;
      const id = `${r}${letters[c]}`;
      seats.push(id);
      if (c === 0 || c === layout.perRow - 1) windows.push(id);
    }
  }
  return { seats, windows };
}
