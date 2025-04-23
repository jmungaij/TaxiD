import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDrivers } from "@/lib/api";
import { Driver } from "@/types";
import { DataTable } from "@/components/DataTable/DataTable";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Car, UserIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";

const DriversPage = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  
  const { data, isLoading } = useQuery({
    queryKey: ["drivers", page, pageSize, search],
    queryFn: () => fetchDrivers(page, pageSize, search),
  });
  
  const handlePaginationChange = useCallback((page: number, pageSize: number) => {
    setPage(page);
    setPageSize(pageSize);
  }, []);
  
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  
  const columns: ColumnDef<Driver>[] = [
    {
      accessorKey: "id",
      header: "ID",
      cell: ({ row }) => <span className="text-xs font-mono">{row.original.id}</span>,
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={row.original.avatarUrl} />
            <AvatarFallback className="bg-primary/10">
              <UserIcon className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <div>
            <Link
              to={`/drivers/${row.original.id}`}
              className="font-medium text-primary hover:underline"
            >
              {row.original.firstName} {row.original.lastName}
            </Link>
            <div className="text-xs text-muted-foreground">{row.original.email}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "vehicle",
      header: "Vehicle",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 bg-primary/10 rounded-full">
            <Car className="h-4 w-4" />
          </span>
          <div>
            <div className="font-medium">
              {row.original.vehicle.make} {row.original.vehicle.model}
            </div>
            <div className="text-xs text-muted-foreground">
              {row.original.vehicle.licensePlate} • {row.original.vehicle.color}
            </div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "rating",
      header: "Rating",
      cell: ({ row }) => (
        <span className="inline-flex items-center">
          {row.original.rating}
          <span className="ml-1 text-amber-500">★</span>
        </span>
      ),
    },
    {
      accessorKey: "tripCount",
      header: "Trips",
      cell: ({ row }) => row.original.tripCount.toLocaleString(),
    },
    {
      accessorKey: "earnings",
      header: "Total Earnings",
      cell: ({ row }) => (
        <span className="font-medium">
          ${row.original.totalEarnings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <Badge
            variant="outline"
            className={
              status === "active" 
                ? "border-emerald-500 text-emerald-700 bg-emerald-50"
                : status === "inactive" 
                ? "border-amber-500 text-amber-700 bg-amber-50" 
                : "border-red-500 text-red-700 bg-red-50"
            }
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/drivers/${row.original.id}`}>View</Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Drivers</h2>
          <p className="text-muted-foreground">
            View and manage all driver accounts and vehicles
          </p>
        </div>
        <Button>
          Add Driver
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data?.drivers || []}
        loading={isLoading}
        searchFilter={search}
        onSearchChange={handleSearchChange}
        onPaginationChange={handlePaginationChange}
        pageCount={data?.data ? Math.ceil(data.data.total / pageSize) : 0}
      />
    </div>
  );
};

export default DriversPage;
