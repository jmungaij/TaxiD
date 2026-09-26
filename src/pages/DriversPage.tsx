
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import DataTable from '@/components/common/DataTable';
import StatusBadge from '@/components/common/StatusBadge';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { api } from '@/lib/api';
import { Driver } from '@/lib/types';
import { Plus, Car, Star } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';

const DriversPage = () => {
  const navigate = useNavigate();
  
  const { data: drivers, isLoading } = useQuery({
    queryKey: ['drivers'],
    queryFn: api.drivers.getAll
  });

  const columns = [
    {
      header: 'Driver',
      accessor: (row: Driver) => (
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarImage src={row.profileImage} alt={row.name} />
            <AvatarFallback>
              {row.name.split(' ').map(n => n[0]).join('')}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{row.name}</p>
            <p className="text-xs text-muted-foreground">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      header: 'Phone',
      accessor: 'phone' as keyof Driver,
      sortable: true,
    },
    {
      header: 'Vehicle',
      accessor: (row: Driver) => (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <Car className="w-3 h-3 text-muted-foreground" />
            <span>{row.vehicle.model} ({row.vehicle.year})</span>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="h-5 text-xs font-normal">
              {row.vehicle.type.charAt(0).toUpperCase() + row.vehicle.type.slice(1)}
            </Badge>
            <Badge variant="outline" className="h-5 text-xs font-normal">
              {row.vehicle.licensePlate}
            </Badge>
          </div>
        </div>
      ),
    },
    {
      header: 'Rating',
      accessor: 'rating' as keyof Driver,
      render: (value: number) => (
        <div className="flex items-center">
          <Star className="w-4 h-4 text-status-warning mr-1" />
          <span>{value.toFixed(1)}</span>
        </div>
      ),
      sortable: true,
    },
    {
      header: 'Status',
      accessor: 'status' as keyof Driver,
      render: (value: string) => <StatusBadge status={value as any} />,
      sortable: true,
    },
    {
      header: 'Total Trips',
      accessor: 'totalTrips' as keyof Driver,
      sortable: true,
    },
    {
      header: 'Earnings',
      accessor: 'totalEarnings' as keyof Driver,
      render: (value: number) => `$${value.toFixed(2)}`,
      sortable: true,
    },
  ];

  // Driver 360 is the declared driver detail surface. `/drivers/<id>` was never
  // a route (only the public `/drivers` brochure page), so every row click 404'd.
  const handleRowClick = (driver: Driver) => {
    navigate(`/dashboard/admin/drivers/${driver.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Drivers</h1>
          <p className="text-muted-foreground">Manage your platform drivers</p>
        </div>
        <Button
          className="gap-1"
          aria-label="Add new driver"
          data-testid="drivers-add"
          data-analytics="admin.drivers.add"
          onClick={() => {
            void import("@/lib/cta").then(({ trackCta }) =>
              trackCta({ buttonName: "admin.drivers.add", actionType: "dialog" })
            );
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Driver
        </Button>
      </div>

      {isLoading ? (
        <LoadingSpinner className="py-10" size={40} />
      ) : (
        <DataTable
          data={drivers || []}
          columns={columns}
          keyField="id"
          isLoading={isLoading}
          onRowClick={handleRowClick}
        />
      )}
    </div>
  );
};

export default DriversPage;
