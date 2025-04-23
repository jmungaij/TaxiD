
import { PaymentMethod } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, Smartphone, WalletMinimal } from 'lucide-react';

interface PaymentMethodCardProps {
  method: PaymentMethod;
  onEdit: (id: string) => void;
  onMakeDefault: (id: string) => void;
}

export function PaymentMethodCard({ method, onEdit, onMakeDefault }: PaymentMethodCardProps) {
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
    <div 
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
        <Button variant="outline" size="sm" onClick={() => onEdit(method.id)}>Edit</Button>
        {!method.isDefault && (
          <Button variant="ghost" size="sm" onClick={() => onMakeDefault(method.id)}>Make Default</Button>
        )}
      </div>
    </div>
  );
}
