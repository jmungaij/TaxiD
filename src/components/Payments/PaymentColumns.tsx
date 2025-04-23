
import { ColumnDef } from "@tanstack/react-table";
import { Payment } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { format } from "date-fns";

export const paymentColumns: ColumnDef<Payment>[] = [
  {
    accessorKey: 'id',
    header: 'Payment ID',
    cell: ({ row }) => <span className="text-xs font-mono">{row.original.id}</span>,
  },
  {
    accessorKey: 'amount',
    header: 'Amount',
    cell: ({ row }) => (
      <span className="font-medium text-right block">
        ${row.original.amount.toFixed(2)}
      </span>
    ),
  },
  {
    accessorKey: 'paymentMethod',
    header: 'Method',
    cell: ({ row }) => {
      const method = row.original.paymentMethod.replace('_', ' ');
      return <span className="capitalize">{method}</span>;
    },
  },
  {
    accessorKey: 'description',
    header: 'Description',
    cell: ({ row }) => row.original.description,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <Badge
          variant="outline"
          className={
            status === 'completed' 
              ? 'border-emerald-500 text-emerald-700 bg-emerald-50'
              : status === 'pending' 
              ? 'border-amber-500 text-amber-700 bg-amber-50' 
              : status === 'failed'
              ? 'border-red-500 text-red-700 bg-red-50'
              : 'border-blue-500 text-blue-700 bg-blue-50'
          }
        >
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'createdAt',
    header: 'Date',
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span>{format(new Date(row.original.createdAt), 'MMM d, yyyy')}</span>
        <span className="text-muted-foreground text-xs">
          {format(new Date(row.original.createdAt), 'h:mm a')}
        </span>
      </div>
    ),
  },
  {
    accessorKey: 'tripId',
    header: 'Trip',
    cell: ({ row }) => row.original.tripId ? (
      <Link 
        to={`/trips/${row.original.tripId}`}
        className="text-primary hover:underline"
      >
        {row.original.tripId}
      </Link>
    ) : (
      <span className="text-muted-foreground">N/A</span>
    ),
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/payments/${row.original.id}`}>View</Link>
        </Button>
        {row.original.status === 'completed' && (
          <Button variant="outline" size="sm">Receipt</Button>
        )}
        {row.original.status === 'pending' && (
          <Button size="sm">Process</Button>
        )}
      </div>
    ),
  },
];
