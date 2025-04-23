import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTrips } from "@/lib/api";
import { Trip } from "@/types";
import { DataTable } from "@/components/DataTable/DataTable";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { BadgeCheck, BadgeX, Clock, MapPin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TripsPage = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  const { data, isLoading } = useQuery({
    queryKey: ["trips", page, pageSize, statusFilter, search],
    queryFn: () => fetchTrips(page, pageSize, statusFilter !== "all" ? statusFilter : undefined, search),
  });
  
  const handlePaginationChange = useCallback((page: number, pageSize: number) => {
    setPage(page);
    setPageSize(pageSize);
  }, []);
  
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  
  const columns: ColumnDef<Trip>[] = [
    {
      accessorKey: "id",
      header: "Trip ID",
      cell: ({ row }) => <span className="text-xs font-mono">{row.original.id}</span>,
    },
    {
      accessorKey: "passengerName",
      header: "Passenger",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">
            {row.original.passengerName}
          </div>
          <div className="text-xs text-muted-foreground">
            ID: {row.original.passengerId}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "driverName",
      header: "Driver",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">
            {row.original.driverName}
          </div>
          <div className="text-xs text-muted-foreground">
            ID: {row.original.driverId}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "pickup",
      header: "Pickup",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <MapPin className="h-3 w-3 text-muted-foreground" />
          <span className="truncate max-w-[140px]" title={row.original.pickupLocation.address}>
            {row.original.pickupLocation.address}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "time",
      header: "Start Time",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">
            {format(new Date(row.original.startTime), "MMM d, yyyy")}
          </div>
          <div className="text-xs text-muted-foreground">
            {format(new Date(row.original.startTime), "h:mm a")}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status;
        switch (status) {
          case "scheduled":
            return (
              <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-50">
                <Clock className="mr-1 h-3 w-3" /> Scheduled
              </Badge>
            );
          case "in-progress":
            return (
              <Badge variant="outline" className="border-blue-500 text-blue-700 bg-blue-50">
                <Clock className="mr-1 h-3 w-3" /> In Progress
              </Badge>
            );
          case "completed":
            return (
              <Badge variant="outline" className="border-emerald-500 text-emerald-700 bg-emerald-50">
                <BadgeCheck className="mr-1 h-3 w-3" /> Completed
              </Badge>
            );
          case "cancelled":
            return (
              <Badge variant="outline" className="border-red-500 text-red-700 bg-red-50">
                <BadgeX className="mr-1 h-3 w-3" /> Cancelled
              </Badge>
            );
          default:
            return null;
        }
      },
    },
    {
      accessorKey: "fare",
      header: "Fare",
      cell: ({ row }) => (
        <span className="font-medium">
          ${row.original.fare.toFixed(2)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/trips/${row.original.id}`}>View</Link>
          </Button>
        </div>
      ),
    },
  ];

  const StatusFilter = () => (
    <Select
      value={statusFilter}
      onValueChange={(value) => {
        setStatusFilter(value);
        setPage(1);
      }}
    >
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Filter by status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Statuses</SelectItem>
        <SelectItem value="scheduled">Scheduled</SelectItem>
        <SelectItem value="in-progress">In Progress</SelectItem>
        <SelectItem value="completed">Completed</SelectItem>
        <SelectItem value="cancelled">Cancelled</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Trips</h2>
          <p className="text-muted-foreground">
            View and manage all trips across the platform
          </p>
        </div>
        <Button>
          Schedule Trip
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data?.trips || []}
        loading={isLoading}
        searchFilter={search}
        onSearchChange={handleSearchChange}
        onPaginationChange={handlePaginationChange}
        pageCount={data?.data ? Math.ceil(data.data.total / pageSize) : 0}
        filterComponent={<StatusFilter />}
      />
    </div>
  );
};

export default TripsPage;
