import { useMemo, useState } from "react";
import { Check, Copy, MessageSquare, RefreshCw, Terminal } from "lucide-react";
import { BRAND } from "@/config/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function deriveMcpUrl(): string {
  const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseUrl = new URL(configuredSupabaseUrl);
  const authority = configuredSupabaseUrl.match(/^https?:\/\/([^/?#]*)/i)?.[1];
  const loopbackAuthority = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(authority);
  if (
    !authority ||
    authority.includes("@") ||
    configuredSupabaseUrl.includes("?") ||
    configuredSupabaseUrl.includes("#") ||
    (supabaseUrl.protocol === "http:" && !loopbackAuthority)
  ) {
    throw new Error(
      "VITE_SUPABASE_URL must use HTTPS unless it targets localhost or a loopback IP, and must not contain credentials, query, or fragment",
    );
  }
  const legacyLovableCloud =
    supabaseUrl.hostname.endsWith(".lovable.cloud") && !supabaseUrl.hostname.startsWith("c--");
  const dataPlaneUrl = legacyLovableCloud
    ? `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`
    : supabaseUrl.toString().replace(/\/+$/, "");
  return `${dataPlaneUrl}/functions/v1/mcp`;
}

function slugifyAppName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  const base = slug || "lovable-app";
  const reserved = ["workspace", "computer-use", "claude-in-chrome", "claude-preview", "claude-browser"];
  return reserved.includes(base) ? `${base}-app` : base;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable */
        }
      }}
      aria-label={label}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function StepList({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {i + 1}
          </span>
          <span className="text-sm leading-6 text-foreground">{step}</span>
        </li>
      ))}
    </ol>
  );
}

export default function ConnectAgent() {
  const mcpUrl = useMemo(() => deriveMcpUrl(), []);
  const appSlug = useMemo(() => slugifyAppName(BRAND.name), []);
  const claudeCodeCommand = `claude mcp add --scope user --transport http ${appSlug} '${mcpUrl.replace(/'/g, `'\\''`)}'`;
  const claudePrefillUrl = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(
    BRAND.name,
  )}&connectorUrl=${encodeURIComponent(mcpUrl)}`;

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Connect an AI assistant to {BRAND.name}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
          Link ChatGPT, Claude, or another AI assistant to {BRAND.name} so it can check your support
          cases, reply to riders, and update case status on your behalf.
        </p>
      </header>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg">Your {BRAND.name} connection address</CardTitle>
          <CardDescription>
            Paste this address into your AI assistant when it asks for the server URL.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 p-4 sm:flex-row sm:items-center">
            <code className="flex-1 break-all font-mono text-sm text-foreground">{mcpUrl}</code>
            <CopyButton value={mcpUrl} label="Copy the connection address" />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5 text-primary" />
            Connect your assistant
          </CardTitle>
          <CardDescription>Pick your assistant and follow the steps.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="chatgpt">
            <TabsList className="mb-6 flex-wrap">
              <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="claude">Claude</TabsTrigger>
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="other">Other assistants</TabsTrigger>
            </TabsList>

            <TabsContent value="chatgpt">
              <StepList
                steps={[
                  <>
                    Open{" "}
                    <a
                      className="text-primary underline"
                      href="https://chatgpt.com/#settings/Connectors/Advanced"
                      target="_blank"
                      rel="noreferrer"
                    >
                      ChatGPT's connector settings
                    </a>{" "}
                    and turn on Developer mode (read the risk notice shown there). If Developer mode
                    is unavailable, ask a ChatGPT admin to enable it.
                  </>,
                  <>
                    Open the{" "}
                    <a
                      className="text-primary underline"
                      href="https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins"
                      target="_blank"
                      rel="noreferrer"
                    >
                      new connector dialog
                    </a>
                    .
                  </>,
                  <>
                    Enter <strong>{BRAND.name}</strong> as the name and paste the connection address
                    above into the URL field.
                  </>,
                  <>
                    Review the details, tick "I understand and want to continue" (ChatGPT shows this
                    warning for every custom connector, not just this one), then click{" "}
                    <strong>Create</strong>.
                  </>,
                  <>Enable {BRAND.name} from the chat composer, then ask ChatGPT to use it.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="claude">
              <StepList
                steps={[
                  <>
                    Open{" "}
                    <a className="text-primary underline" href={claudePrefillUrl} target="_blank" rel="noreferrer">
                      Claude's add-connector page
                    </a>{" "}
                    — the name and address are already filled in for you.
                  </>,
                  <>
                    Review the details and click <strong>Add</strong>.
                  </>,
                  <>
                    If the pre-filled form does not open, open Claude's Connectors page, choose
                    "Add custom connector", name it <strong>{BRAND.name}</strong>, and paste the
                    connection address above.
                  </>,
                  <>Enable the connector from the chat composer, then ask Claude to use {BRAND.name}.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="claude-code">
              <StepList
                steps={[
                  <>Run this one-line command in a terminal:</>,
                ]}
              />
              <div className="my-4 flex flex-col gap-3 rounded-lg border border-border bg-muted/50 p-4 sm:flex-row sm:items-center">
                <code className="flex-1 break-all font-mono text-sm text-foreground">
                  {claudeCodeCommand}
                </code>
                <CopyButton value={claudeCodeCommand} label="Copy the Claude Code install command" />
              </div>
              <StepList
                steps={[
                  <>
                    Start Claude Code and run <code className="font-mono text-sm">/mcp</code> to
                    confirm {BRAND.name} is connected. Claude Code asks you to sign in from that
                    menu only when the app protects its tools.
                  </>,
                  <>Ask Claude Code to use {BRAND.name}.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="other">
              <StepList
                steps={[
                  <>Open your assistant's MCP server or custom connector settings.</>,
                  <>Create a remote MCP server connection.</>,
                  <>
                    Name it <strong>{BRAND.name}</strong> and paste the connection address above.
                  </>,
                  <>Finish any sign-in or authorization prompts.</>,
                  <>Enable the connection, then ask the assistant to use {BRAND.name}.</>,
                ]}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <RefreshCw className="h-5 w-5 text-primary" />
            Refresh after {BRAND.name} changes
          </CardTitle>
          <CardDescription>
            A connected assistant remembers the tool list from when it connected. After {BRAND.name}{" "}
            ships changes, refresh the connection to get the latest tools.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="chatgpt">
            <TabsList className="mb-6 flex-wrap">
              <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="claude">Claude</TabsTrigger>
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="other">Other assistants</TabsTrigger>
            </TabsList>

            <TabsContent value="chatgpt">
              <StepList
                steps={[
                  <>Open ChatGPT's Plugins page and select {BRAND.name}.</>,
                  <>
                    Scroll down to "Information" and click <strong>Refresh</strong>.
                  </>,
                  <>
                    ChatGPT can't update an existing connector's address — if it changed, delete the
                    connector from Plugins and repeat the connect steps above with the latest
                    address.
                  </>,
                  <>Start a new chat and ask ChatGPT to use {BRAND.name}.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="claude">
              <StepList
                steps={[
                  <>Open the Connectors page and select the {BRAND.name} connector.</>,
                  <>Refresh or update the connector's tools.</>,
                  <>
                    Claude can't update an existing connector's address — if it changed, remove the
                    connector and repeat the connect steps above with the latest address.
                  </>,
                  <>Ask Claude to use {BRAND.name}.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="claude-code">
              <StepList
                steps={[
                  <>
                    Start a new Claude Code session — it loads {BRAND.name}'s latest tools when it
                    connects.
                  </>,
                  <>
                    If the address changed, run{" "}
                    <code className="font-mono text-sm">claude mcp remove {appSlug}</code>, then run
                    the install command above again with the latest address.
                  </>,
                  <>Ask Claude Code to use {BRAND.name}.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="other">
              <StepList
                steps={[
                  <>Open your assistant's MCP server or connector settings.</>,
                  <>Select the connection you created for {BRAND.name}.</>,
                  <>Refresh the tool list, reload the server, or reconnect it.</>,
                  <>If the address changed, paste the latest address from above.</>,
                  <>Start a new chat or session and ask the assistant to use {BRAND.name}.</>,
                ]}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <p className="mt-8 flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <Terminal className="h-4 w-4" />
        Once connected, your assistant can view your assigned support cases, read case details,
        reply to riders, and update case status — always acting as your signed-in account.
      </p>
    </main>
  );
}
