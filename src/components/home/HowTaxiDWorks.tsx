import { ArrowRight, CarFront, CreditCard, MapPin, UserRoundCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import riderImage from "@/assets/rider/taxid-rider-daylight.jpg";

const steps = [
  { icon: MapPin, title: "Request a trip", detail: "Set your pickup and destination." },
  { icon: UserRoundCheck, title: "Match with a driver", detail: "Find the right ride for your journey." },
  { icon: CarFront, title: "Enjoy your trip", detail: "Travel with confidence." },
  { icon: CreditCard, title: "Make payments", detail: "Pay through your available options." },
];

export function HowTaxiDWorks() {
  return <section className="border-y bg-background py-16 md:py-24" aria-labelledby="how-taxid-works">
    <div className="container mx-auto px-4">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-5"><div><p className="text-sm font-semibold text-primary">Your journey</p><h2 id="how-taxid-works" className="mt-2 text-3xl font-bold md:text-4xl">How TaxiD works</h2></div><Button asChild variant="outline"><Link to="/riders">Explore rides <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div>
      <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
        <img src={riderImage} alt="A TaxiD passenger meets her driver in Nairobi" width={1600} height={1008} loading="lazy" className="aspect-[4/3] w-full rounded-md object-cover object-[65%_center]" />
        <ol className="grid gap-x-6 gap-y-8 sm:grid-cols-2">{steps.map((step, index) => <li key={step.title} className="border-t border-border pt-5"><span className="flex items-center gap-3 text-sm font-semibold text-primary"><step.icon className="h-5 w-5"/>0{index + 1}</span><h3 className="mt-5 text-xl font-semibold">{step.title}</h3><p className="mt-2 text-sm text-muted-foreground">{step.detail}</p></li>)}</ol>
      </div>
    </div>
  </section>;
}