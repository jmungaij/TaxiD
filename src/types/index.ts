export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
  avatar?: string;
}

export interface Passenger {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  rating: number;
  tripCount: number;
  totalSpent: number;
  createdAt: string;
  status: 'active' | 'inactive' | 'blocked';
  avatarUrl?: string;
  paymentMethods?: PaymentMethod[];
}

export interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  rating: number;
  tripCount: number;
  totalEarnings: number;
  vehicle: Vehicle;
  createdAt: string;
  status: 'active' | 'inactive' | 'blocked';
  location?: {
    lat: number;
    lng: number;
  };
  avatarUrl?: string;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  color: string;
  type: 'sedan' | 'suv' | 'van' | 'luxury';
  capacity: number;
  status: 'active' | 'maintenance' | 'inactive';
}

export interface Trip {
  id: string;
  passengerId: string;
  passengerName: string;
  driverId: string;
  driverName: string;
  pickupLocation: Location;
  dropoffLocation: Location;
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  startTime: string;
  endTime?: string;
  fare: number;
  distance: number;
  duration: number;
  paymentMethod: 'credit' | 'cash' | 'corporate';
  rating?: number;
  feedback?: string;
}

export interface Location {
  address: string;
  lat: number;
  lng: number;
}

export interface DashboardStats {
  totalPassengers: number;
  totalDrivers: number;
  activeTrips: number;
  completedTrips: number;
  cancelledTrips: number;
  totalRevenue: number;
  revenueGrowth: number;
}

export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
    borderWidth?: number;
  }[];
}

export type ApiResponse<T> = {
  data?: T;
  status: 'success' | 'error';
  message?: string;
};

export type PaymentMethodType = 'credit_card' | 'debit_card' | 'paypal' | 'apple_pay' | 'google_pay' | 'bank_transfer';

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  last4: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
  createdAt: string;
}

export interface Payment {
  id: string;
  passengerId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  paymentMethod: PaymentMethodType;
  description: string;
  tripId?: string;
  createdAt: string;
  updatedAt: string;
}
