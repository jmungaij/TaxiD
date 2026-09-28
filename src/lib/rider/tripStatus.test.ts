import { describe, expect, it } from "vitest";
import { isActiveTrip, tripStatusLabel } from "./tripStatus";

describe("rider trip status", () => {
  it("marks journeys in progress and scheduled as active", () => {
    expect(isActiveTrip("in_progress")).toBe(true);
    expect(isActiveTrip("scheduled")).toBe(true);
    expect(isActiveTrip("completed")).toBe(false);
    expect(isActiveTrip("cancelled")).toBe(false);
  });

  it("provides readable labels without losing unknown states", () => {
    expect(tripStatusLabel("driver_arrived")).toBe("Driver has arrived");
    expect(tripStatusLabel("custom_status")).toBe("custom status");
  });
});