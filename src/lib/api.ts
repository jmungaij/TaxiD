
import { ApiResponse, ChartData, DashboardStats, Driver, Passenger, Trip } from "@/types";

// Base API URL - In a real app, this would come from environment variables
const API_BASE_URL = 'https://api.ridenexus.example';

// Helper function for fetch requests
async function fetchAPI<T>(endpoint: string, options = {}): Promise<ApiResponse<T>> {
  try {
    // In a production app, we'd use proper authentication tokens in headers
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer mock-token-for-demo',
      },
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...defaultOptions,
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();
    return { status: 'success', data: data as T };
  } catch (error) {
    console.error('API request failed:', error);
    return { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// For demo purposes, we'll use mock data
// In a real application, these would make actual API calls

export async function fetchDashboardStats(): Promise<ApiResponse<DashboardStats>> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const mockStats: DashboardStats = {
    totalPassengers: 15842,
    totalDrivers: 2378,
    activeTrips: 342,
    completedTrips: 58942,
    cancelledTrips: 1284,
    totalRevenue: 1462840,
    revenueGrowth: 8.3
  };
  
  return { status: 'success', data: mockStats };
}

export async function fetchTripChartData(): Promise<ApiResponse<ChartData>> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 700));
  
  const mockChartData: ChartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    datasets: [
      {
        label: 'Completed Trips',
        data: [4200, 4500, 5100, 4800, 5300, 5800, 6000, 6300, 5900, 6100, 6500, 6800],
        backgroundColor: 'rgba(44, 122, 123, 0.2)',
        borderColor: 'rgba(44, 122, 123, 1)',
        borderWidth: 2
      },
      {
        label: 'Revenue ($K)',
        data: [220, 240, 270, 250, 290, 310, 330, 350, 320, 340, 360, 380],
        backgroundColor: 'rgba(26, 54, 93, 0.2)',
        borderColor: 'rgba(26, 54, 93, 1)',
        borderWidth: 2
      }
    ]
  };
  
  return { status: 'success', data: mockChartData };
}

export async function fetchPassengers(
  page = 1, 
  limit = 10, 
  search = ''
): Promise<ApiResponse<{passengers: Passenger[], total: number}>> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 600));
  
  const mockPassengers: Passenger[] = Array(100).fill(null).map((_, index) => ({
    id: `p-${10000 + index}`,
    firstName: ['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'William', 'Sophia', 'James', 'Isabella', 'Logan'][index % 10],
    lastName: ['Smith', 'Johnson', 'Williams', 'Jones', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor'][index % 10],
    email: `passenger${10000 + index}@example.com`,
    phone: `+1-${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}-${Math.floor(1000 + Math.random() * 9000)}`,
    rating: Math.floor(30 + Math.random() * 20) / 10,
    tripCount: Math.floor(10 + Math.random() * 100),
    totalSpent: Math.floor(500 + Math.random() * 5000),
    createdAt: new Date(Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000)).toISOString(),
    status: ['active', 'active', 'active', 'inactive', 'blocked'][Math.floor(Math.random() * 5)] as 'active' | 'inactive' | 'blocked',
    avatarUrl: index % 3 === 0 ? `https://i.pravatar.cc/150?img=${index % 70}` : undefined
  }));
  
  // Filter by search term if provided
  let filtered = mockPassengers;
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = mockPassengers.filter(p => 
      p.firstName.toLowerCase().includes(searchLower) || 
      p.lastName.toLowerCase().includes(searchLower) || 
      p.email.toLowerCase().includes(searchLower) ||
      p.phone.includes(search)
    );
  }
  
  // Paginate results
  const start = (page - 1) * limit;
  const paginatedData = filtered.slice(start, start + limit);
  
  return { 
    status: 'success', 
    data: {
      passengers: paginatedData,
      total: filtered.length
    }
  };
}

export async function fetchDrivers(
  page = 1, 
  limit = 10, 
  search = ''
): Promise<ApiResponse<{drivers: Driver[], total: number}>> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 600));
  
  const vehicleTypes = ['sedan', 'suv', 'van', 'luxury'];
  const vehicleColors = ['black', 'white', 'silver', 'blue', 'red', 'gray'];
  const vehicleMakes = ['Toyota', 'Honda', 'Ford', 'Chevrolet', 'BMW', 'Mercedes', 'Tesla'];
  const vehicleModels = {
    'Toyota': ['Camry', 'Corolla', 'Prius', 'RAV4'],
    'Honda': ['Civic', 'Accord', 'CR-V', 'Pilot'],
    'Ford': ['Fusion', 'Focus', 'Escape', 'Explorer'],
    'Chevrolet': ['Malibu', 'Cruze', 'Equinox', 'Tahoe'],
    'BMW': ['3 Series', '5 Series', 'X3', 'X5'],
    'Mercedes': ['C-Class', 'E-Class', 'GLC', 'GLE'],
    'Tesla': ['Model 3', 'Model Y', 'Model S', 'Model X']
  };
  
  const mockDrivers: Driver[] = Array(80).fill(null).map((_, index) => {
    const make = vehicleMakes[Math.floor(Math.random() * vehicleMakes.length)];
    return {
      id: `d-${20000 + index}`,
      firstName: ['Michael', 'Christopher', 'Matthew', 'Joshua', 'David', 'James', 'Robert', 'John', 'Joseph', 'Daniel'][index % 10],
      lastName: ['Smith', 'Johnson', 'Williams', 'Jones', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor'][index % 10],
      email: `driver${20000 + index}@example.com`,
      phone: `+1-${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}-${Math.floor(1000 + Math.random() * 9000)}`,
      rating: Math.floor(40 + Math.random() * 10) / 10,
      tripCount: Math.floor(50 + Math.random() * 500),
      totalEarnings: Math.floor(5000 + Math.random() * 50000),
      vehicle: {
        id: `v-${30000 + index}`,
        make,
        model: vehicleModels[make as keyof typeof vehicleModels][Math.floor(Math.random() * vehicleModels[make as keyof typeof vehicleModels].length)],
        year: 2015 + Math.floor(Math.random() * 8),
        licensePlate: `${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(1000 + Math.random() * 9000)}`,
        color: vehicleColors[Math.floor(Math.random() * vehicleColors.length)],
        type: vehicleTypes[Math.floor(Math.random() * vehicleTypes.length)] as 'sedan' | 'suv' | 'van' | 'luxury',
        capacity: 4 + Math.floor(Math.random() * 4),
        status: ['active', 'active', 'active', 'maintenance', 'inactive'][Math.floor(Math.random() * 5)] as 'active' | 'maintenance' | 'inactive',
      },
      createdAt: new Date(Date.now() - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000)).toISOString(),
      status: ['active', 'active', 'active', 'inactive', 'blocked'][Math.floor(Math.random() * 5)] as 'active' | 'inactive' | 'blocked',
      location: index % 4 === 0 ? undefined : {
        lat: 37.7749 + (Math.random() * 0.1 - 0.05),
        lng: -122.4194 + (Math.random() * 0.1 - 0.05)
      },
      avatarUrl: index % 4 === 0 ? `https://i.pravatar.cc/150?img=${index % 70 + 30}` : undefined
    };
  });
  
  // Filter by search term if provided
  let filtered = mockDrivers;
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = mockDrivers.filter(d => 
      d.firstName.toLowerCase().includes(searchLower) || 
      d.lastName.toLowerCase().includes(searchLower) || 
      d.email.toLowerCase().includes(searchLower) ||
      d.phone.includes(search) ||
      d.vehicle.licensePlate.toLowerCase().includes(searchLower)
    );
  }
  
  // Paginate results
  const start = (page - 1) * limit;
  const paginatedData = filtered.slice(start, start + limit);
  
  return { 
    status: 'success', 
    data: {
      drivers: paginatedData,
      total: filtered.length
    }
  };
}

export async function fetchTrips(
  page = 1, 
  limit = 10, 
  status?: string,
  search?: string
): Promise<ApiResponse<{trips: Trip[], total: number}>> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 800));
  
  const tripStatuses: Array<'scheduled' | 'in-progress' | 'completed' | 'cancelled'> = ['scheduled', 'in-progress', 'completed', 'cancelled'];
  const paymentMethods: Array<'credit' | 'cash' | 'corporate'> = ['credit', 'cash', 'corporate'];
  
  const mockTrips: Trip[] = Array(200).fill(null).map((_, index) => {
    const tripStatus = tripStatuses[Math.floor(Math.random() * tripStatuses.length)];
    const startTime = new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000));
    let endTime;
    
    if (tripStatus === 'completed' || tripStatus === 'cancelled') {
      // Add 15-60 minutes for completed trips
      endTime = new Date(startTime.getTime() + Math.floor(15 + Math.random() * 45) * 60 * 1000);
    }
    
    const distance = Math.floor(2 + Math.random() * 30 * 10) / 10; // 2.0 to 32.0 miles
    const duration = Math.floor(5 + distance * 3 + Math.random() * 15); // Trip duration in minutes
    const fare = Math.floor(5 + distance * 2.5 * 100) / 100; // Base fare + distance based fare
    
    return {
      id: `t-${100000 + index}`,
      passengerId: `p-${10000 + Math.floor(Math.random() * 100)}`,
      passengerName: `${['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'William', 'Sophia', 'James', 'Isabella', 'Logan'][index % 10]} ${['Smith', 'Johnson', 'Williams', 'Jones', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor'][index % 10]}`,
      driverId: `d-${20000 + Math.floor(Math.random() * 80)}`,
      driverName: `${['Michael', 'Christopher', 'Matthew', 'Joshua', 'David', 'James', 'Robert', 'John', 'Joseph', 'Daniel'][index % 10]} ${['Smith', 'Johnson', 'Williams', 'Jones', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor'][(index + 3) % 10]}`,
      pickupLocation: {
        address: ['123 Main St', '456 Market St', '789 Oak Ave', '321 Maple Rd', '987 Pine Blvd'][Math.floor(Math.random() * 5)],
        lat: 37.7749 + (Math.random() * 0.1 - 0.05),
        lng: -122.4194 + (Math.random() * 0.1 - 0.05)
      },
      dropoffLocation: {
        address: ['555 Park Ave', '777 Broadway', '888 Sunset Blvd', '444 Ocean Dr', '222 Mountain View'][Math.floor(Math.random() * 5)],
        lat: 37.7749 + (Math.random() * 0.1 - 0.05),
        lng: -122.4194 + (Math.random() * 0.1 - 0.05)
      },
      status: tripStatus,
      startTime: startTime.toISOString(),
      endTime: endTime?.toISOString(),
      fare,
      distance,
      duration,
      paymentMethod: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
      rating: tripStatus === 'completed' ? Math.floor(30 + Math.random() * 20) / 10 : undefined,
      feedback: tripStatus === 'completed' && Math.random() > 0.7 ? 
        ['Great ride!', 'Driver was very professional', 'Clean car and smooth ride', 'Got me to my destination quickly', 'Pleasant experience overall'][Math.floor(Math.random() * 5)] : 
        undefined
    };
  });
  
  // Filter by status if provided
  let filtered = mockTrips;
  if (status && status !== 'all') {
    filtered = mockTrips.filter(t => t.status === status);
  }
  
  // Filter by search term if provided
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(t => 
      t.passengerName.toLowerCase().includes(searchLower) || 
      t.driverName.toLowerCase().includes(searchLower) || 
      t.id.toLowerCase().includes(searchLower) ||
      t.pickupLocation.address.toLowerCase().includes(searchLower) ||
      t.dropoffLocation.address.toLowerCase().includes(searchLower)
    );
  }
  
  // Paginate results
  const start = (page - 1) * limit;
  const paginatedData = filtered.slice(start, start + limit);
  
  return { 
    status: 'success', 
    data: {
      trips: paginatedData,
      total: filtered.length
    }
  };
}
