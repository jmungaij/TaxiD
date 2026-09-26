import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import BookingWizard from "@/components/meetings/BookingWizard";

export default function BookAMeeting() {
  return (
    <MarketingPage>
      <PageHero eyebrow="Book a meeting" title="Book a Meeting with SAFARID"
        subtitle="Choose a convenient time to speak with our team. Select your meeting type, choose an available time, and receive your Google Meet invitation instantly." />
      <section className="container mx-auto max-w-5xl px-4 py-12">
        <BookingWizard mode="client" />
      </section>
    </MarketingPage>
  );
}
