
import { ChartData } from "@/types";
import { useEffect, useRef } from "react";
import { ResponsiveContainer, BarChart, XAxis, YAxis, Tooltip, Legend, Bar, CartesianGrid } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

interface TripChartProps {
  data?: ChartData;
  isLoading?: boolean;
  error?: string;
}

export default function TripChart({ data, isLoading, error }: TripChartProps) {
  const chartData = data?.labels.map((month, index) => {
    const result: Record<string, any> = { month };
    data.datasets.forEach((dataset) => {
      result[dataset.label] = dataset.data[index];
    });
    return result;
  });

  return (
    <Card className="col-span-3">
      <CardHeader>
        <CardTitle>Trip & Revenue Overview</CardTitle>
        <CardDescription>
          Monthly breakdown of trips completed and revenue generated
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-80">
            <p className="text-muted-foreground">Loading chart data...</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-80">
            <p className="text-red-500">{error}</p>
          </div>
        ) : chartData ? (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis 
                dataKey="month"
                tickLine={false}
                axisLine={{ stroke: '#e0e0e0' }}
              />
              <YAxis 
                yAxisId="left"
                tickLine={false}
                axisLine={{ stroke: '#e0e0e0' }}
                label={{ value: 'Trips', angle: -90, position: 'insideLeft' }}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                tickLine={false}
                axisLine={{ stroke: '#e0e0e0' }}
                label={{ value: 'Revenue ($K)', angle: -90, position: 'insideRight' }}
              />
              <Tooltip />
              <Legend />
              <Bar
                yAxisId="left"
                dataKey="Completed Trips"
                fill="#2c7a7b"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                yAxisId="right"
                dataKey="Revenue ($K)"
                fill="#1a365d"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex justify-center items-center h-80">
            <p className="text-muted-foreground">No chart data available</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
