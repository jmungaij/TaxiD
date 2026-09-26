/**
 * PUBLIC SOCIAL SURFACE — "Connect with SAFARID"
 *
 * A consumer of the Social Distribution read service. It contains NO URLs, no
 * per-platform branches and no administrative concepts: it renders whatever
 * the platform has published, in the order the platform declares.
 *
 * Until an authorised administrator supplies and verifies a destination the
 * component renders a non-clickable architectural placeholder — never a fake
 * link, never a generic platform homepage.
 */
import { useEffect, useState } from "react";
import {
  Facebook,
  Instagram,
  Linkedin,
  MessageCircle,
  Music2,
  Twitter,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { listPublishedAccounts, type SocialAccount } from "@/lib/social/api";
import { SocialEvents, trackSocialEvent } from "@/lib/social/analytics";
import { PLATFORM_KIND, isPubliclyLinkable, type SocialPlatformSlug } from "@/lib/social/platforms";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  linkedin: Linkedin,
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  tiktok: Music2,
  x: Twitter,
  whatsapp: MessageCircle,
};

export function useSocialAccounts() {
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  useEffect(() => {
    let alive = true;
    listPublishedAccounts().then((rows) => {
      if (alive) setAccounts(rows);
    });
    return () => {
      alive = false;
    };
  }, []);
  return accounts;
}

export interface SocialLinkProps {
  account: SocialAccount;
  /** Where the control lives, e.g. "footer" — recorded with every event. */
  location: string;
  className?: string;
}

/** ONE implementation for every channel. */
export function SocialLink({ account, location, className }: SocialLinkProps) {
  const Icon = ICONS[account.platform_slug] ?? MessageCircle;
  // Defence in depth: an unverified or unapproved destination is never clickable.
  if (!isPubliclyLinkable(account)) {
    trackSocialEvent(SocialEvents.RENDER_ERROR, {
      platform: account.platform_slug,
      account_id: account.id,
      location,
      reason: "not_publishable",
    });
    return null;
  }
  const label = account.aria_label || `SAFARID on ${account.display_name}`;
  const isConversation = PLATFORM_KIND[account.platform_slug as SocialPlatformSlug] === "CONVERSATION";
  return (
    <a
      href={account.profile_url!}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={label}
      data-analytics={SocialEvents.CLICK}
      data-platform={account.platform_slug}
      onClick={() => {
        if (!account.tracking_enabled) return;
        trackSocialEvent(isConversation ? SocialEvents.WHATSAPP_CLICK : SocialEvents.CLICK, {
          platform: account.platform_slug,
          account_id: account.id,
          location,
          destination: account.profile_url ?? undefined,
        });
      }}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors",
        "text-nav-muted-foreground hover:text-nav-accent hover:bg-nav/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </a>
  );
}

export interface SocialLinksProps {
  location?: string;
  className?: string;
  headingClassName?: string;
  showHeading?: boolean;
}

export function SocialLinks({ location = "footer", className, headingClassName, showHeading = true }: SocialLinksProps) {
  const accounts = useSocialAccounts();

  useEffect(() => {
    if (accounts && accounts.length > 0) {
      trackSocialEvent(SocialEvents.IMPRESSION, { location, count: accounts.length });
    }
  }, [accounts, location]);

  return (
    <section aria-labelledby="connect-with-yalla" className={cn("min-w-0", className)}>
      {showHeading && (
        <h2
          id="connect-with-yalla"
          className={cn("font-semibold mb-3 text-sm uppercase tracking-wider", headingClassName)}
        >
          Connect with SAFARID
        </h2>
      )}
      {accounts === null ? (
        <p className="text-sm text-nav-muted-foreground/80" aria-live="polite">
          Loading channels…
        </p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-nav-muted-foreground/80">
          Official SAFARID social channels are being verified and will appear here once published.
        </p>
      ) : (
        <ul className="flex flex-wrap items-center gap-1">
          {accounts.map((a) => (
            <li key={a.id}>
              <SocialLink account={a} location={location} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default SocialLinks;
