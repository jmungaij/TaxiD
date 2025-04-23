
import StatsCard from "@/components/Dashboard/StatsCard";
import TripChart from "@/components/Dashboard/TripChart";
import RecentTrips from "@/components/Dashboard/RecentTrips";
import { fetchDashboardStats, fetchTripChartData, fetchTrips } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, MapPin, Users, Car } from "lucide-react";

const Dashboard = () => {
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["dashboardStats"],
    queryFn: fetchDashboardStats,
  });

  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ["tripChartData"],
    queryFn: fetchTripChartData,
  });
  
  const { data: tripsData, isLoading: tripsLoading } = useQuery({
    queryKey: ["recentTrips"],
    queryFn: async () => {
      const result = await fetchTrips(1, 5);
      return result;
    },
  });

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Passengers"
          value={statsLoading ? "Loading..." : `${statsData?.data?.totalPassengers.toLocaleString()}`}
          icon={<Users className="h-4 w-4" />}
          description="Registered riders"
        />
        <StatsCard
          title="Active Drivers"
          value={statsLoading ? "Loading..." : `${statsData?.data?.totalDrivers.toLocaleString()}`}
          icon={<Car className="h-4 w-4" />}
          description="Available drivers"
        />
        <StatsCard
          title="Active Trips"
          value={statsLoading ? "Loading..." : `${statsData?.data?.activeTrips.toLocaleString()}`}
          icon={<MapPin className="h-4 w-4" />}
          description="Trips in progress"
        />
        <StatsCard
          title="Total Revenue"
          value={statsLoading ? "Loading..." : formatCurrency(statsData?.data?.totalRevenue || 0)}
          icon={<CircleDollarSign className="h-4 w-4" />}
          trend={statsData?.data?.revenueGrowth}
          trendLabel="vs last month"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-3">
        <TripChart 
          data={chartData?.data} 
          isLoading={chartLoading} 
        />
      </div>

      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-1">
        <RecentTrips
          trips={tripsData?.data?.trips} 
          isLoading={tripsLoading}
        />
      </div>
    </div>
  );
};

export default Dashboard;
