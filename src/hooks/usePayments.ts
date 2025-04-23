
import { useQuery } from '@tanstack/react-query';
import { fetchPassengerPayments } from '@/lib/api';
import { ApiResponse, Payment } from '@/types';

export function usePassengerPayments(passengerId: string | null, page: number, pageSize: number) {
  return useQuery<ApiResponse<{payments: Payment[], total: number}>>({
    queryKey: ['payments', passengerId, page, pageSize],
    queryFn: () => 
      passengerId 
        ? fetchPassengerPayments(passengerId, page, pageSize)
        : Promise.resolve({ status: 'success' as const, data: { payments: [], total: 0 } }),
    enabled: !!passengerId
  });
}
