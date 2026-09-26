import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";

// Eager imports so bundler hashes and ships these — db image_url is just a key.
import basic from "@/assets/vehicles/yalla-basic.jpg";
import standard from "@/assets/vehicles/yalla-standard.jpg";
import plus from "@/assets/vehicles/yalla-plus.jpg";
import executive from "@/assets/vehicles/yalla-executive.jpg";
import tourCruiser from "@/assets/vehicles/yalla-tour-cruiser.jpg";
import shuttle from "@/assets/vehicles/yalla-shuttle.jpg";
import coaster from "@/assets/vehicles/yalla-coaster.jpg";
import bus from "@/assets/vehicles/yalla-bus.jpg";

const IMG: Record<string, string> = {
  "yalla-basic": basic,
  "yalla-standard": standard,
  "yalla-plus": plus,
  "yalla-executive": executive,
  "yalla-tour-cruiser": tourCruiser,
  "yalla-shuttle": shuttle,
  "yalla-coaster": coaster,
  "yalla-bus": bus,
};

interface Category {
  slug: string;
  name: string;
  seats: number;
  vehicle_class: string;
  base_description: string | null;
  sort_order: number;
}

export function VehicleCategoryGrid({ onSelect }: { onSelect?: (slug: string) => void }) {
  const [cats, setCats] = useState<Category[] | null>(null);

  useEffect(() => {
    supabase
      .from("ride_categories")
      .select("slug,name,seats,vehicle_class,base_description,sort_order")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setCats((data as Category[]) ?? []));
  }, []);

  if (!cats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {cats.map((c) => (
        <Card
          key={c.slug}
          onClick={() => onSelect?.(c.slug)}
          className="group overflow-hidden cursor-pointer hover:shadow-lg transition border-border"
        >
          <div className="aspect-[4/3] bg-brand-sapphire overflow-hidden">
            <img
              src={IMG[c.slug]}
              alt={`${c.name} — ${c.vehicle_class}`}
              loading="lazy"
              width={1024}
              height={768}
              className="w-full h-full object-cover group-hover:scale-105 transition"
            />
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-sm">{c.name}</h3>
              <span className="inline-flex items-center text-xs text-muted-foreground">
                <Users className="h-3 w-3 mr-1" />
                {c.seats}
              </span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">{c.base_description}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default VehicleCategoryGrid;
