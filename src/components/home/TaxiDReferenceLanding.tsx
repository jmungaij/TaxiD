import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, Car, Briefcase, Bus, Package, KeyRound, Plane, MapPin, Navigation, Clock,
  Users, ClipboardCheck, Coins, BarChart3, Receipt,
} from "lucide-react";
import { appLink } from "@/lib/appLinks";
import riderApp from "@/assets/apps/taxid-rider-app.png.asset.json";
import driverApp from "@/assets/apps/taxid-driver-app.png.asset.json";
import heroImg from "@/assets/home/taxid-ref-hero.jpg";
import businessImg from "@/assets/home/taxid-ref-business.jpg";
import bookingImg from "@/assets/home/taxid-ref-booking.jpg";
import networkImg from "@/assets/home/taxid-network-hero.jpg";
import rideImg from "@/assets/riders.jpg";
import corpImg from "@/assets/corporates.jpg";
import busImg from "@/assets/charter/enterprise-fleet.jpg";
import parcelImg from "@/assets/delivery/taxid-parcel-scene.jpg";
import rentImg from "@/assets/rentals/cat-suv.jpg";
import jetImg from "@/assets/charter/jet-exterior.jpg";
import driverImg from "@/assets/drivers.jpg";
import fleetImg from "@/assets/partners/econ-network.jpg";
import logisticsImg from "@/assets/delivery/taxid-logistics-scene.jpg";
import airportImg from "@/assets/charter/airport-international.jpg";

/* Sapphire tokens defined in index.css (--tx-*) */
const deep = "hsl(var(--tx-deep))";
const glass = "border border-[hsl(var(--tx-cyan)/0.35)] bg-[hsl(var(--tx-royal)/0.35)] backdrop-blur-md shadow-[0_0_30px_-10px_hsl(var(--tx-cyan)/0.6)]";
const goldBtn = "inline-flex items-center gap-2 rounded-md bg-[hsl(var(--tx-gold))] px-6 py-3 text-sm font-bold text-[hsl(var(--tx-ink))] transition hover:brightness-110";
const ghostBtn = "inline-flex items-center gap-2 rounded-md border border-[hsl(var(--tx-cyan)/0.5)] px-6 py-3 text-sm font-semibold text-[hsl(var(--tx-ice))] transition hover:bg-[hsl(var(--tx-cyan)/0.15)]";
const accent = "text-[hsl(var(--tx-cyan))]";

const services = [
  { icon: Car, title: "Ride Hailing", desc: "Everyday rides, airport transfers and scheduled trips.", img: rideImg, to: "/riders" },
  { icon: Briefcase, title: "Business Mobility", desc: "Employee travel, corporate mobility and expense control.", img: corpImg, to: "/business" },
  { icon: Bus, title: "Bus & Coach Charter", desc: "Move groups, teams and events with ease.", img: busImg, to: "/charter/bus-charter" },
  { icon: Package, title: "Delivery & Logistics", desc: "Move packages and goods across cities and countries.", img: parcelImg, to: "/delivery" },
  { icon: KeyRound, title: "Rentals & Leasing", desc: "Access vehicles for your personal or business needs.", img: rentImg, to: "/rentals" },
  { icon: Plane, title: "Air Charter", desc: "Connect air travel with ground transport and charter services.", img: jetImg, to: "/charter/aircraft-charter" },
];

const demand = [
  { t: "Individual Riders", s: "Everyday journeys", img: rideImg },
  { t: "Businesses", s: "Corporate mobility", img: corpImg },
  { t: "Group Travellers", s: "Teams and events", img: busImg },
  { t: "Drivers & Fleet Owners", s: "Join the TaxiD network", img: driverImg },
];
const supply = [
  { t: "Charter Operators", s: "Buses, coaches and special transport", img: busImg },
  { t: "Logistics Providers", s: "Delivery, courier and freight", img: logisticsImg },
  { t: "Rental & Leasing Providers", s: "Cars, SUVs and fleet leasing", img: rentImg },
  { t: "Aviation Operators", s: "Air charter and aviation services", img: jetImg },
];

const bizFeatures = [
  { icon: Users, t: "Employee Travel", s: "Book, manage and monitor" },
  { icon: ClipboardCheck, t: "Approvals", s: "Set policies and workflows" },
  { icon: Coins, t: "Cost Centres", s: "Control and allocate spend" },
  { icon: BarChart3, t: "Reporting", s: "Real-time insights" },
  { icon: Receipt, t: "Consolidated Billing", s: "Simple, transparent invoicing" },
];

const partners = [
  { t: "Drivers", s: "Earn with TaxiD", img: driverImg, to: "/driver/onboarding" },
  { t: "Fleet Owners", s: "Grow your fleet", img: fleetImg, to: "/partner/fleet-owner" },
  { t: "Charter Operators", s: "Access more bookings", img: busImg, to: "/partners/charter-operators" },
  { t: "Rental Providers", s: "List your vehicles", img: rentImg, to: "/partners/rental-leasing" },
  { t: "Logistics Partners", s: "Move more goods", img: logisticsImg, to: "/partners" },
  { t: "Aviation Partners", s: "Expand your reach", img: airportImg, to: "/partners" },
];

const bars = [30, 45, 38, 60, 42, 55, 70, 48, 65, 80, 58, 75];

function Node({ t, s, img, right }: { t: string; s: string; img: string; right?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${glass} ${right ? "flex-row" : "flex-row-reverse text-right"}`}>
      <img src={img} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-full border-2 border-[hsl(var(--tx-cyan)/0.6)] object-cover" />
      <div>
        <p className="text-sm font-semibold text-[hsl(var(--tx-ice))]">{t}</p>
        <p className="text-xs text-[hsl(var(--tx-ice)/0.7)]">{s}</p>
      </div>
    </div>
  );
}

function PlayBadge({ audience, label }: { audience: "rider" | "driver"; label: string }) {
  const appIcon = audience === "rider" ? riderApp.url : driverApp.url;
  return (
    <a href={appLink({ audience, platform: "android", placement: "home_landing" })} target="_blank" rel="noopener noreferrer"
      aria-label={`Download ${label} from Google Play`}
      className="inline-flex items-center gap-3 rounded-xl border border-[hsl(var(--tx-cyan)/0.5)] bg-[hsl(var(--tx-ink)/0.8)] p-2 pr-4 transition hover:border-[hsl(var(--tx-gold))]">
      <img src={appIcon} alt="" width={256} height={256} className="h-11 w-11 rounded-lg object-cover" />
      <span className="leading-tight"><span className="block text-[10px] uppercase tracking-wide text-[hsl(var(--tx-ice)/0.75)]">Get it on Google Play</span><span className="block text-sm font-bold">{label}</span></span>
    </a>
  );
}

export function TaxiDReferenceLanding() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("Rides");
  const [pickup, setPickup] = useState("");
  const [dest, setDest] = useState("");

  const book = (e: React.FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams({ pickup, destination: dest, mode: tab.toLowerCase() });
    navigate(tab === "Business" ? "/business/portal" : tab === "Charter" ? "/charter" : `/rider?${q}`);
  };

  return (
    <div style={{ background: deep }} className="text-[hsl(var(--tx-ice))]">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <img src={heroImg} alt="Travellers heading to a TaxiD-connected airport with coach, SUV and aircraft" width={1920} height={1088} className="absolute inset-0 h-full w-full object-cover object-right" />
        <div className="absolute inset-0 bg-gradient-to-r from-[hsl(var(--tx-deep))] via-[hsl(var(--tx-deep)/0.7)] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[hsl(var(--tx-deep))] to-transparent" />
        <div className="container relative mx-auto px-4 pb-44 pt-16 md:pt-24 lg:pb-56">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[hsl(var(--tx-ice)/0.85)]">Africa's integrated mobility platform</p>
          <h1 className="mt-5 text-5xl font-extrabold leading-[1.02] tracking-tight md:text-7xl">
            Move smarter<span className="text-[hsl(var(--tx-gold))]">.</span><br />
            <span className={accent}>Go further.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[hsl(var(--tx-ice)/0.9)]">
            One connected platform for rides, business travel, charter, rentals, delivery, logistics and air mobility.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/rider" className={goldBtn}>Book a ride <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/business/portal" className={ghostBtn}>Explore TaxiD Business</Link>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <PlayBadge audience="rider" label="TaxiD Rider" />
            <PlayBadge audience="driver" label="TaxiD Driver" />
          </div>
        </div>
      </section>

      {/* SERVICE CARDS */}
      <section className="container relative z-10 mx-auto -mt-36 px-4 lg:-mt-44">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {services.map((s) => (
            <Link key={s.title} to={s.to} className={`group flex flex-col overflow-hidden rounded-2xl ${glass} transition hover:-translate-y-1 hover:border-[hsl(var(--tx-cyan))]`}>
              <div className="relative h-28 overflow-hidden">
                <img src={s.img} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                <span className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-md bg-[hsl(var(--tx-electric))]"><s.icon className="h-4 w-4" /></span>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className="font-bold">{s.title}</h3>
                <p className="mt-1 flex-1 text-xs text-[hsl(var(--tx-ice)/0.75)]">{s.desc}</p>
                <span className="mt-3 grid h-7 w-7 self-end place-items-center rounded-full bg-[hsl(var(--tx-electric))] transition group-hover:bg-[hsl(var(--tx-gold))] group-hover:text-[hsl(var(--tx-ink))]"><ArrowRight className="h-3.5 w-3.5" /></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ONE PLATFORM */}
      <section className="container mx-auto px-4 py-20">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="text-3xl font-extrabold md:text-5xl">One platform. <span className={accent}>Every way to move.</span></h2>
            <p className="mt-3 max-w-xl text-[hsl(var(--tx-ice)/0.8)]">Connecting people, organisations and transport providers across Africa and beyond.</p>
          </div>
          <Link to="/partners" className={ghostBtn}>Explore the Platform <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="mt-12 grid items-center gap-6 lg:grid-cols-[1fr_1.2fr_1fr]">
          <div className="space-y-4">{demand.map((d) => <Node key={d.t} {...d} />)}</div>
          <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-full border border-[hsl(var(--tx-cyan)/0.4)] shadow-[0_0_80px_-10px_hsl(var(--tx-cyan)/0.7)]">
            <img src={networkImg} alt="TaxiD network connecting Africa" loading="lazy" className="h-full w-full object-cover" />
          </div>
          <div className="space-y-4">{supply.map((d) => <Node key={d.t} {...d} right />)}</div>
        </div>
      </section>

      {/* BUSINESS */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[hsl(var(--tx-deep))] to-[hsl(var(--tx-sapphire))] py-20">
        <div className="container mx-auto grid items-center gap-8 px-4 lg:grid-cols-[1fr_1.3fr_0.9fr]">
          <div>
            <h2 className="text-3xl font-extrabold md:text-4xl">Move your business with greater <span className={accent}>control.</span></h2>
            <p className="mt-4 text-[hsl(var(--tx-ice)/0.85)]">Manage employee travel, control spend, approve trips and get complete visibility — all in one platform.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/business/portal" className={goldBtn}>Explore TaxiD Business <ArrowRight className="h-4 w-4" /></Link>
              <Link to="/contact?topic=sales" className={ghostBtn}>Talk to Sales</Link>
            </div>
          </div>
          <div className="relative">
            <img src={businessImg} alt="Business traveller managing trips on a laptop" loading="lazy" width={1280} height={1024} className="h-80 w-full rounded-2xl object-cover opacity-80" />
            <div className={`absolute -bottom-8 right-4 w-72 rounded-xl p-4 ${glass} bg-[hsl(var(--tx-deep)/0.85)]`}>
              <div className="flex items-center justify-between text-xs"><span className="font-semibold">Business Travel Overview</span><span className="text-[hsl(var(--tx-ice)/0.6)]">Illustrative</span></div>
              <div className="mt-3 flex h-20 items-end gap-1">
                {bars.map((h, i) => <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-[hsl(var(--tx-electric))] to-[hsl(var(--tx-cyan))]" style={{ height: `${h}%` }} />)}
              </div>
              <div className="mt-3 grid grid-cols-3 text-[10px] text-[hsl(var(--tx-ice)/0.7)]"><span>Trips</span><span>Spend</span><span>Employees</span></div>
            </div>
          </div>
          <div className="space-y-3">
            {bizFeatures.map((f) => (
              <div key={f.t} className={`flex items-center gap-3 rounded-xl px-4 py-3 ${glass}`}>
                <span className="grid h-9 w-9 place-items-center rounded-md bg-[hsl(var(--tx-electric))]"><f.icon className="h-4 w-4" /></span>
                <div><p className="text-sm font-semibold">{f.t}</p><p className="text-xs text-[hsl(var(--tx-ice)/0.7)]">{f.s}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BOOKING (white wave) */}
      <section className="relative bg-[hsl(var(--tx-ice))] text-[hsl(var(--tx-ink))]">
        <svg viewBox="0 0 1440 80" preserveAspectRatio="none" className="absolute -top-px left-0 h-16 w-full" aria-hidden><path d="M0,0 H1440 V20 C1080,90 360,-10 0,60 Z" fill="hsl(var(--tx-sapphire))" /></svg>
        <div className="container mx-auto grid items-center gap-8 px-4 pb-0 pt-24 lg:grid-cols-2">
          <div className="pb-16">
            <p className="text-sm font-medium text-[hsl(var(--tx-electric))]">Get started today</p>
            <h2 className="mt-2 text-4xl font-extrabold text-[hsl(var(--tx-deep))] md:text-5xl">Book Your Ride<br />Anywhere, Anytime<span className="text-[hsl(var(--tx-gold))]">.</span></h2>
            <p className="mt-3 text-[hsl(var(--tx-ink)/0.7)]">Safe, reliable and comfortable rides across your city and beyond.</p>
            <div className="mt-6 inline-flex rounded-lg bg-[hsl(var(--tx-electric)/0.08)] p-1 text-sm">
              {["Rides", "Business", "Airport", "Charter"].map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-md px-4 py-1.5 font-medium ${tab === t ? "bg-[hsl(var(--tx-ice))] text-[hsl(var(--tx-electric))] shadow" : "text-[hsl(var(--tx-ink)/0.6)]"}`}>{t}</button>
              ))}
            </div>
            <form onSubmit={book} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className="flex items-center gap-2 rounded-lg border border-[hsl(var(--tx-electric)/0.2)] bg-[hsl(var(--tx-ice))] px-3 py-2 shadow-sm">
                <MapPin className="h-4 w-4 text-[hsl(var(--tx-electric))]" />
                <span className="flex-1"><span className="block text-[10px] font-semibold">Pickup Location</span><input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="Enter pickup location" className="w-full bg-transparent text-sm outline-none" /></span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-[hsl(var(--tx-electric)/0.2)] bg-[hsl(var(--tx-ice))] px-3 py-2 shadow-sm">
                <Navigation className="h-4 w-4 text-[hsl(var(--tx-electric))]" />
                <span className="flex-1"><span className="block text-[10px] font-semibold">Destination</span><input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Enter destination" className="w-full bg-transparent text-sm outline-none" /></span>
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-[hsl(var(--tx-electric)/0.2)] px-3 py-2 text-sm shadow-sm"><Clock className="h-4 w-4 text-[hsl(var(--tx-electric))]" /><span><span className="block text-[10px] font-semibold">When</span>Now</span></div>
              <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[hsl(var(--tx-electric))] px-6 py-3 text-sm font-bold text-[hsl(var(--tx-ice))] hover:bg-[hsl(var(--tx-royal))] sm:col-span-3 sm:justify-self-start">Book a Ride <ArrowRight className="h-4 w-4" /></button>
            </form>
          </div>
          <img src={bookingImg} alt="Traveller booking a TaxiD ride beside an SUV at the airport" loading="lazy" width={1280} height={1024} className="h-full max-h-[480px] w-full self-end rounded-t-3xl object-cover" />
        </div>
      </section>

      {/* PARTNERS */}
      <section className="relative bg-gradient-to-b from-[hsl(var(--tx-royal))] to-[hsl(var(--tx-deep))] py-20">
        <svg viewBox="0 0 1440 80" preserveAspectRatio="none" className="absolute -top-px left-0 h-16 w-full" aria-hidden><path d="M0,0 H1440 V50 C1000,-10 400,90 0,20 Z" fill="hsl(var(--tx-ice))" /></svg>
        <div className="container mx-auto grid items-center gap-8 px-4 pt-6 lg:grid-cols-[0.8fr_2fr]">
          <div>
            <h2 className="text-3xl font-extrabold md:text-4xl">Turn transport capacity into <span className={accent}>opportunity.</span></h2>
            <p className="mt-4 text-[hsl(var(--tx-ice)/0.85)]">Join Africa's growing mobility ecosystem and connect your vehicles, services or fleet to new demand.</p>
            <Link to="/partners" className="mt-6 inline-flex items-center gap-2 rounded-md bg-[hsl(var(--tx-cyan))] px-6 py-3 text-sm font-bold text-[hsl(var(--tx-ink))] hover:brightness-110">Become a Partner <ArrowRight className="h-4 w-4" /></Link>
            <div className="mt-4"><PlayBadge audience="driver" label="TaxiD Driver" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {partners.map((p) => (
              <Link key={p.t} to={p.to} className={`group overflow-hidden rounded-xl ${glass}`}>
                <img src={p.img} alt="" loading="lazy" className="h-32 w-full object-cover transition group-hover:scale-105" />
                <div className="p-3">
                  <p className="text-sm font-semibold">{p.t}</p>
                  <p className="text-xs text-[hsl(var(--tx-ice)/0.7)]">{p.s}</p>
                  <ArrowRight className="ml-auto mt-2 h-4 w-4 text-[hsl(var(--tx-cyan))]" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
