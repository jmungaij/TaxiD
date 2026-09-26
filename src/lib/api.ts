
import { Rider, Driver, Trip, DashboardStats, DashboardChartData } from './types';

// Mock data for riders
const mockRiders: Rider[] = [
  {
    id: "r-1",
    name: "John Doe",
    email: "john.doe@example.com",
    phone: "+1 (555) 123-4567",
    address: "123 Main St, Anytown, CA 94105",
    profileImage: "https://randomuser.me/api/portraits/men/1.jpg",
    rating: 4.7,
    status: "active",
    joinDate: "2023-01-15",
    totalTrips: 85,
    preferredPaymentMethod: "credit_card"
  },
  {
    id: "r-2",
    name: "Jane Smith",
    email: "jane.smith@example.com",
    phone: "+1 (555) 987-6543",
    address: "456 Oak Ave, Somewhere, CA 90210",
    profileImage: "https://randomuser.me/api/portraits/women/1.jpg",
    rating: 4.9,
    status: "active",
    joinDate: "2023-02-20",
    totalTrips: 63,
    preferredPaymentMethod: "paypal"
  },
  {
    id: "r-3",
    name: "Michael Brown",
    email: "michael.brown@example.com",
    phone: "+1 (555) 567-8901",
    address: "789 Pine Rd, Nowhere, CA 94107",
    profileImage: "https://randomuser.me/api/portraits/men/2.jpg",
    rating: 4.3,
    status: "inactive",
    joinDate: "2023-03-05",
    totalTrips: 12,
    preferredPaymentMethod: "debit_card"
  },
  {
    id: "r-4",
    name: "Emily Johnson",
    email: "emily.johnson@example.com",
    phone: "+1 (555) 234-5678",
    address: "321 Elm St, Anytown, CA 94105",
    profileImage: "https://randomuser.me/api/portraits/women/2.jpg",
    rating: 4.8,
    status: "active",
    joinDate: "2023-01-10",
    totalTrips: 47,
    preferredPaymentMethod: "credit_card"
  },
  {
    id: "r-5",
    name: "David Wilson",
    email: "david.wilson@example.com",
    phone: "+1 (555) 876-5432",
    address: "654 Maple Ave, Somewhere, CA 90210",
    profileImage: "https://randomuser.me/api/portraits/men/3.jpg",
    rating: 4.5,
    status: "blocked",
    joinDate: "2023-04-15",
    totalTrips: 23,
    preferredPaymentMethod: "cash"
  },
  {
    id: "r-6",
    name: "Sarah Taylor",
    email: "sarah.taylor@example.com",
    phone: "+1 (555) 345-6789",
    address: "987 Cedar Rd, Nowhere, CA 94107",
    profileImage: "https://randomuser.me/api/portraits/women/3.jpg",
    rating: 4.6,
    status: "active",
    joinDate: "2023-02-25",
    totalTrips: 59,
    preferredPaymentMethod: "credit_card"
  }
];

// Mock data for drivers
const mockDrivers: Driver[] = [
  {
    id: "d-1",
    name: "Robert Martinez",
    email: "robert.martinez@example.com",
    phone: "+1 (555) 234-5678",
    profileImage: "https://randomuser.me/api/portraits/men/4.jpg",
    rating: 4.8,
    status: "available",
    vehicle: {
      model: "Toyota Camry",
      year: 2020,
      color: "Silver",
      licensePlate: "ABC123",
      type: "sedan"
    },
    joinDate: "2023-01-05",
    totalTrips: 152,
    totalEarnings: 4350.75
  },
  {
    id: "d-2",
    name: "Amanda Garcia",
    email: "amanda.garcia@example.com",
    phone: "+1 (555) 876-5432",
    profileImage: "https://randomuser.me/api/portraits/women/4.jpg",
    rating: 4.9,
    status: "busy",
    vehicle: {
      model: "Honda Accord",
      year: 2021,
      color: "Black",
      licensePlate: "XYZ789",
      type: "sedan"
    },
    joinDate: "2023-02-10",
    totalTrips: 187,
    totalEarnings: 5240.50
  },
  {
    id: "d-3",
    name: "James Robinson",
    email: "james.robinson@example.com",
    phone: "+1 (555) 345-6789",
    profileImage: "https://randomuser.me/api/portraits/men/5.jpg",
    rating: 4.6,
    status: "offline",
    vehicle: {
      model: "Ford Explorer",
      year: 2019,
      color: "Blue",
      licensePlate: "DEF456",
      type: "suv"
    },
    joinDate: "2023-03-15",
    totalTrips: 94,
    totalEarnings: 2780.25
  },
  {
    id: "d-4",
    name: "Christina Lee",
    email: "christina.lee@example.com",
    phone: "+1 (555) 987-6543",
    profileImage: "https://randomuser.me/api/portraits/women/5.jpg",
    rating: 4.7,
    status: "available",
    vehicle: {
      model: "BMW 5 Series",
      year: 2022,
      color: "White",
      licensePlate: "LMN321",
      type: "luxury"
    },
    joinDate: "2023-01-20",
    totalTrips: 143,
    totalEarnings: 5760.00
  },
  {
    id: "d-5",
    name: "Thomas Anderson",
    email: "thomas.anderson@example.com",
    phone: "+1 (555) 456-7890",
    profileImage: "https://randomuser.me/api/portraits/men/6.jpg",
    rating: 4.5,
    status: "available",
    vehicle: {
      model: "Dodge Grand Caravan",
      year: 2020,
      color: "Red",
      licensePlate: "PQR654",
      type: "van"
    },
    joinDate: "2023-02-05",
    totalTrips: 118,
    totalEarnings: 3420.75
  }
];

// Mock data for trips
const mockTrips: Trip[] = [
  {
    id: "t-1",
    riderId: "r-1",
    riderName: "John Doe",
    driverId: "d-1",
    driverName: "Robert Martinez",
    origin: {
      address: "123 Main St, Anytown, CA 94105",
      coordinates: [-122.419416, 37.774929]
    },
    destination: {
      address: "456 Market St, Anytown, CA 94105",
      coordinates: [-122.399967, 37.790760]
    },
    status: "completed",
    startTime: "2023-06-15T09:30:00Z",
    endTime: "2023-06-15T10:15:00Z",
    distance: 5.3,
    duration: 45,
    fare: 18.75,
    paymentMethod: "credit_card",
    rating: 5,
    feedback: "Great ride, very professional driver!"
  },
  {
    id: "t-2",
    riderId: "r-2",
    riderName: "Jane Smith",
    driverId: "d-2",
    driverName: "Amanda Garcia",
    origin: {
      address: "789 Valencia St, Anytown, CA 94110",
      coordinates: [-122.421957, 37.759616]
    },
    destination: {
      address: "345 Folsom St, Anytown, CA 94105",
      coordinates: [-122.390746, 37.790463]
    },
    status: "in_progress",
    startTime: "2023-06-16T14:00:00Z",
    endTime: null,
    distance: 4.2,
    duration: 35,
    fare: 16.25,
    paymentMethod: "paypal",
    rating: null,
    feedback: null
  },
  {
    id: "t-3",
    riderId: "r-3",
    riderName: "Michael Brown",
    driverId: "d-3",
    driverName: "James Robinson",
    origin: {
      address: "222 Potrero Ave, Anytown, CA 94110",
      coordinates: [-122.407127, 37.765300]
    },
    destination: {
      address: "555 Howard St, Anytown, CA 94105",
      coordinates: [-122.396530, 37.787579]
    },
    status: "scheduled",
    startTime: "2023-06-17T11:00:00Z",
    endTime: null,
    distance: 3.8,
    duration: 30,
    fare: 14.50,
    paymentMethod: "debit_card",
    rating: null,
    feedback: null
  },
  {
    id: "t-4",
    riderId: "r-4",
    riderName: "Emily Johnson",
    driverId: "d-4",
    driverName: "Christina Lee",
    origin: {
      address: "888 Brannan St, Anytown, CA 94103",
      coordinates: [-122.405818, 37.772710]
    },
    destination: {
      address: "101 California St, Anytown, CA 94111",
      coordinates: [-122.398442, 37.793160]
    },
    status: "completed",
    startTime: "2023-06-15T16:30:00Z",
    endTime: "2023-06-15T17:10:00Z",
    distance: 4.5,
    duration: 40,
    fare: 35.00,
    paymentMethod: "credit_card",
    rating: 4,
    feedback: "Good ride, a bit delayed but driver was courteous."
  },
  {
    id: "t-5",
    riderId: "r-5",
    riderName: "David Wilson",
    driverId: "d-5",
    driverName: "Thomas Anderson",
    origin: {
      address: "444 Hayes St, Anytown, CA 94102",
      coordinates: [-122.423941, 37.776369]
    },
    destination: {
      address: "1 Ferry Building, Anytown, CA 94111",
      coordinates: [-122.393036, 37.795030]
    },
    status: "cancelled",
    startTime: "2023-06-16T08:00:00Z",
    endTime: null,
    distance: 5.0,
    duration: 0,
    fare: 0,
    paymentMethod: "cash",
    rating: null,
    feedback: "Driver cancelled last minute."
  },
  {
    id: "t-6",
    riderId: "r-6",
    riderName: "Sarah Taylor",
    driverId: "d-1",
    driverName: "Robert Martinez",
    origin: {
      address: "333 Post St, Anytown, CA 94108",
      coordinates: [-122.407845, 37.788415]
    },
    destination: {
      address: "900 North Point St, Anytown, CA 94109",
      coordinates: [-122.423415, 37.805968]
    },
    status: "completed",
    startTime: "2023-06-15T12:15:00Z",
    endTime: "2023-06-15T12:45:00Z",
    distance: 3.2,
    duration: 30,
    fare: 12.50,
    paymentMethod: "credit_card",
    rating: 5,
    feedback: "Perfect ride! Driver knew the fastest route."
  }
];

// Mock data for dashboard stats
const mockDashboardStats: DashboardStats = {
  totalRiders: 1250,
  activeRiders: 950,
  totalDrivers: 450,
  availableDrivers: 280,
  tripsToday: 625,
  tripsThisWeek: 3840,
  tripsThisMonth: 15720,
  totalRevenue: 87520.75,
  averageRating: 4.7
};

// Mock data for chart data
const mockDashboardChartData: DashboardChartData = {
  tripsByDay: [
    { name: "Mon", value: 120 },
    { name: "Tue", value: 140 },
    { name: "Wed", value: 135 },
    { name: "Thu", value: 155 },
    { name: "Fri", value: 180 },
    { name: "Sat", value: 210 },
    { name: "Sun", value: 165 }
  ],
  tripsByVehicleType: [
    { name: "Sedan", value: 48 },
    { name: "SUV", value: 25 },
    { name: "Luxury", value: 15 },
    { name: "Van", value: 12 }
  ],
  revenueByMonth: [
    { name: "Jan", value: 65000 },
    { name: "Feb", value: 68000 },
    { name: "Mar", value: 72000 },
    { name: "Apr", value: 75000 },
    { name: "May", value: 80000 },
    { name: "Jun", value: 87500 }
  ],
  tripsByStatus: [
    { name: "Completed", value: 75 },
    { name: "In Progress", value: 15 },
    { name: "Scheduled", value: 8 },
    { name: "Cancelled", value: 2 }
  ]
};

// API simulation with artificial delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// API service
export const api = {
  // Riders API
  riders: {
    getAll: async (): Promise<Rider[]> => {
      await delay(600);
      return [...mockRiders];
    },
    getById: async (id: string): Promise<Rider | undefined> => {
      await delay(500);
      return mockRiders.find(rider => rider.id === id);
    },
    search: async (query: string): Promise<Rider[]> => {
      await delay(600);
      const lowercaseQuery = query.toLowerCase();
      return mockRiders.filter(
        rider => 
          rider.name.toLowerCase().includes(lowercaseQuery) ||
          rider.email.toLowerCase().includes(lowercaseQuery) ||
          rider.phone.includes(query)
      );
    }
  },
  
  // Drivers API
  drivers: {
    getAll: async (): Promise<Driver[]> => {
      await delay(600);
      return [...mockDrivers];
    },
    getById: async (id: string): Promise<Driver | undefined> => {
      await delay(500);
      return mockDrivers.find(driver => driver.id === id);
    },
    getAvailable: async (): Promise<Driver[]> => {
      await delay(450);
      return mockDrivers.filter(driver => driver.status === 'available');
    }
  },
  
  // Trips API
  trips: {
    getAll: async (): Promise<Trip[]> => {
      await delay(700);
      return [...mockTrips];
    },
    getById: async (id: string): Promise<Trip | undefined> => {
      await delay(500);
      return mockTrips.find(trip => trip.id === id);
    },
    getByRiderId: async (riderId: string): Promise<Trip[]> => {
      await delay(600);
      return mockTrips.filter(trip => trip.riderId === riderId);
    },
    getByDriverId: async (driverId: string): Promise<Trip[]> => {
      await delay(600);
      return mockTrips.filter(trip => trip.driverId === driverId);
    },
    getByStatus: async (status: Trip['status']): Promise<Trip[]> => {
      await delay(550);
      return mockTrips.filter(trip => trip.status === status);
    }
  },
  
  // Dashboard API
  dashboard: {
    getStats: async (): Promise<DashboardStats> => {
      await delay(800);
      return { ...mockDashboardStats };
    },
    getChartData: async (): Promise<DashboardChartData> => {
      await delay(900);
      return { ...mockDashboardChartData };
    }
  }
};
