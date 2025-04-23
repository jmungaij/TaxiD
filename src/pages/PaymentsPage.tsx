
import { useState } from 'react';
import { Payment } from '@/types';
import { DataTable } from '@/components/DataTable/DataTable';
import { Button } from '@/components/ui/button';
import { PaymentsFilter } from '@/components/Payments/PaymentsFilter';
import { usePassengerPayments } from '@/hooks/usePayments';
import { paymentColumns } from '@/components/Payments/PaymentColumns';

const PaymentsPage = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [selectedPassengerId, setSelectedPassengerId] = useState<string | null>(null);
  
  const { data, isLoading } = usePassengerPayments(selectedPassengerId, page, pageSize);
  
  const handlePaginationChange = (page: number, pageSize: number) => {
    setPage(page);
    setPageSize(pageSize);
  };
  
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handlePassengerChange = (passengerId: string | null) => {
    setSelectedPassengerId(passengerId);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Payments</h2>
          <p className="text-muted-foreground">
            Manage passenger payments and transactions
          </p>
        </div>
        <div>
          <Button>
            New Payment
          </Button>
        </div>
      </div>

      <PaymentsFilter onPassengerChange={handlePassengerChange} />

      <DataTable
        columns={paymentColumns}
        data={data?.data?.payments || []}
        loading={isLoading || !selectedPassengerId}
        searchFilter={search}
        onSearchChange={handleSearchChange}
        onPaginationChange={handlePaginationChange}
        pageCount={data?.data ? Math.ceil(data.data.total / pageSize) : 0}
      />
    </div>
  );
};

export default PaymentsPage;
