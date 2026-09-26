import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ActivityTable, RiderDirectoryTable, ridersToCsvRows, type RiderRow,
} from "./RiderTables";
import { toCsv } from "@/lib/csv";

const riders: RiderRow[] = [
  { id: "r1", first_name: "Amina", last_name: "Otieno", display_name: null, phone_number: "+254700000001",
    email: "amina@example.com", status: "active", rider_tier: "gold", lifetime_trips: 42, rating_avg: 4.876 },
  { id: "r2", first_name: null, last_name: null, display_name: "Brian K", phone_number: null,
    email: null, status: null, rider_tier: null, lifetime_trips: null, rating_avg: null },
];

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("RiderDirectoryTable", () => {
  it("renders headers and one row per rider", () => {
    wrap(<RiderDirectoryTable rows={riders} loading={false} />);
    for (const h of ["Rider", "Contact", "Status", "Tier", "Trips", "Rating"])
      expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^rider-row-/)).toHaveLength(2);
  });

  it("renders row cells with formatting and fallbacks", () => {
    wrap(<RiderDirectoryTable rows={riders} loading={false} />);
    const r1 = within(screen.getByTestId("rider-row-r1"));
    expect(r1.getByRole("link", { name: "Amina Otieno" })).toHaveAttribute("href");
    expect(r1.getByText(/amina@example.com/)).toBeInTheDocument();
    expect(r1.getByText("42")).toBeInTheDocument();
    expect(r1.getByText("4.88")).toBeInTheDocument();
    const r2 = within(screen.getByTestId("rider-row-r2"));
    expect(r2.getByRole("link", { name: "Brian K" })).toBeInTheDocument();
    expect(r2.getByText("0.00")).toBeInTheDocument();
    expect(r2.getAllByText("—")).toHaveLength(2);
  });

  it("shows loading and empty states", () => {
    const { rerender } = wrap(<RiderDirectoryTable rows={[]} loading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(<MemoryRouter><RiderDirectoryTable rows={[]} loading={false} /></MemoryRouter>);
    expect(screen.getByText("No riders.")).toBeInTheDocument();
  });
});

describe("ActivityTable", () => {
  type R = { id: string; n: number };
  const rows: R[] = [{ id: "a", n: 2 }, { id: "b", n: 1 }, { id: "c", n: 3 }];
  const cols = [{ key: "n", header: "N", sortValue: (r: R) => r.n, render: (r: R) => <span>v{r.n}</span> }];

  it("renders rows and cycles sort asc → desc → none", () => {
    render(<ActivityTable columns={cols} rows={rows} rowKey={(r) => r.id} />);
    const vals = () => screen.getAllByText(/^v\d$/).map((e) => e.textContent);
    expect(vals()).toEqual(["v2", "v1", "v3"]);
    const btn = screen.getByRole("button", { name: /Sort by N/ });
    fireEvent.click(btn); expect(vals()).toEqual(["v1", "v2", "v3"]);
    fireEvent.click(btn); expect(vals()).toEqual(["v3", "v2", "v1"]);
    fireEvent.click(btn); expect(vals()).toEqual(["v2", "v1", "v3"]);
  });

  it("shows empty message", () => {
    render(<ActivityTable columns={cols} rows={[]} rowKey={(r) => r.id} emptyMessage="Nothing here" />);
    expect(screen.getAllByText("Nothing here").length).toBeGreaterThan(0);
  });
});

describe("rider CSV export", () => {
  it("serialises filtered riders", () => {
    const csv = toCsv(ridersToCsvRows(riders));
    const [head, first] = csv.split("\n");
    expect(head).toBe("rider_id,name,email,phone,status,tier,lifetime_trips,rating");
    expect(first).toBe("r1,Amina Otieno,amina@example.com,+254700000001,active,gold,42,4.88");
  });
});
