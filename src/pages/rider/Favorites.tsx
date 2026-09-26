import { useEffect, useState } from "react";
import { RiderShell } from "@/components/rider/RiderShell";
import { ErrorState } from "@/components/rider/ErrorState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heart, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

interface Fav {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export default function RiderFavoritesPage() {
  const { user } = useAuth();
  const [favs, setFavs] = useState<Fav[]>([]);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [loadError, setLoadError] = useState(false);

  function refresh() {
    if (!user) return;
    setLoadError(false);
    supabase
      .from("favorite_locations")
      .select("*")
      .eq("user_id", user.id)
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setLoadError(true);
        else setFavs((data as Fav[]) ?? []);
      });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function add() {
    if (!user || !label || !address || !lat || !lng) {
      toast.error("Fill all fields");
      return;
    }
    const { data, error } = await supabase
      .from("favorite_locations")
      .insert({ user_id: user.id, label, address, lat: parseFloat(lat), lng: parseFloat(lng) })
      .select("*")
      .single();
    if (error) toast.error(error.message);
    else {
      setFavs([...favs, data as Fav]);
      setLabel("");
      setAddress("");
      setLat("");
      setLng("");
    }
  }

  async function remove(id: string) {
    await supabase.from("favorite_locations").delete().eq("id", id);
    setFavs(favs.filter((f) => f.id !== id));
  }

  return (
    <RiderShell>
      <h1 className="text-2xl font-bold mb-4">Favorite places</h1>

      {loadError && (
        <div className="mb-4">
          <ErrorState
            message="We couldn't load your favorite places. Please try again."
            onRetry={refresh}
            testId="rider-favorites-error"
          />
        </div>
      )}

      <Card className="p-4 mb-4 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Label (Home, Office)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <Input placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} />
          <Input placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
        <Button onClick={add} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Save place
        </Button>
      </Card>

      <div className="space-y-2">
        {favs.length === 0 && <p className="text-sm text-muted-foreground">No favorites yet.</p>}
        {favs.map((f) => (
          <Card key={f.id} className="p-3 flex items-center gap-3">
            <Heart className="h-4 w-4 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{f.label}</div>
              <div className="text-xs text-muted-foreground truncate">{f.address}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => remove(f.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </Card>
        ))}
      </div>
    </RiderShell>
  );
}
