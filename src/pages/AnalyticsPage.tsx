
import { TripChart } from "@/components/Dashboard/TripChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchTripChartData } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

const AnalyticsPage = () => {
  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ["tripChartData"],
    queryFn: fetchTripChartData,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
        <p className="text-muted-foreground">
          View detailed performance analytics and reports
        </p>
      </div>

      <div className="grid gap-6">
        <TripChart 
          data={chartData?.data} 
          isLoading={chartLoading} 
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Peak Hours</CardTitle>
              <CardDescription>Most active hours during the day</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px] flex items-center justify-center">
              <p className="text-muted-foreground">Chart visualization coming soon</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Popular Locations</CardTitle>
              <CardDescription>Most requested pickup locations</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px] flex items-center justify-center">
              <p className="text-muted-foreground">Map visualization coming soon</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Driver Performance</CardTitle>
            <CardDescription>Comparative analysis of drivers</CardDescription>
          </CardHeader>
          <CardContent className="h-[400px] flex items-center justify-center">
            <p className="text-muted-foreground">Advanced analytics coming soon</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AnalyticsPage;
