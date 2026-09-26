
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import DataTable from '@/components/common/DataTable';
import StatusBadge from '@/components/common/StatusBadge';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { api } from '@/lib/api';
import { Rider } from '@/lib/types';
import { Plus, Star } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useNavigate } from 'react-router-dom';

const RidersPage = () => {
  const navigate = useNavigate();
  
  const { data: riders, isLoading } = useQuery({
    queryKey: ['riders'],
    queryFn: api.riders.getAll
  });

  const columns = [
    {
      header: 'Rider',
      accessor: (row: Rider) => (
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
      accessor: 'phone' as keyof Rider,
      sortable: true,
    },
    {
      header: 'Rating',
      accessor: 'rating' as keyof Rider,
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
      accessor: 'status' as keyof Rider,
      render: (value: string) => <StatusBadge status={value as any} />,
      sortable: true,
    },
    {
      header: 'Total Trips',
      accessor: 'totalTrips' as keyof Rider,
      sortable: true,
    },
    {
      header: 'Join Date',
      accessor: 'joinDate' as keyof Rider,
      render: (date: string) => new Date(date).toLocaleDateString(),
      sortable: true,
    },
  ];

  // Rider 360 is the declared rider detail surface. `/riders/<id>` was never a
  // route (only `/riders`, `/riders/individual`, `/riders/corporate`), so every
  // row click 404'd.
  const handleRowClick = (rider: Rider) => {
    navigate(`/dashboard/admin/riders/${rider.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Riders</h1>
          <p className="text-muted-foreground">Manage your platform riders</p>
        </div>
        <Button
          className="gap-1"
          aria-label="Add new rider"
          data-testid="riders-add"
          data-analytics="admin.riders.add"
          onClick={() => {
            void import("@/lib/cta").then(({ trackCta }) =>
              trackCta({ buttonName: "admin.riders.add", actionType: "dialog" })
            );
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Rider
        </Button>
      </div>

      {isLoading ? (
        <LoadingSpinner className="py-10" size={40} />
      ) : (
        <DataTable
          data={riders || []}
          columns={columns}
          keyField="id"
          isLoading={isLoading}
          onRowClick={handleRowClick}
        />
      )}
    </div>
  );
};

export default RidersPage;
