import { Download } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";
import { appLink, type AppAudience } from "@/lib/appLinks";
import { trackAppDownload } from "@/lib/appDownloadTracking";

const apps = {
  rider: {
    name: "TaxiD Rider",
    image: "/apps/taxid-rider-app.png",
    description: "Book rides and manage your journeys from your Android phone.",
  },
  driver: {
    name: "TaxiD Driver",
    image: "/apps/taxid-driver-app.png",
    description: "Accept trips and manage your driving activity from your Android phone.",
  },
} as const;

export function AppDownloadCard({ audience, placement }: { audience: AppAudience; placement: string }) {
  const app = apps[audience];

  return (
    <article className="flex min-w-0 items-center gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm">
      <img
        src={app.image}
        alt={`${app.name} app icon`}
        width={256}
        height={256}
        loading="lazy"
        className="h-20 w-20 shrink-0 rounded-lg object-cover shadow-sm sm:h-24 sm:w-24"
      />
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-bold">{app.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{app.description}</p>
        <AppButton
          analytics={`${audience}_google_play_download`}
          action="external"
          target={appLink({ audience, platform: "android", placement })}
          onClick={() => trackAppDownload(audience, placement)}
          size="sm"
          className="mt-3 gap-2"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Get it on Google Play
        </AppButton>
      </div>
    </article>
  );
}