
import { useQuery } from '@tanstack/react-query';
import { fetchPassengerPaymentMethods } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { PaymentMethodCard } from './PaymentMethodCard';

interface PassengerPaymentDetailsProps {
  passengerId: string;
}

export function PassengerPaymentDetails({ passengerId }: PassengerPaymentDetailsProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['payment-methods', passengerId],
    queryFn: () => fetchPassengerPaymentMethods(passengerId),
  });

  const handleEdit = (methodId: string) => {
    console.log('Edit payment method:', methodId);
  };

  const handleMakeDefault = (methodId: string) => {
    console.log('Make default payment method:', methodId);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Methods</CardTitle>
        <CardDescription>Manage passenger payment options</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">Loading payment methods...</div>
        ) : data?.data?.paymentMethods && data.data.paymentMethods.length > 0 ? (
          <div className="space-y-4">
            {data.data.paymentMethods.map((method) => (
              <PaymentMethodCard
                key={method.id}
                method={method}
                onEdit={handleEdit}
                onMakeDefault={handleMakeDefault}
              />
            ))}
            <div className="mt-4">
              <Button variant="outline" className="w-full" size="sm">
                <PlusCircle className="mr-2 h-4 w-4" /> Add Payment Method
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>No payment methods found.</p>
            <Button variant="outline" className="mt-4" size="sm">
              <PlusCircle className="mr-2 h-4 w-4" /> Add Payment Method
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
