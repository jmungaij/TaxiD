
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Calendar, Users, Car, MapPin, DollarSign, TrendingUp, Star } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import StatCard from '@/components/common/StatCard';
import LoadingSpinner from '@/components/common/LoadingSpinner';

const TRIP_STATUS_COLORS = ['hsl(var(--status-success))', 'hsl(var(--chart-1))', 'hsl(var(--chart-6))', 'hsl(var(--status-danger))'];
const VEHICLE_COLORS = ['hsl(var(--chart-2))', 'hsl(var(--chart-4))', 'hsl(var(--chart-6))', 'hsl(var(--chart-6))'];

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('overview');

  const { data: stats, isLoading: isLoadingStats } = useQuery({
    queryKey: ['dashboardStats'],
    queryFn: api.dashboard.getStats
  });

  const { data: chartData, isLoading: isLoadingCharts } = useQuery({
    queryKey: ['dashboardCharts'],
    queryFn: api.dashboard.getChartData
  });

  const isLoading = isLoadingStats || isLoadingCharts;

  if (isLoading) {
    return (
      <div className="h-[80vh] flex justify-center items-center">
        <LoadingSpinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Rider Management System Overview</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Riders"
          value={stats?.totalRiders || 0}
          icon={<Users className="h-5 w-5 text-primary" />}
          description="Active users on platform"
          trend={{ value: 12, isPositive: true }}
        />
        
        <StatCard
          title="Total Drivers"
          value={stats?.totalDrivers || 0}
          icon={<Car className="h-5 w-5 text-primary" />}
          description={`${stats?.availableDrivers || 0} currently available`}
          trend={{ value: 8, isPositive: true }}
        />
        
        <StatCard
          title="Trips Today"
          value={stats?.tripsToday || 0}
          icon={<MapPin className="h-5 w-5 text-primary" />}
          description={`${stats?.tripsThisWeek || 0} this week`}
          trend={{ value: 5, isPositive: true }}
        />
        
        <StatCard
          title="Total Revenue"
          value={`$${stats?.totalRevenue.toLocaleString() || 0}`}
          icon={<DollarSign className="h-5 w-5 text-primary" />}
          description="17% increase from last month"
          trend={{ value: 17, isPositive: true }}
        />
      </div>

      {/* Tabs for different views */}
      <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trips">Trips</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
        </TabsList>
        
        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Trip Status Distribution */}
            <Card className="data-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Trip Status Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData?.tripsByStatus}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="hsl(var(--chart-2))"
                        dataKey="value"
                      >
                        {chartData?.tripsByStatus.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={TRIP_STATUS_COLORS[index % TRIP_STATUS_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Vehicle Type Distribution */}
            <Card className="data-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Vehicle Type Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData?.tripsByVehicleType}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="hsl(var(--chart-2))"
                        dataKey="value"
                      >
                        {chartData?.tripsByVehicleType.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={VEHICLE_COLORS[index % VEHICLE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Weekly Trips Chart */}
          <Card className="data-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Weekly Trips</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData?.tripsByDay}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(var(--chart-1))" name="Trips" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Trips Tab */}
        <TabsContent value="trips" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Completed Trips"
              value="75%"
              icon={<TrendingUp className="h-5 w-5 text-status-success" />}
              description="Of total trips"
            />
            
            <StatCard
              title="In Progress"
              value="15%"
              icon={<TrendingUp className="h-5 w-5 text-ai" />}
              description="Of total trips"
            />
            
            <StatCard
              title="Scheduled"
              value="8%"
              icon={<Calendar className="h-5 w-5 text-ai" />}
              description="Upcoming trips"
            />
            
            <StatCard
              title="Avg. Rating"
              value={stats?.averageRating.toFixed(1) || "0.0"}
              icon={<Star className="h-5 w-5 text-status-warning" />}
              description="Out of 5.0"
              trend={{ value: 0.3, isPositive: true }}
            />
          </div>

          <Card className="data-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Daily Trip Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData?.tripsByDay}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" activeDot={{ r: 8 }} name="Trips" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Revenue Tab */}
        <TabsContent value="revenue" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              title="Total Revenue"
              value={`$${stats?.totalRevenue.toLocaleString() || "0"}`}
              icon={<DollarSign className="h-5 w-5 text-status-success" />}
              description="Year to date"
              trend={{ value: 17, isPositive: true }}
            />
            
            <StatCard
              title="Avg. Trip Value"
              value="$24.50"
              icon={<DollarSign className="h-5 w-5 text-ai" />}
              description="Per completed trip"
              trend={{ value: 4, isPositive: true }}
            />
            
            <StatCard
              title="Revenue per Driver"
              value="$194.60"
              icon={<DollarSign className="h-5 w-5 text-ai" />}
              description="Weekly average"
              trend={{ value: 7, isPositive: true }}
            />
          </div>

          <Card className="data-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Monthly Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData?.revenueByMonth}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`$${value}`, 'Revenue']} />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--status-success))" strokeWidth={2} activeDot={{ r: 8 }} name="Revenue" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Dashboard;
