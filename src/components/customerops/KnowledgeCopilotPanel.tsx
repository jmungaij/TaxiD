/**
 * Customer Operations — Knowledge Base copilot panel.
 *
 * Lets an agent search policies, FAQs, travel rules, refund policy and support
 * scripts, then compose and insert a suggested reply built from the selected
 * articles.
 */
import { useMemo, useState } from "react";
import { BookOpen, Copy, Search, Sparkles, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import StatCard from "@/components/common/StatCard";
import { toast } from "@/hooks/use-toast";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import {
  KNOWLEDGE_BASE,
  KNOWLEDGE_KIND_LABEL,
  composeSuggestedReply,
  knowledgeForCase,
  searchKnowledge,
  type KnowledgeArticle,
  type KnowledgeKind,
} from "@/lib/customerops/knowledgeBase";
import type { CaseType } from "@/lib/customerops/taxonomy";

const KINDS: KnowledgeKind[] = ["policy", "faq", "travel_rule", "refund_policy", "script", "escalation"];

export interface KnowledgeCopilotContext {
  caseNumber?: string | null;
  subject?: string | null;
  description?: string | null;
  caseType?: CaseType;
  customerName?: string | null;
}

export function KnowledgeCopilotPanel({
  context,
  agentName,
}: {
  context: KnowledgeCopilotContext | null;
  agentName?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<KnowledgeKind[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const hits = useMemo(() => {
    if (query.trim()) {
      return searchKnowledge(query, {
        caseType: context?.caseType,
        kinds: kinds.length ? kinds : undefined,
        limit: 8,
      });
    }
    const primed = knowledgeForCase({
      subject: context?.subject,
      description: context?.description,
      caseType: context?.caseType,
    });
    return kinds.length ? primed.filter((h) => kinds.includes(h.article.kind)) : primed;
  }, [query, kinds, context]);

  const chosen: KnowledgeArticle[] = useMemo(
    () => selected.map((id) => KNOWLEDGE_BASE.find((a) => a.id === id)).filter(Boolean) as KnowledgeArticle[],
    [selected],
  );

  const toggleKind = (k: KnowledgeKind) =>
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const toggleArticle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const insert = () => {
    if (chosen.length === 0) {
      toast({ title: "Select an article", description: "Pick at least one knowledge article to compose a reply." });
      return;
    }
    setDraft(
      composeSuggestedReply(chosen, {
        customerName: context?.customerName,
        agentName,
        caseNumber: context?.caseNumber,
      }),
    );
    toast({ title: "Suggested reply inserted", description: `${chosen.length} source article(s) cited.` });
  };

  return (
    <SectionErrorBoundary sectionName="Knowledge Base Copilot">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Knowledge articles"
            value={KNOWLEDGE_BASE.length}
            icon={<BookOpen className="h-5 w-5 text-primary" />}
            description="Policies, FAQs, rules and scripts"
          />
          <StatCard
            title="Matches for this case"
            value={hits.length}
            icon={<Search className="h-5 w-5 text-primary" />}
            description={context?.caseNumber ? `Primed from ${context.caseNumber}` : "Search to narrow results"}
          />
          <StatCard
            title="Selected sources"
            value={chosen.length}
            icon={<Sparkles className="h-5 w-5 text-primary" />}
            description="Cited in the composed reply"
          />
          <StatCard
            title="Top relevance"
            value={hits[0]?.score ?? 0}
            icon={<Wand2 className="h-5 w-5 text-primary" />}
            description={hits[0] ? hits[0].article.title : "No match yet"}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="text-base">Search the knowledge base</CardTitle>
              <div>
                <Label htmlFor="kb-search" className="sr-only">
                  Search policies, FAQs, travel rules, refund policy and scripts
                </Label>
                <Input
                  id="kb-search"
                  placeholder="e.g. double charged, cancellation fee, lost phone"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={kinds.includes(k) ? "secondary" : "outline"}
                    aria-pressed={kinds.includes(k)}
                    onClick={() => toggleKind(k)}
                  >
                    {KNOWLEDGE_KIND_LABEL[k]}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[420px] px-6 pb-6">
                {hits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No article matches that search. Try a shorter phrase such as "refund" or "safety".
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {hits.map(({ article, score, matched }) => {
                      const isSelected = selected.includes(article.id);
                      return (
                        <li key={article.id} className={`rounded-lg border p-3 ${isSelected ? "bg-muted/50" : ""}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{article.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {KNOWLEDGE_KIND_LABEL[article.kind]} · {article.owner} · v{article.version}
                                {score > 0 ? ` · relevance ${score}` : ""}
                              </p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant={isSelected ? "secondary" : "outline"}
                              onClick={() => toggleArticle(article.id)}
                              aria-pressed={isSelected}
                            >
                              {isSelected ? "Selected" : "Use"}
                            </Button>
                          </div>
                          <p className="mt-2 text-xs">{article.summary}</p>
                          {matched.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {matched.slice(0, 5).map((m) => (
                                <Badge key={m} variant="outline" className="text-[10px]">
                                  {m}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Suggested reply</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={insert}>
                  Insert suggestion
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!draft}
                  onClick={() => {
                    void navigator.clipboard?.writeText(draft);
                    toast({ title: "Reply copied", description: "Paste into the customer's channel." });
                  }}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Copy
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={16}
                placeholder="Select one or more knowledge articles, then insert a policy-grounded reply and edit before sending."
                aria-label="Suggested reply drafted from the knowledge base"
              />
              {chosen.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Citing: {chosen.map((a) => `${a.title} (v${a.version})`).join(" · ")}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </SectionErrorBoundary>
  );
}
