
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPassengers } from "@/lib/api";
import { Passenger } from "@/types";
import { DataTable } from "@/components/DataTable/DataTable";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";

const PassengersPage = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  
  const { data, isLoading } = useQuery({
    queryKey: ["passengers", page, pageSize, search],
    queryFn: () => fetchPassengers(page, pageSize, search),
    keepPreviousData: true,
  });
  
  const handlePaginationChange = useCallback((page: number, pageSize: number) => {
    setPage(page);
    setPageSize(pageSize);
  }, []);
  
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  
  const columns: ColumnDef<Passenger>[] = [
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
              to={`/passengers/${row.original.id}`}
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
      accessorKey: "phone",
      header: "Phone",
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
      accessorKey: "totalSpent",
      header: "Total Spent",
      cell: ({ row }) => (
        <span className="font-medium">
          ${row.original.totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatDistanceToNow(new Date(row.original.createdAt), { addSuffix: true })}
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
            <Link to={`/passengers/${row.original.id}`}>View</Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Passengers</h2>
          <p className="text-muted-foreground">
            View and manage all passenger accounts
          </p>
        </div>
        <Button>
          Add Passenger
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data?.passengers || []}
        loading={isLoading}
        searchFilter={search}
        onSearchChange={handleSearchChange}
        onPaginationChange={handlePaginationChange}
        pageCount={data?.data ? Math.ceil(data.data.total / pageSize) : 0}
      />
    </div>
  );
};

export default PassengersPage;
