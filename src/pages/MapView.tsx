
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Driver, Trip } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import StatusBadge from '@/components/common/StatusBadge';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { Map, MapPin, Search, Filter, Car, UserIcon, Route, Clock } from 'lucide-react';

const MapView = () => {
  const { data: drivers, isLoading: isLoadingDrivers } = useQuery({
    queryKey: ['drivers'],
    queryFn: api.drivers.getAll
  });

  const { data: trips, isLoading: isLoadingTrips } = useQuery({
    queryKey: ['trips'],
    queryFn: api.trips.getAll
  });

  const [activeDrivers, setActiveDrivers] = useState<Driver[]>([]);
  const [activeTrips, setActiveTrips] = useState<Trip[]>([]);

  useEffect(() => {
    if (drivers) {
      setActiveDrivers(drivers.filter(driver => driver.status === 'available'));
    }
  }, [drivers]);

  useEffect(() => {
    if (trips) {
      setActiveTrips(trips.filter(trip => trip.status === 'in_progress'));
    }
  }, [trips]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Map</h1>
          <p className="text-muted-foreground">Track vehicles and trips in real-time</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-1"
            aria-label="Filter map view"
            data-testid="map-filter"
            data-analytics="admin.map.filter"
            onClick={() => {
              void import("@/lib/cta").then(({ trackCta }) =>
                trackCta({ buttonName: "admin.map.filter", actionType: "dialog" })
              );
            }}
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Filter</span>
          </Button>
          <Button
            className="gap-1"
            aria-label="Open map in full screen"
            data-testid="map-fullscreen"
            data-analytics="admin.map.fullscreen"
            onClick={() => {
              void import("@/lib/cta").then(({ trackCta }) =>
                trackCta({ buttonName: "admin.map.fullscreen", actionType: "noop" })
              );
              document.documentElement.requestFullscreen?.().catch(() => undefined);
            }}
          >
            <Map className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Full Screen</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search drivers or locations..."
              className="pl-8"
            />
          </div>

          {/* Active Drivers */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Car className="h-4 w-4" />
                Available Drivers ({activeDrivers?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2 py-0">
              {isLoadingDrivers ? (
                <LoadingSpinner className="py-4" />
              ) : (
                <div className="max-h-[200px] overflow-y-auto">
                  {activeDrivers.map(driver => (
                    <div key={driver.id} className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded-md cursor-pointer">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={driver.profileImage} />
                        <AvatarFallback>
                          {driver.name.split(' ').map(n => n[0]).join('')}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{driver.name}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Car className="h-3 w-3" />
                          <span className="truncate">{driver.vehicle.model}</span>
                        </div>
                      </div>
                      <StatusBadge status="available" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Trips */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Route className="h-4 w-4" />
                Active Trips ({activeTrips?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2 py-0">
              {isLoadingTrips ? (
                <LoadingSpinner className="py-4" />
              ) : (
                <div className="max-h-[200px] overflow-y-auto">
                  {activeTrips.map(trip => (
                    <div key={trip.id} className="p-2 hover:bg-muted/50 rounded-md cursor-pointer">
                      <div className="flex items-center gap-2 mb-1">
                        <UserIcon className="h-3 w-3 text-muted-foreground" />
                        <p className="text-sm font-medium truncate">{trip.riderName}</p>
                        <StatusBadge status="in_progress" className="ml-auto" />
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                        <Clock className="h-3 w-3" />
                        <span>Started: {new Date(trip.startTime).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-xs">
                        <div className="flex items-start gap-1">
                          <MapPin className="h-3 w-3 text-muted-foreground mt-0.5" />
                          <div className="truncate">{trip.origin.address}</div>
                        </div>
                        <div className="h-2"></div>
                        <div className="flex items-start gap-1">
                          <MapPin className="h-3 w-3 text-primary mt-0.5" />
                          <div className="truncate">{trip.destination.address}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Map */}
        <div className="lg:col-span-3">
          <div className="h-[calc(100vh-250px)] min-h-[400px] rounded-lg border border-border relative bg-muted/30 flex items-center justify-center p-6">
            <div className="text-center space-y-4">
              <Map className="h-16 w-16 mx-auto text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold">Interactive Map</h3>
                <p className="text-muted-foreground max-w-md">
                  This is where an interactive map would be integrated, showing real-time driver locations and active trip routes.
                </p>
              </div>
              <div className="space-x-2">
                <Button
                  aria-label="Show all drivers on map"
                  data-testid="map-show-drivers"
                  data-analytics="admin.map.show_drivers"
                  onClick={() => {
                    void import("@/lib/cta").then(({ trackCta }) =>
                      trackCta({ buttonName: "admin.map.show_drivers", actionType: "noop" })
                    );
                  }}
                >Show All Drivers</Button>
                <Button
                  variant="outline"
                  aria-label="Show active trips on map"
                  data-testid="map-show-trips"
                  data-analytics="admin.map.show_trips"
                  onClick={() => {
                    void import("@/lib/cta").then(({ trackCta }) =>
                      trackCta({ buttonName: "admin.map.show_trips", actionType: "noop" })
                    );
                  }}
                >Show Active Trips</Button>
              </div>
            </div>

            {/* Map Legend - Would be overlaid on actual map */}
            <div className="absolute bottom-4 left-4 bg-background/80 backdrop-blur-sm p-2 rounded-md border border-border shadow-sm">
              <div className="text-xs font-medium mb-1">Map Legend</div>
              <div className="flex items-center gap-2 text-xs">
                <div className="h-3 w-3 rounded-full bg-status-success"></div>
                <span>Available Drivers</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="h-3 w-3 rounded-full bg-ai"></div>
                <span>Active Trips</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapView;
