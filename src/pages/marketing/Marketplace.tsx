/**
 * MARKETPLACE — one search across rides, charter, rental and logistics.
 *
 * The customer states the service family, city, date and vehicle type. Whatever
 * capacity operators have published and that matches the brief is listed with
 * its operator, base and indicative rate. Where nothing is published for that
 * family the page says so plainly and hands the brief to the governed request
 * pipeline in the customer portal — no invented listings, ever.
 */
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { SeoHead } from "@/components/seo/SeoHead";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Building2, CalendarDays, MapPin, Search, Users } from "lucide-react";
import ListingPhoto from "@/components/marketplace/ListingPhoto";
import { signCapacityPhotos } from "@/lib/provider/photos";

import {
  EMPTY_QUERY, FAMILY_BLURB, FAMILY_LABEL, SERVICE_FAMILIES, VEHICLE_TYPES,
  basesFrom, rateBasisLabel, requestHandoffPath, searchMarketplace,
  type CapacityListing, type MarketplaceQuery, type ServiceFamily,
} from "@/lib/marketplace/search";

const money = (v: number | null, currency: string) =>
  v === null ? "Rate on request" : `${currency} ${Math.round(v).toLocaleString("en-KE")}`;

function ListingCard({
  listing,
  query,
  photoUrls,
}: {
  listing: CapacityListing;
  query: MarketplaceQuery;
  photoUrls: Record<string, string>;
}) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <ListingPhoto listing={listing} urls={photoUrls} />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{listing.name}</CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" aria-hidden /> {listing.operator}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className="capitalize">{listing.status.replace("-", " ")}</Badge>
            {listing.isTest && (
              <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">Test listing</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-sm">
        <dl className="grid gap-1.5 text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" aria-hidden /> Based at {listing.base}
            {listing.coverage ? ` · serves ${listing.coverage}` : ""}
          </div>
          {listing.capacity && (
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" aria-hidden /> {listing.capacity}
            </div>
          )}
          {listing.spec && <div>{listing.spec}</div>}
          {listing.registration && (
            <div className="font-mono text-xs uppercase">{listing.registration}</div>
          )}
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {listing.availableFrom || listing.availableTo
              ? `Available ${listing.availableFrom ?? "now"} to ${listing.availableTo ?? "further notice"}`
              : "Availability confirmed on request"}
          </div>
        </dl>

        <p className="text-lg font-semibold">
          {money(listing.rate, listing.currency)}
          {listing.rate !== null && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {rateBasisLabel(listing.rateBasis)}
            </span>
          )}
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            Indicative, before your final quotation
          </span>
        </p>
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Button asChild size="sm">
            <Link to={requestHandoffPath(query, listing)}>
              Request this capacity <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/charter/search">Compare in charter search</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Marketplace() {
  const [params, setParams] = useSearchParams();

  const query: MarketplaceQuery = React.useMemo(() => {
    const family = (params.get("family") ?? EMPTY_QUERY.family) as ServiceFamily;
    return {
      family: SERVICE_FAMILIES.includes(family) ? family : EMPTY_QUERY.family,
      city: params.get("city") ?? "",
      date: params.get("date") ?? "",
      vehicleType: params.get("vehicle") ?? "Any vehicle",
    };
  }, [params]);

  const [form, setForm] = React.useState<MarketplaceQuery>(query);
  React.useEffect(() => setForm(query), [query]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["marketplace-search", query],
    queryFn: () => searchMarketplace(query),
  });

  const listings = data ?? [];

  // Signed links for the pictures operators uploaded against these listings.
  const [photoUrls, setPhotoUrls] = React.useState<Record<string, string>>({});
  const photoKey = listings.flatMap((l) => l.photoPaths).join("|");
  React.useEffect(() => {
    let live = true;
    const paths = photoKey ? photoKey.split("|") : [];
    if (paths.length === 0) {
      setPhotoUrls({});
      return;
    }
    void signCapacityPhotos(paths).then((u) => live && setPhotoUrls(u));
    return () => {
      live = false;
    };
  }, [photoKey]);

  const bases = basesFrom(listings);

  const apply = (next: MarketplaceQuery) => {
    const p = new URLSearchParams();
    p.set("family", next.family);
    if (next.city.trim()) p.set("city", next.city.trim());
    if (next.date) p.set("date", next.date);
    if (next.vehicleType && next.vehicleType !== "Any vehicle") p.set("vehicle", next.vehicleType);
    setParams(p);
  };

  return (
    <MarketingLayout>
      <SeoHead
        path="/marketplace"
        title="Marketplace — Search Mobility Capacity by City & Date"
        description="Search rides, charter, vehicle rental and logistics capacity by city, date and vehicle type, then request it through your SAFARID portal."
      />


      <section className="border-b border-border bg-gradient-to-b from-secondary/40 to-background py-14">
        <div className="container mx-auto px-4">
          <h1 className="text-3xl font-bold md:text-4xl">Search transportation capacity</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            One search across rides, charter, vehicle rental and logistics. Tell us the city, the date
            and the vehicle you need; request what fits and your SAFARID contact takes it from there.
          </p>

          <form
            className="mt-8 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5"
            onSubmit={(e) => { e.preventDefault(); apply(form); }}
          >
            <div>
              <Label htmlFor="mp-family">Service</Label>
              <Select
                value={form.family}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, family: v as ServiceFamily, vehicleType: "Any vehicle" }))
                }
              >
                <SelectTrigger id="mp-family"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SERVICE_FAMILIES.map((f) => (
                    <SelectItem key={f} value={f}>{FAMILY_LABEL[f]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mp-city">City or base</Label>
              <Input
                id="mp-city"
                placeholder="e.g. Nairobi"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="mp-date">Date needed</Label>
              <Input
                id="mp-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="mp-vehicle">Vehicle type</Label>
              <Select
                value={form.vehicleType}
                onValueChange={(v) => setForm((f) => ({ ...f, vehicleType: v }))}
              >
                <SelectTrigger id="mp-vehicle"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES[form.family].map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                <Search className="mr-1.5 h-4 w-4" aria-hidden /> Search
              </Button>
            </div>
          </form>

          <p className="mt-3 text-sm text-muted-foreground">{FAMILY_BLURB[query.family]}</p>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">
            {FAMILY_LABEL[query.family]}
            {query.city ? ` in ${query.city}` : ""}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{listings.length} matching</Badge>
            {bases.length > 0 && <Badge variant="outline">{bases.length} bases</Badge>}
          </div>
        </div>

        {isLoading && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 w-full" />)}
          </div>
        )}

        {error && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Capacity could not be loaded</CardTitle>
              <CardDescription>{(error as Error).message}</CardDescription>
            </CardHeader>
          </Card>
        )}

        {!isLoading && !error && listings.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                No published capacity matches this search yet
              </CardTitle>
              <CardDescription>
                {query.family === "charter"
                  ? "Try a different city, date or vehicle type — or send us the brief and we will source it from our operators."
                  : `Operators have not yet published ${FAMILY_LABEL[query.family].toLowerCase()} capacity here. Send us the brief and your SAFARID contact will source it and come back with a quotation.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to={requestHandoffPath(query)}>
                  Send this brief <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="outline"><Link to="/contact">Speak to us</Link></Button>
            </CardContent>
          </Card>
        )}

        {listings.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} query={query} photoUrls={photoUrls} />
            ))}

          </div>
        )}

        <Card className="mt-10">
          <CardHeader>
            <CardTitle className="text-base">Cannot see what you need?</CardTitle>
            <CardDescription>
              Send the brief through your portal. It becomes a tracked request, then a quotation,
              and you can follow it the whole way.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild><Link to={requestHandoffPath(query)}>Request a quotation</Link></Button>
            <Button asChild variant="outline" data-analytics="marketplace_empty_book_ride"><Link to="/rider">Book a ride</Link></Button>
            <Button asChild variant="outline"><Link to="/driver/apply">Join as a driver</Link></Button>
          </CardContent>
        </Card>
      </section>
    </MarketingLayout>
  );
}
