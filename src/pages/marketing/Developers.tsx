import { Link } from "react-router-dom";
import { Code2, KeyRound, Webhook, Workflow, Shield, BookOpen, Terminal } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeoHead } from "@/components/seo/SeoHead";

const API_BASE = "https://api.yallaride.com/v1";

const apis = [
  { icon: Code2, title: "Mobility API", desc: "Quote, book, track, cancel trips. Supports scheduled and airport rides.", path: "/mobility" },
  { icon: Workflow, title: "Delivery API", desc: "Create orders, attach proof-of-delivery, track packages, manage routes.", path: "/delivery" },
  { icon: KeyRound, title: "Wallet API", desc: "Top up, charge, settle and reconcile corporate or personal wallets.", path: "/wallets" },
  { icon: Shield, title: "Identity API", desc: "KYC, risk scoring, ATO defense, GPS integrity, device trust.", path: "/identity" },
  { icon: Webhook, title: "Webhooks", desc: "Subscribe to every domain event with signed payloads and retries.", path: "/webhooks" },
  { icon: Workflow, title: "Event streams", desc: "Replay any domain event for audit, BI, or model training.", path: "/events" },
];

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="rounded-lg bg-muted-foreground text-muted-foreground p-4 overflow-x-auto text-xs leading-relaxed">
    <code>{children}</code>
  </pre>
);

export default function Developers() {
  return (
    <MarketingPage>
      <SeoHead
        title="TaxiD for developers — Mobility, Delivery, Wallet & Identity APIs"
        description="REST APIs, webhooks and event streams for mobility, delivery, rentals and identity. Token-based auth, signed webhooks, sandbox environments."
        path="/developers"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: "TaxiD Developer Platform",
          about: "Mobility, Delivery, Wallet, Identity APIs",
        }}
      />
      <PageHero
        eyebrow="Developers"
        title="Build on TaxiD"
        subtitle="REST APIs, signed webhooks and event streams for mobility, delivery, rentals and identity. Token-based auth, sandbox environments, OpenAPI spec."
      >
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="bg-ice text-primary hover:bg-ice/90">
            <a href="#quickstart">Quickstart</a>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-ice/70 text-ice hover:bg-ice/20">
            <Link to="/enterprise">Talk to platform team</Link>
          </Button>
        </div>
      </PageHero>

      {/* APIs */}
      <section>
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl mb-10">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Platform surfaces</span>
            <h2 className="text-3xl font-bold mt-2 mb-3">Six APIs, one platform</h2>
            <p className="text-muted-foreground text-lg">
              Every API is REST, JSON, and versioned. Idempotency keys are required on every write.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {apis.map((a) => (
              <div key={a.title} className="p-6 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors">
                <a.icon className="h-7 w-7 text-primary mb-3" />
                <h3 className="font-semibold mb-2">{a.title}</h3>
                <p className="text-sm text-muted-foreground mb-3">{a.desc}</p>
                <code className="text-xs text-primary">{API_BASE}{a.path}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI assistants (MCP) */}
      <section className="bg-secondary/30">
        <div className="container mx-auto px-4 py-16">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-border bg-card p-8 md:flex-row md:items-center">
            <div className="max-w-2xl">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">AI assistants · MCP</span>
              <h2 className="text-2xl font-bold mt-2 mb-2">Use TaxiD from Claude or ChatGPT</h2>
              <p className="text-muted-foreground">
                Connect the TaxiD MCP server to your AI assistant and ask about your wallet,
                trips and transactions — secured with OAuth sign-in.
              </p>
            </div>
            <Button asChild size="lg" className="shrink-0">
              <Link to="/developers/ai-assistants">Connect an AI assistant</Link>
            </Button>
          </div>
        </div>
      </section>
      <section className="bg-secondary/30" id="auth">
        <div className="container mx-auto px-4 py-16">
          <div className="grid lg:grid-cols-2 gap-10 items-start">
            <div>
              <KeyRound className="h-10 w-10 text-primary mb-4" />
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">Authentication</span>
              <h2 className="text-3xl font-bold mt-2 mb-3">Bearer tokens, scoped & rotatable</h2>
              <p className="text-muted-foreground mb-4">
                Generate an API key in the developer portal. Every key carries a scope (mobility, delivery, wallet, identity) and an environment (sandbox / production).
              </p>
              <ul className="space-y-2 text-sm">
                <li><strong className="text-foreground">Header:</strong> <code>Authorization: Bearer YR_LIVE_…</code></li>
                <li><strong className="text-foreground">Idempotency:</strong> <code>Idempotency-Key: &lt;uuid&gt;</code> on every POST</li>
                <li><strong className="text-foreground">Rotation:</strong> rotate without downtime; old key valid 24h</li>
                <li><strong className="text-foreground">Sandbox:</strong> identical contract, no real money or trips</li>
                <li><strong className="text-foreground">Rate limit:</strong> 600 req/min default, lift on request</li>
              </ul>
            </div>
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Exchange credentials for an access token</div>
              <CodeBlock>{`curl -X POST ${API_BASE}/auth/token \\
  -H "Content-Type: application/json" \\
  -d '{
    "client_id":  "yr_client_…",
    "client_secret": "yr_secret_…",
    "scope": "mobility delivery wallet"
  }'

# → { "access_token": "YR_LIVE_…", "expires_in": 3600 }`}</CodeBlock>
            </div>
          </div>
        </div>
      </section>

      {/* Quickstart */}
      <section id="quickstart">
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl mb-10">
            <Terminal className="h-10 w-10 text-primary mb-4" />
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Quickstart</span>
            <h2 className="text-3xl font-bold mt-2 mb-3">Your first request</h2>
            <p className="text-muted-foreground">
              Quote a trip, book it, and subscribe to status updates — all from the sandbox.
            </p>
          </div>

          <Tabs defaultValue="curl" className="max-w-4xl">
            <TabsList>
              <TabsTrigger value="curl">cURL</TabsTrigger>
              <TabsTrigger value="js">Node.js</TabsTrigger>
              <TabsTrigger value="py">Python</TabsTrigger>
            </TabsList>
            <TabsContent value="curl" className="mt-4">
              <CodeBlock>{`# 1. Quote a trip
curl -X POST ${API_BASE}/mobility/quotes \\
  -H "Authorization: Bearer $YR_TOKEN" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "pickup":  { "lat": -1.2921, "lng": 36.8219 },
    "dropoff": { "lat": -1.3197, "lng": 36.9258 },
    "product": "yalla_x"
  }'

# 2. Book using the returned quote_id
curl -X POST ${API_BASE}/mobility/trips \\
  -H "Authorization: Bearer $YR_TOKEN" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{ "quote_id": "qt_…", "rider_id": "rdr_…" }'`}</CodeBlock>
            </TabsContent>
            <TabsContent value="js" className="mt-4">
              <CodeBlock>{`import { YallaRide } from "@yallaride/sdk";

const yr = new YallaRide({ apiKey: process.env.YR_TOKEN! });

const quote = await yr.mobility.quotes.create({
  pickup:  { lat: -1.2921, lng: 36.8219 },
  dropoff: { lat: -1.3197, lng: 36.9258 },
  product: "yalla_x",
});

const trip = await yr.mobility.trips.create({
  quote_id: quote.id,
  rider_id: "rdr_…",
});

console.log(trip.id, trip.status);`}</CodeBlock>
            </TabsContent>
            <TabsContent value="py" className="mt-4">
              <CodeBlock>{`from yallaride import YallaRide

yr = YallaRide(api_key=os.environ["YR_TOKEN"])

quote = yr.mobility.quotes.create(
    pickup={"lat": -1.2921, "lng": 36.8219},
    dropoff={"lat": -1.3197, "lng": 36.9258},
    product="yalla_x",
)

trip = yr.mobility.trips.create(
    quote_id=quote.id,
    rider_id="rdr_…",
)

print(trip.id, trip.status)`}</CodeBlock>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      {/* Webhooks */}
      <section className="bg-secondary/30" id="webhooks">
        <div className="container mx-auto px-4 py-16">
          <div className="grid lg:grid-cols-2 gap-10 items-start">
            <div>
              <Webhook className="h-10 w-10 text-primary mb-4" />
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">Webhooks</span>
              <h2 className="text-3xl font-bold mt-2 mb-3">Signed events, exactly-once delivery</h2>
              <p className="text-muted-foreground mb-4">
                Subscribe to <code>trip.*</code>, <code>package.*</code>, <code>wallet.*</code>, <code>identity.*</code> events.
                Every payload is signed; verify with HMAC-SHA256 of the raw body.
              </p>
              <ul className="space-y-2 text-sm">
                <li><strong className="text-foreground">Header:</strong> <code>YR-Signature: t=…,v1=…</code></li>
                <li><strong className="text-foreground">Retries:</strong> exponential backoff over 24h</li>
                <li><strong className="text-foreground">Replay:</strong> POST <code>/events/{`{id}`}/replay</code></li>
              </ul>
            </div>
            <CodeBlock>{`import crypto from "crypto";

export function verify(req) {
  const sig = req.headers["yr-signature"];
  const [, t, v1] = sig.match(/t=(\\d+),v1=([a-f0-9]+)/)!;
  const expected = crypto
    .createHmac("sha256", process.env.YR_WEBHOOK_SECRET!)
    .update(\`\${t}.\${req.rawBody}\`)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(v1),
  );
}`}</CodeBlock>
          </div>
        </div>
      </section>

      <section>
        <div className="container mx-auto px-4 py-16 text-center max-w-2xl">
          <BookOpen className="h-10 w-10 text-primary mx-auto mb-4" />
          <h2 className="text-3xl font-bold mb-3">Full API reference</h2>
          <p className="text-muted-foreground mb-6">
            OpenAPI spec, SDKs (Node, Python, Go), Postman collection, and live changelog — all in the developer portal.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg"><a href="/api-docs">Open API reference</a></Button>
            <Button asChild size="lg" variant="outline"><Link to="/enterprise">Request sandbox access</Link></Button>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
