import { useEffect, useState } from "react";
import { RiderShell } from "@/components/rider/RiderShell";
import { ErrorState } from "@/components/rider/ErrorState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, Phone, Trash2, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface Contact {
  id: string;
  name: string;
  relationship: string | null;
  phone_number: string;
  is_primary: boolean;
}

export default function RiderSafetyPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [rel, setRel] = useState("");
  const [phone, setPhone] = useState("");
  const [loadError, setLoadError] = useState(false);

  function refresh() {
    if (!user) return;
    setLoadError(false);
    supabase
      .from("emergency_contacts")
      .select("*")
      .eq("user_id", user.id)
      .then(({ data, error }) => {
        if (error) setLoadError(true);
        else setContacts((data as Contact[]) ?? []);
      });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function add() {
    if (!user || !name || !phone) return;
    const { data, error } = await supabase
      .from("emergency_contacts")
      .insert({ user_id: user.id, name, relationship: rel, phone_number: phone, is_primary: contacts.length === 0 })
      .select("*")
      .single();
    if (error) toast.error(error.message);
    else {
      setContacts([...contacts, data as Contact]);
      setName("");
      setRel("");
      setPhone("");
    }
  }

  async function remove(id: string) {
    await supabase.from("emergency_contacts").delete().eq("id", id);
    setContacts(contacts.filter((c) => c.id !== id));
  }

  async function panic() {
    if (!navigator.geolocation) {
      toast.error("Cannot get location");
      return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { error } = await supabase.rpc("safety_raise_sos", {
        _booking_id: null,
        _lat: pos.coords.latitude,
        _lng: pos.coords.longitude,
        _message: "Panic button activated",
      });
      if (error) toast.error(error.message);
      else toast.success("SOS sent. Emergency contacts notified.");
    });
  }

  return (
    <RiderShell>
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Safety Center</h1>
      </div>

      <Card className="p-6 mb-4 bg-destructive/5 border-destructive/30">
        <h3 className="font-bold text-destructive flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5" /> Panic Button
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Sends your live location and an SOS alert to TaxiD safety operators and your emergency contacts.
        </p>
        <Button variant="destructive" size="lg" onClick={panic} className="w-full sm:w-auto">
          <AlertTriangle className="h-4 w-4 mr-2" /> Trigger SOS now
        </Button>
      </Card>

      <h2 className="font-semibold mb-2">Emergency contacts</h2>
      {loadError && (
        <div className="mb-3">
          <ErrorState
            message="We couldn't load your emergency contacts. Please try again."
            onRetry={refresh}
            testId="rider-safety-error"
          />
        </div>
      )}
      <Card className="p-4 mb-3 space-y-2">
        <div className="grid sm:grid-cols-3 gap-2">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Relationship" value={rel} onChange={(e) => setRel(e.target.value)} />
          <Input placeholder="Phone (+254…)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <Button onClick={add} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add contact
        </Button>
      </Card>

      <div className="space-y-2">
        {contacts.map((c) => (
          <Card key={c.id} className="p-3 flex items-center gap-3">
            <Phone className="h-4 w-4 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">
                {c.name} {c.is_primary && <span className="text-[10px] text-primary">PRIMARY</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {c.relationship} · {c.phone_number}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => remove(c.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </Card>
        ))}
        {contacts.length === 0 && <p className="text-sm text-muted-foreground">No emergency contacts yet.</p>}
      </div>
    </RiderShell>
  );
}
