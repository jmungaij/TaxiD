/**
 * TRIP DIRECTORY — real bookings from the booking register.
 *
 * This page previously listed demonstration trips held in the browser. It now
 * reads the booking register itself, so an empty list means no trips have been
 * booked. Each row opens that trip's own record.
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, MapPin } from "lucide-react";
import DataTable from "@/components/common/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney, formatWhen, listTrips, type AdminTripRow } from "@/lib/trips/adminTrips";

const TAbs = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
] as const;

const TripsPage = () => {
  const [activeTab, setActiveTab] = React.useState<string>("all");
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-trips"],
    queryFn: () => listTrips(200),
  });

  const trips = data ?? [];
  const filteredTrips = React.useMemo(
    () => (activeTab === "all" ? trips : trips.filter((t) => t.status === activeTab)),
    [trips, activeTab],
  );

  const columns: Array<{
    header: string;
    accessor: keyof AdminTripRow | ((row: AdminTripRow) => React.ReactNode);
    render?: (value: never, row: AdminTripRow) => React.ReactNode;
    sortable?: boolean;
  }> = [
    {
      header: "Trip",
      accessor: (row: AdminTripRow) => (
        <div>
          <div className="font-medium">{row.booking_number || "NO REFERENCE"}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{row.id}</div>
        </div>
      ),
    },
    {
      header: "Route",
      accessor: (row: AdminTripRow) => (
        <div className="max-w-md space-y-1">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <div className="truncate text-sm">{row.pickup_address || "PICK-UP NOT RECORDED"}</div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
            <div className="truncate text-sm">{row.dropoff_address || "DROP-OFF NOT RECORDED"}</div>
          </div>
        </div>
      ),
    },
    {
      header: "Booked",
      accessor: (row: AdminTripRow) => (
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-sm">{formatWhen(row.created_at)}</span>
        </div>
      ),
    },
    {
      header: "Fare",
      accessor: (row: AdminTripRow) => (
        <span className="text-sm">{formatMoney(row.total_fare, row.currency)}</span>
      ),
    },
    {
      header: "Payment",
      accessor: (row: AdminTripRow) => (
        <Badge variant="outline">{row.payment_status || "NOT RECORDED"}</Badge>
      ),
    },
    {
      header: "Status",
      accessor: "status" as keyof AdminTripRow,
      render: (value: string) => <StatusBadge status={value as never} />,
      sortable: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Trips</h1>
        <p className="text-muted-foreground">
          Every booking on the platform. Select a row to open that trip's record.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {TAbs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading && <Skeleton className="h-56 w-full" />}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            <p className="font-medium">Trips could not be read.</p>
            <p className="text-muted-foreground">{(error as Error).message}</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && trips.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            NO TRIPS BOOKED YET. Nothing has been created here for demonstration.
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && trips.length > 0 && (
        <DataTable
          data={filteredTrips}
          columns={columns}
          keyField="id"
          onRowClick={(row) => navigate(`/dashboard/admin/trips/${row.id}`)}
        />
      )}
    </div>
  );
};

export default TripsPage;
