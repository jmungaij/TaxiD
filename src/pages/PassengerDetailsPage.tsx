
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchPassengerPayments } from '@/lib/api';
import { DataTable } from '@/components/DataTable/DataTable';
import { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Payment } from '@/types';
import { format } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PassengerPaymentDetails } from '@/components/Payments/PassengerPaymentDetails';
import { Button } from '@/components/ui/button';

const PassengerDetailsPage = () => {
  const { id } = useParams<{ id: string }>();
  const passengerId = id || '';

  // Fetch passenger payments
  const { data: paymentsData, isLoading: isLoadingPayments } = useQuery({
    queryKey: ['passenger-payments', passengerId],
    queryFn: () => fetchPassengerPayments(passengerId, 1, 5),
    enabled: !!passengerId,
  });

  // Payment history columns
  const columns: ColumnDef<Payment>[] = [
    {
      accessorKey: 'id',
      header: 'Payment ID',
      cell: ({ row }) => <span className="text-xs font-mono">{row.original.id}</span>,
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      cell: ({ row }) => (
        <span className="font-medium">
          ${row.original.amount.toFixed(2)}
        </span>
      ),
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
      cell: ({ row }) => format(new Date(row.original.createdAt), 'MMM d, yyyy'),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Passenger Details</h2>
          <p className="text-muted-foreground">
            View and manage passenger information and payments
          </p>
        </div>
        <Button>Process Payment</Button>
      </div>

      <Tabs defaultValue="payment-methods">
        <TabsList>
          <TabsTrigger value="payment-methods">Payment Methods</TabsTrigger>
          <TabsTrigger value="payment-history">Payment History</TabsTrigger>
        </TabsList>
        <TabsContent value="payment-methods" className="mt-4">
          <PassengerPaymentDetails passengerId={passengerId} />
        </TabsContent>
        <TabsContent value="payment-history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Payments</CardTitle>
              <CardDescription>
                Recent transactions for this passenger
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={columns}
                data={paymentsData?.data?.payments || []}
                loading={isLoadingPayments}
              />
              <div className="mt-4 text-center">
                <Button variant="outline">View All Payments</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PassengerDetailsPage;
