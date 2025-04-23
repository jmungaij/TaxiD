
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPassengers } from '@/lib/api';
import { Passenger } from '@/types';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';

interface PaymentsFilterProps {
  onPassengerChange: (passengerId: string | null) => void;
}

export function PaymentsFilter({ onPassengerChange }: PaymentsFilterProps) {
  const [selectedPassengerId, setSelectedPassengerId] = useState<string | null>(null);
  
  const { data: passengersData, isLoading } = useQuery({
    queryKey: ['passengers-for-payments'],
    queryFn: () => fetchPassengers(1, 100), // Get a larger list of passengers for the dropdown
  });
  
  const handlePassengerChange = (value: string) => {
    setSelectedPassengerId(value);
    onPassengerChange(value);
  };
  
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Passenger</label>
            <Select
              value={selectedPassengerId || ''}
              onValueChange={handlePassengerChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select passenger" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Passengers</SelectLabel>
                  {isLoading ? (
                    <SelectItem value="loading" disabled>Loading passengers...</SelectItem>
                  ) : (
                    passengersData?.data?.passengers.map((passenger: Passenger) => (
                      <SelectItem key={passenger.id} value={passenger.id}>
                        {passenger.firstName} {passenger.lastName} ({passenger.email})
                      </SelectItem>
                    ))
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
