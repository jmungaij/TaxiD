
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPassengerPaymentMethods } from '@/lib/api';
import { PaymentMethod } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, Smartphone, PlusCircle, WalletMinimal } from 'lucide-react';

interface PassengerPaymentDetailsProps {
  passengerId: string;
}

export function PassengerPaymentDetails({ passengerId }: PassengerPaymentDetailsProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['payment-methods', passengerId],
    queryFn: () => fetchPassengerPaymentMethods(passengerId),
  });
  
  const getPaymentMethodIcon = (type: string) => {
    switch(type) {
      case 'credit_card':
      case 'debit_card':
        return <CreditCard className="h-5 w-5" />;
      case 'paypal':
        return <WalletMinimal className="h-5 w-5" />;
      case 'apple_pay':
      case 'google_pay':
        return <Smartphone className="h-5 w-5" />;
      default:
        return <CreditCard className="h-5 w-5" />;
    }
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
              <div 
                key={method.id} 
                className={`flex justify-between items-center p-4 border rounded-lg ${method.isDefault ? 'border-primary' : 'border-gray-200'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-muted rounded">
                    {getPaymentMethodIcon(method.type)}
                  </div>
                  <div>
                    <div className="font-medium capitalize flex items-center gap-2">
                      {method.type.replace('_', ' ')}
                      {method.isDefault && <Badge className="ml-2">Default</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {method.type === 'paypal' ? 
                        `Email: ${method.last4}` : 
                        `Ending in ${method.last4}`}
                      {method.expMonth && method.expYear && ` • Expires ${method.expMonth}/${method.expYear}`}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm">Edit</Button>
                  {!method.isDefault && (
                    <Button variant="ghost" size="sm">Make Default</Button>
                  )}
                </div>
              </div>
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
