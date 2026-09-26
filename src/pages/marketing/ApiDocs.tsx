import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Code2, Key, Webhook, Shield, BookOpen, Mail } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { RouteSEO } from "@/components/marketing/RouteSEO";

const sections = [
  { icon: BookOpen, title: "REST API Reference", body: "Resources for trips, riders, drivers, wallets, payments and webhooks. OpenAPI 3.1 schema available." },
  { icon: Key,      title: "Authentication",     body: "OAuth 2.0 client credentials and short-lived bearer tokens. Rotate keys from the developer dashboard." },
  { icon: Code2,    title: "SDKs",               body: "First-party SDKs in TypeScript, Python, Go and Kotlin. Server- and edge-runtime compatible." },
  { icon: Webhook,  title: "Webhooks",           body: "Signed payloads for trip lifecycle, payments, KYC, and dispatch events. Retry with exponential backoff." },
  { icon: Shield,   title: "Rate Limits",        body: "1,000 req/min for sandbox, 10,000 req/min for production. 429 responses include a Retry-After header." },
];

const ApiDocs = () => (
  <MarketingPage>
    <RouteSEO />
    <PageHero
      eyebrow="Developers"
      title="API Documentation"
      subtitle="Build mobility, delivery, and corporate-travel products on the Yalla Mobility platform."
    >
      <div className="flex flex-wrap gap-3 justify-center">
        <Button asChild size="lg">
          <Link to="/auth?mode=register&audience=developer">Get sandbox credentials</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link to="/developers">Developer portal</Link>
        </Button>
      </div>
    </PageHero>

    <section className="container mx-auto px-4 py-16 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      {sections.map(({ icon: Icon, title, body }) => (
        <Card key={title}>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-lg">{title}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
        </Card>
      ))}
    </section>

    <section className="container mx-auto px-4 pb-20">
      <Card>
        <CardHeader>
          <CardTitle>Quick start: create a trip</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted/50 rounded-lg p-4 text-xs overflow-x-auto">{`POST https://api.yalla.africa/v1/trips
Authorization: Bearer <token>
Content-Type: application/json

{
  "rider_id": "rdr_01HZ...",
  "pickup":   { "lat": -1.2921, "lng": 36.8219 },
  "dropoff":  { "lat": -1.3192, "lng": 36.8910 },
  "vehicle_class": "comfort"
}`}</pre>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/contact?subject=api-onboarding">
                <Mail className="h-4 w-4 mr-2" />Talk to developer relations
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/support">Support</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  </MarketingPage>
);

export default ApiDocs;
