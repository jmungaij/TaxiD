
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchIcon } from "lucide-react";

const HelpSupportPage = () => {
  const faqs = [
    {
      question: "How do I add a new passenger to the system?",
      answer:
        "To add a new passenger, navigate to the Passengers page and click the 'Add Passenger' button in the top right corner. Fill in the required details in the form and click 'Save' to create the new passenger account.",
    },
    {
      question: "How do trip assignments work?",
      answer:
        "Trip assignments can be handled either manually or automatically. For manual assignment, navigate to the Trips page, create a new trip, and select an available driver. If automatic assignment is enabled in Settings, the system will assign trips to drivers based on proximity, rating, and vehicle type.",
    },
    {
      question: "Can I export trip data for reporting?",
      answer:
        "Yes, you can export trip data in various formats. Go to the Trips page, use filters to select the data you want, then click the Export button in the top right corner. You can choose between CSV, Excel, or PDF formats.",
    },
    {
      question: "How do I update driver vehicle information?",
      answer:
        "To update vehicle information, go to the Drivers page, select the driver, and click 'Edit'. Navigate to the Vehicle tab in the edit form where you can update all vehicle details including make, model, license plate, etc.",
    },
    {
      question: "What payment methods are supported?",
      answer:
        "The system supports multiple payment methods including credit cards, corporate accounts, and cash payments. Payment methods can be configured for each passenger account, and corporate billing can be set up for business accounts.",
    },
    {
      question: "How do I generate performance reports?",
      answer:
        "Performance reports can be generated from the Analytics page. Select the date range, metrics, and segments you're interested in, then click 'Generate Report'. Reports can be viewed online or exported as PDF or Excel files.",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Help & Support</h2>
        <p className="text-muted-foreground">
          Get help and learn more about using the system
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Frequently Asked Questions</CardTitle>
              <CardDescription>
                Find quick answers to common questions about the platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative mb-6">
                <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search questions..."
                  className="pl-8"
                />
              </div>
              <Accordion type="single" collapsible className="w-full">
                {faqs.map((faq, index) => (
                  <AccordionItem key={index} value={`item-${index}`}>
                    <AccordionTrigger className="text-left">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent>{faq.answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full">
                View All FAQs
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Contact Support</CardTitle>
              <CardDescription>
                Need help? Reach out to our support team
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="subject" className="text-sm font-medium">
                    Subject
                  </label>
                  <Input id="subject" placeholder="Brief description of issue" />
                </div>
                <div className="space-y-2">
                  <label htmlFor="message" className="text-sm font-medium">
                    Message
                  </label>
                  <Textarea
                    id="message"
                    placeholder="Please provide details about your issue or question"
                    rows={5}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="priority" className="text-sm font-medium">
                    Priority
                  </label>
                  <select
                    id="priority"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  >
                    <option>Low - General question</option>
                    <option>Medium - Issue affecting some users</option>
                    <option>High - Urgent problem</option>
                    <option>Critical - System outage</option>
                  </select>
                </div>
              </form>
            </CardContent>
            <CardFooter>
              <Button className="w-full">Submit Ticket</Button>
            </CardFooter>
          </Card>

          <div className="mt-6 space-y-4">
            <div className="bg-muted rounded-lg p-4 flex items-center space-x-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </div>
              <div>
                <h3 className="font-medium">Phone Support</h3>
                <p className="text-sm text-muted-foreground">
                  +1 (555) 123-4567
                </p>
                <p className="text-xs text-muted-foreground">
                  Mon-Fri, 9am-5pm EST
                </p>
              </div>
            </div>
            <div className="bg-muted rounded-lg p-4 flex items-center space-x-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary"
                >
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
              </div>
              <div>
                <h3 className="font-medium">Email Support</h3>
                <p className="text-sm text-muted-foreground">
                  support@ridenexus.example
                </p>
                <p className="text-xs text-muted-foreground">
                  24/7 response within 24 hours
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpSupportPage;
