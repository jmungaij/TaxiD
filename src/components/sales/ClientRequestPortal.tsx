/**
 * CLIENT REQUEST PORTAL — the company's own request desk behind its private
 * portal link. The company submits a delivery or transport request itself and
 * tracks what we have done with it. Status is written only by the specialist who
 * owns the account, so nothing shown here is a claim the client made about us.
 */
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Truck } from "lucide-react";
import {
  CLIENT_REQUEST_STATUS_LABEL,
  CLIENT_SERVICE_TYPES,
  SERVICE_TYPE_LABEL,
  submitClientRequest,
  type ClientRequestPublic,
  type ClientServiceType,
} from "@/lib/sales/leadDesk";

const REASONS: Record<string, string> = {
  INVALID_LINK: "This link is no longer valid. Please write to us instead.",
  ROUTE_REQUIRED: "Please tell us where the job starts and where it ends.",
  SERVICE_TYPE_REQUIRED: "Please choose what kind of job this is.",
  TOO_MANY_REQUESTS: "You have sent us several requests in the last hour. Please give us a moment.",
};

const dt = (v?: string | null) =>
  v
    ? new Date(v).toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Nairobi",
      })
    : null;

const day = (v?: string | null) =>
  v ? new Date(`${v}T00:00:00`).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : null;

function StatusBadge({ status }: { status: ClientRequestPublic["status"] }) {
  const tone =
    status === "COMPLETED" || status === "SCHEDULED"
      ? "bg-success/10 text-success border-success/30"
      : status === "DECLINED" || status === "CANCELLED"
        ? "bg-muted text-muted-foreground"
        : "bg-primary/10 text-primary border-primary/30";
  return (
    <Badge variant="outline" className={tone}>
      {CLIENT_REQUEST_STATUS_LABEL[status]}
    </Badge>
  );
}

export default function ClientRequestPortal({
  token,
  organisation,
  contactName,
  requests,
  onSubmitted,
}: {
  token: string;
  organisation?: string;
  contactName?: string;
  requests: ClientRequestPublic[];
  onSubmitted: () => void;
}) {
  const [type, setType] = React.useState<ClientServiceType>("DELIVERY");
  const [pickup, setPickup] = React.useState("");
  const [dropoff, setDropoff] = React.useState("");
  const [date, setDate] = React.useState("");
  const [time, setTime] = React.useState("");
  const [goods, setGoods] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [passengers, setPassengers] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [ref, setRef] = React.useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      submitClientRequest({
        token,
        service_type: type,
        pickup_location: pickup.trim(),
        dropoff_location: dropoff.trim(),
        requested_date: date || undefined,
        requested_time: time.trim() || undefined,
        goods_description: goods.trim() || undefined,
        weight_kg: weight.trim() || undefined,
        passengers: passengers.trim() || undefined,
        notes: notes.trim() || undefined,
        submitted_by_name: name.trim() || contactName || undefined,
        contact_phone: phone.trim() || undefined,
      }),
    onSuccess: (res) => {
      if (res.ok && res.request_ref) {
        setRef(res.request_ref);
        setPickup("");
        setDropoff("");
        setDate("");
        setTime("");
        setGoods("");
        setWeight("");
        setPassengers("");
        setNotes("");
        onSubmitted();
      }
    },
  });

  const reason = submit.data && !submit.data.ok ? (REASONS[submit.data.reason ?? ""] ?? "We could not record this request.") : null;
  const isPeople = type === "STAFF_TRANSPORT" || type === "AIRPORT_TRANSFER" || type === "CHARTER";

  return (
    <>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4" aria-hidden /> Send us a job
          </CardTitle>
          <CardDescription>
            {organisation ? `${organisation} · ` : ""}Tell us what you need moved and we will come back
            to you with a price and a time. Nothing is charged from this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>What kind of job is it?</Label>
            <div className="flex flex-wrap gap-1.5">
              {CLIENT_SERVICE_TYPES.map((s) => (
                <Button
                  key={s.id}
                  type="button"
                  size="sm"
                  variant={type === s.id ? "secondary" : "outline"}
                  onClick={() => setType(s.id)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="pickup">Collection from</Label>
              <Input
                id="pickup"
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
                placeholder="Building, street, area"
              />
            </div>
            <div>
              <Label htmlFor="dropoff">Going to</Label>
              <Input
                id="dropoff"
                value={dropoff}
                onChange={(e) => setDropoff(e.target.value)}
                placeholder="Building, street, area"
              />
            </div>
            <div>
              <Label htmlFor="date">Date needed</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="time">Time needed</Label>
              <Input
                id="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="e.g. 8:30am, or any time before noon"
              />
            </div>
            {isPeople ? (
              <div>
                <Label htmlFor="pax">How many people</Label>
                <Input
                  id="pax"
                  inputMode="numeric"
                  value={passengers}
                  onChange={(e) => setPassengers(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="weight">Approximate weight (kg)</Label>
                <Input
                  id="weight"
                  inputMode="decimal"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </div>
            )}
            <div>
              <Label htmlFor="phone">Phone we should call</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          {!isPeople && (
            <div>
              <Label htmlFor="goods">What is being moved</Label>
              <Textarea
                id="goods"
                rows={3}
                value={goods}
                onChange={(e) => setGoods(e.target.value)}
                placeholder="Cartons, documents, equipment — anything we should know about handling"
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="who">Your name</Label>
              <Input
                id="who"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={contactName ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="rnotes">Anything else</Label>
              <Input id="rnotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {ref && (
            <p className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
              Thank you — your request is with us as <span className="font-medium">{ref}</span>. It
              appears below and we will update its status as we work on it.
            </p>
          )}
          {reason && <p className="text-sm text-destructive">{reason}</p>}
          {submit.error && (
            <p className="text-sm text-destructive">
              Your request was not sent. Please try again in a moment.
            </p>
          )}

          <Button
            disabled={pickup.trim().length < 3 || dropoff.trim().length < 3 || submit.isPending}
            onClick={() => submit.mutate()}
          >
            Send this request
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Your requests</CardTitle>
          <CardDescription>
            {requests.length === 0
              ? "You have not sent us a job through this page yet."
              : `${requests.length} request${requests.length === 1 ? "" : "s"} on record`}
          </CardDescription>
        </CardHeader>
        {requests.length > 0 && (
          <CardContent className="space-y-3">
            {requests.map((r) => (
              <div key={r.request_ref} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {SERVICE_TYPE_LABEL[r.service_type] ?? r.service_type} · {r.request_ref}
                  </p>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {r.pickup_location} → {r.dropoff_location}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {day(r.requested_date) ? `Needed ${day(r.requested_date)}` : "No date given"}
                  {r.requested_time ? ` · ${r.requested_time}` : ""} · sent {dt(r.created_at)}
                </p>
                {r.status_note && (
                  <p className="mt-2 rounded-md border bg-muted/40 p-2 text-sm">{r.status_note}</p>
                )}
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </>
  );
}
