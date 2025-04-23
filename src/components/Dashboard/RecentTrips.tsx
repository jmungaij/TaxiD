
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trip } from "@/types";
import { formatDistanceToNow } from "date-fns";
import { BadgeCheck, BadgeX, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../ui/badge";

interface RecentTripsProps {
  trips?: Trip[];
  isLoading?: boolean;
}

export default function RecentTrips({ trips, isLoading }: RecentTripsProps) {
  function getTripStatusBadge(status: Trip["status"]) {
    switch (status) {
      case "scheduled":
        return (
          <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-50">
            <Clock className="mr-1 h-3 w-3" /> Scheduled
          </Badge>
        );
      case "in-progress":
        return (
          <Badge variant="outline" className="border-blue-500 text-blue-700 bg-blue-50">
            <Clock className="mr-1 h-3 w-3" /> In Progress
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="outline" className="border-emerald-500 text-emerald-700 bg-emerald-50">
            <BadgeCheck className="mr-1 h-3 w-3" /> Completed
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="border-red-500 text-red-700 bg-red-50">
            <BadgeX className="mr-1 h-3 w-3" /> Cancelled
          </Badge>
        );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Trips</CardTitle>
        <CardDescription>
          Latest trip activity across the platform
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[300px] flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading recent trips...</p>
          </div>
        ) : trips && trips.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trip ID</TableHead>
                <TableHead>Passenger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Fare</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trips.map((trip) => (
                <TableRow key={trip.id}>
                  <TableCell className="font-medium">
                    <Link to={`/trips/${trip.id}`} className="hover:underline text-primary">
                      {trip.id}
                    </Link>
                  </TableCell>
                  <TableCell>{trip.passengerName}</TableCell>
                  <TableCell>{getTripStatusBadge(trip.status)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDistanceToNow(new Date(trip.startTime), {
                      addSuffix: true,
                    })}
                  </TableCell>
                  <TableCell className="text-right">${trip.fare.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="h-[300px] flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No recent trips found</p>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" className="w-full">
          <Link to="/trips">View all trips</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
