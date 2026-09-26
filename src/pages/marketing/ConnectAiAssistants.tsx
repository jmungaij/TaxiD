/**
 * CONNECT AI ASSISTANTS — public guide for connecting Claude, ChatGPT and
 * other MCP clients to the SAFARID MCP server.
 *
 * The server is OAuth-protected: callers sign in with their own SAFARID account
 * and every tool runs under that user's row-level security context.
 */
import { useState } from "react";
import {
  Bot, Check, Copy, KeyRound, MessageSquare, Receipt, ShieldCheck,
  Terminal, UserRound, Wallet,
} from "lucide-react";

import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const MCP_URL = "https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/mcp";
const CONNECTOR_NAME = "SAFARID";

const TOOLS = [
  {
    icon: UserRound,
    name: "whoami",
    desc: "Confirm which SAFARID account the assistant is acting as.",
  },
  {
    icon: Wallet,
    name: "wallet_balance",
    desc: "Read your SAFARID wallet balance and currency (KES).",
  },
  {
    icon: Receipt,
    name: "recent_wallet_transactions",
    desc: "List your recent top-ups, ride charges and refunds.",
  },
];

function CopyBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — text remains selectable */
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-border bg-muted/50 p-4 pr-20 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="absolute right-2 top-2 h-7 gap-1 px-2 text-xs"
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 pb-6">
        <h4 className="font-semibold">{title}</h4>
        <div className="mt-1 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

export default function ConnectAiAssistants() {
  return (
    <MarketingPage>
      <SeoHead
        title="Connect AI Assistants — Claude & ChatGPT | SAFARID"
        description="Connect SAFARID to Claude, ChatGPT or any MCP-compatible AI assistant. Check your wallet, trips and transactions by asking — secured with OAuth sign-in."
        path="/developers/ai-assistants"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: "Connect SAFARID to an AI assistant",
          description:
            "Add the SAFARID MCP server to Claude, ChatGPT or another MCP client and sign in with your SAFARID account.",
          step: [
            { "@type": "HowToStep", name: "Copy the MCP server link" },
            { "@type": "HowToStep", name: "Add the connector in your AI assistant" },
            { "@type": "HowToStep", name: "Sign in with your SAFARID account to approve access" },
          ],
        }}
      />

      <PageHero
        eyebrow="AI assistants"
        title="Talk to SAFARID from your AI assistant"
        subtitle="Connect Claude, ChatGPT or any MCP-compatible assistant to SAFARID. Ask about your wallet, trips and transactions — answers come from your own account, under your own permissions."
      />

      {/* MCP endpoint */}
      <section>
        <div className="container mx-auto px-4 py-16">
          <div className="mx-auto max-w-3xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">MCP server</span>
            <h2 className="mt-2 mb-3 text-3xl font-bold">One link, every assistant</h2>
            <p className="mb-6 text-muted-foreground">
              SAFARID exposes a Model Context Protocol (MCP) server. Paste this link into any
              MCP-compatible client to connect:
            </p>
            <CopyBlock code={MCP_URL} label="MCP server link" />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">OAuth 2.1 sign-in</Badge>
              <Badge variant="secondary">Per-user permissions (RLS)</Badge>
              <Badge variant="secondary">Read-only tools today</Badge>
            </div>
          </div>
        </div>
      </section>

      {/* Client setup */}
      <section className="bg-secondary/30">
        <div className="container mx-auto px-4 py-16">
          <div className="mx-auto max-w-3xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Setup</span>
            <h2 className="mt-2 mb-8 text-3xl font-bold">Connect your assistant</h2>

            <Tabs defaultValue="claude">
              <TabsList>
                <TabsTrigger value="claude" className="gap-2">
                  <Terminal className="h-4 w-4" aria-hidden /> Claude
                </TabsTrigger>
                <TabsTrigger value="chatgpt" className="gap-2">
                  <MessageSquare className="h-4 w-4" aria-hidden /> ChatGPT
                </TabsTrigger>
                <TabsTrigger value="lovable" className="gap-2">
                  <Bot className="h-4 w-4" aria-hidden /> Lovable
                </TabsTrigger>
              </TabsList>

              <TabsContent value="claude" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Claude</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ol>
                      <Step n={1} title="Run the install command in your terminal">
                        <CopyBlock
                          code={`claude mcp add --scope user --transport http yalla-mobility '${MCP_URL}'`}
                          label="Claude CLI command"
                        />
                      </Step>
                      <Step n={2} title="Or open Claude's custom connector dialog">
                        The connector name and MCP link should already be filled in. If there is no
                        custom connector option, ask your Claude admin to enable custom connectors.
                      </Step>
                      <Step n={3} title="Review the connector details and click “Add”">
                        If the form is empty, paste the link manually:{" "}
                        <code className="break-all text-xs">{MCP_URL}</code>
                      </Step>
                      <Step n={4} title="Prompt Claude to use SAFARID">
                        Enable the connector from the chat composer before using it, then ask
                        something like “What's my SAFARID wallet balance?”.
                      </Step>
                    </ol>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="chatgpt" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">ChatGPT</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ol>
                      <Step n={1} title="Enable Developer mode">
                        Review the risk notice shown in ChatGPT before enabling it. No Developer
                        mode? Ask your ChatGPT admin to enable it.
                      </Step>
                      <Step n={2} title="Open ChatGPT's new plugin dialog" >
                        From Settings, create a new custom app/connector.
                      </Step>
                      <Step n={3} title="Add SAFARID's details">
                        <div className="space-y-2">
                          <p>
                            <strong className="text-foreground">Name:</strong> {CONNECTOR_NAME}
                          </p>
                          <p className="break-all">
                            <strong className="text-foreground">MCP link:</strong>{" "}
                            <code className="text-xs">{MCP_URL}</code>
                          </p>
                          <CopyBlock code={`Name: ${CONNECTOR_NAME}\nMCP link: ${MCP_URL}`} label="ChatGPT connector details" />
                        </div>
                      </Step>
                      <Step n={4} title="Review the app details and click “Create”">
                        Check “I understand and want to continue”. ChatGPT shows this warning for
                        every custom MCP server, not just yours.
                      </Step>
                      <Step n={5} title="Prompt ChatGPT to use SAFARID">
                        Enable the app from the chat composer before using it.
                      </Step>
                    </ol>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="lovable" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Lovable</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ol>
                      <Step n={1} title="Open the connectors panel">
                        In any Lovable project, open <strong className="text-foreground">More → Agent integrations</strong>.
                      </Step>
                      <Step n={2} title="Find “SAFARID” and click “Add”">
                        The connector list shows the available tools and their descriptions.
                      </Step>
                      <Step n={3} title="Sign in when prompted">
                        Approve access with your SAFARID account. The agent can then call the tools
                        below as you.
                      </Step>
                    </ol>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </section>

      {/* Tools */}
      <section>
        <div className="container mx-auto px-4 py-16">
          <div className="mx-auto max-w-3xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Available tools</span>
            <h2 className="mt-2 mb-3 text-3xl font-bold">What your assistant can do</h2>
            <p className="mb-8 text-muted-foreground">
              Every tool runs as the signed-in user. Row-level security applies — your assistant can
              only ever see your own data.
            </p>
            <div className="grid gap-5 sm:grid-cols-3">
              {TOOLS.map((t) => (
                <article key={t.name} className="rounded-2xl border border-border bg-card p-5">
                  <t.icon className="h-6 w-6 text-primary" aria-hidden />
                  <h3 className="mt-3 font-mono text-sm font-semibold">{t.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="bg-secondary/30">
        <div className="container mx-auto px-4 py-16">
          <div className="mx-auto max-w-3xl">
            <ShieldCheck className="h-10 w-10 text-primary mb-4" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Security</span>
            <h2 className="mt-2 mb-3 text-3xl font-bold">Your account, your consent</h2>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <strong className="text-foreground">OAuth sign-in.</strong> The first time an
                  assistant connects, you approve access with your SAFARID account. No API keys to
                  copy, nothing to leak.
                </span>
              </li>
              <li className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <strong className="text-foreground">Scoped to you.</strong> Tools execute under
                  your row-level security context — exactly what you could see in the app, nothing
                  more.
                </span>
              </li>
              <li className="flex gap-3">
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <strong className="text-foreground">Revocable.</strong> Disconnect the connector
                  in your assistant at any time to end access.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
