import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getLanguage, type Language } from "@/lib/i18n";
import { getLegalConfig, type LegalConfig } from "@/lib/legal";
import { getBusinessSettings, type BusinessSettings } from "@/lib/settings";

type LegalKind = "privacy" | "terms" | "cookies" | "refund";

type LegalSection = {
  title: string;
  body: string[];
};

type LegalPageCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  disclaimer: string;
  sections: LegalSection[];
};

function compactLines(values: Array<string | false | null | undefined>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function listSentence(values: string[], fallback: string) {
  return values.length > 0 ? values.join(", ") : fallback;
}

function businessDetails(config: LegalConfig, language: Language) {
  if (language === "en") {
    return compactLines([
      `Trading name: ${config.businessName}`,
      `Legal name: ${config.legalName}`,
      `Address: ${config.businessAddress}`,
      config.vatNumber ? `VAT number: ${config.vatNumber}` : null,
      config.gemiNumber ? `GEMI number: ${config.gemiNumber}` : null,
      `Country: ${config.country}`,
      `Contact: ${config.contactEmail}${config.phone ? ` / ${config.phone}` : ""}`,
    ]);
  }

  return compactLines([
    `Εμπορική ονομασία: ${config.businessName}`,
    `Νομική επωνυμία: ${config.legalName}`,
    `Διεύθυνση: ${config.businessAddress}`,
    config.vatNumber ? `ΑΦΜ/VAT: ${config.vatNumber}` : null,
    config.gemiNumber ? `ΓΕΜΗ: ${config.gemiNumber}` : null,
    `Χώρα: ${config.country}`,
    `Επικοινωνία: ${config.contactEmail}${config.phone ? ` / ${config.phone}` : ""}`,
  ]);
}

function optionalProviderSections(config: LegalConfig, language: Language): LegalSection[] {
  if (language === "en") {
    return [
      config.paymentProviders.length > 0
        ? { title: "Payment providers", body: [`Enabled payment providers: ${config.paymentProviders.join(", ")}.`] }
        : null,
      config.analyticsProviders.length > 0
        ? { title: "Analytics providers", body: [`Enabled analytics providers: ${config.analyticsProviders.join(", ")}. Non-essential analytics should only load after consent.`] }
        : null,
      config.aiProviders.length > 0
        ? { title: "AI providers", body: [`Enabled AI providers: ${config.aiProviders.join(", ")}. AI tools may process customer messages or product questions when used.`] }
        : null,
    ].filter((section): section is LegalSection => Boolean(section));
  }

  return [
    config.paymentProviders.length > 0
      ? { title: "Πάροχοι πληρωμών", body: [`Ενεργοί πάροχοι πληρωμών: ${config.paymentProviders.join(", ")}.`] }
      : null,
    config.analyticsProviders.length > 0
      ? { title: "Πάροχοι analytics", body: [`Ενεργοί πάροχοι analytics: ${config.analyticsProviders.join(", ")}. Τα μη απαραίτητα analytics πρέπει να φορτώνονται μόνο μετά από συγκατάθεση.`] }
      : null,
    config.aiProviders.length > 0
      ? { title: "Πάροχοι AI", body: [`Ενεργοί πάροχοι AI: ${config.aiProviders.join(", ")}. Τα εργαλεία AI μπορεί να επεξεργάζονται μηνύματα ή ερωτήσεις προϊόντων όταν χρησιμοποιούνται.`] }
      : null,
  ].filter((section): section is LegalSection => Boolean(section));
}

function policyCopy(kind: LegalKind, language: Language, config: LegalConfig): LegalPageCopy {
  const details = businessDetails(config, language);
  const processors = listSentence(config.dataProcessors, language === "en" ? "No optional processors configured." : "Δεν έχουν οριστεί προαιρετικοί πάροχοι.");

  if (language === "en") {
    if (kind === "privacy") {
      return {
        eyebrow: "Basic legal pages template",
        title: "Privacy Policy",
        intro: "This privacy policy is generated from reusable client legal configuration fields. It should be reviewed before commercial launch.",
        disclaimer: "This is a basic legal pages template, not a guarantee of full compliance.",
        sections: [
          { title: "Business and controller details", body: [...details, `Data controller: ${config.dataControllerName}`, `Controller address: ${config.dataControllerAddress}`] },
          { title: "Data we may collect", body: ["Contact details, product or order enquiries, messages, support requests, website usage data, device/browser data, and operational records related to orders, inventory, POS, labels, receipts, and customer support."] },
          { title: "How data is used", body: ["Data may be used to reply to customers, manage product availability, process orders, support POS operations, maintain security, prevent abuse, improve services, and meet legal or accounting duties."] },
          { title: "Data processors", body: [`Configured processors: ${processors}. Providers not enabled in this configuration are not listed on this page.`] },
          ...optionalProviderSections(config, language),
          { title: "Retention", body: [config.dataRetention] },
          { title: "Customer rights", body: ["Customers may request access, correction, deletion, restriction, or portability of personal data, subject to applicable legal and accounting obligations."] },
          { title: "Last updated", body: [config.lastUpdated] },
        ],
      };
    }

    if (kind === "terms") {
      return {
        eyebrow: "Basic legal pages template",
        title: "Terms of Service",
        intro: "These terms describe the basic rules for using the website, product catalogue, AI assistant, contact channels, and enabled ordering flows.",
        disclaimer: "This is a basic legal pages template. Final customer terms should be confirmed for each business and sales channel.",
        sections: [
          { title: "Business details", body: details },
          { title: "Website use", body: ["Visitors must use the website lawfully and must not misuse forms, AI tools, product data, POS-related pages, or store systems."] },
          { title: "Product information", body: ["Prices, images, stock, colours, sizes, availability, labels, barcode data, and descriptions may change. Customers should confirm important details before purchase."] },
          { title: "Clothing store reserved sections", body: ["Shipping Policy, Return Policy, Refund Policy, and 14-day withdrawal right sections should be completed before full commercial use if the store sells directly online."] },
          { title: "Restaurant reserved sections", body: ["Order Terms, Cancellation Policy, Payment Terms, and allergy / food availability disclaimer sections should be completed before using this template for a restaurant project."] },
          { title: "Payments", body: [config.paymentProviders.length > 0 ? `Payments may be handled by: ${config.paymentProviders.join(", ")}.` : "No online payment provider is configured in this template yet."] },
          { title: "Contact", body: [`Questions about these terms can be sent to ${config.contactEmail}.`] },
          { title: "Last updated", body: [config.lastUpdated] },
        ],
      };
    }

    if (kind === "cookies") {
      return {
        eyebrow: "Basic legal pages template",
        title: "Cookie Policy",
        intro: "This cookie policy explains essential cookies, optional cookies, and how preferences are managed.",
        disclaimer: "Non-essential cookies should not load before consent. This page is a basic legal pages template.",
        sections: [
          { title: "Essential cookies", body: ["Essential cookies or local storage may be used for language choice, cookie consent, security, and basic site operation."] },
          { title: "Optional analytics cookies", body: [config.analyticsProviders.length > 0 ? `Analytics providers configured: ${config.analyticsProviders.join(", ")}.` : "No analytics provider is configured in this template."] },
          { title: "Optional marketing cookies", body: ["Marketing cookies should only be enabled if a client explicitly configures marketing tools and obtains consent."] },
          { title: "Manage preferences", body: ["Visitors can accept all, reject non-essential cookies, or manage preferences in the cookie banner."] },
          { title: "Last updated", body: [config.lastUpdated] },
        ],
      };
    }

    return {
      eyebrow: "Basic legal pages template",
      title: "Refund Policy",
      intro: "This page is a reusable refund and return policy template for retail projects.",
      disclaimer: "This is a basic legal pages template. Return periods, exceptions, and withdrawal rights must be confirmed for each client before commercial launch.",
      sections: [
        { title: "Business details", body: details },
        { title: "Before purchase", body: ["Customers should confirm size, colour, availability, price, payment channel, delivery, pickup, and receipt or invoice requirements before purchase."] },
        { title: "Shipping Policy placeholder", body: ["Add shipping areas, delivery times, courier partners, shipping fees, failed delivery handling, and pickup options here."] },
        { title: "Return Policy placeholder", body: ["Add item condition requirements, labels, packaging, proof of purchase, return address, and inspection process here."] },
        { title: "Refund Policy placeholder", body: ["Add refund method, timing, deductions, payment provider handling, and rejected refund conditions here."] },
        { title: "14-day withdrawal right placeholder", body: ["For EU consumer sales, confirm with a legal advisor how the 14-day withdrawal right applies to this business, product category, and sales channel."] },
        { title: "Contact", body: [`Refund or return questions can be sent to ${config.contactEmail}${config.phone ? ` or ${config.phone}` : ""}.`] },
        { title: "Last updated", body: [config.lastUpdated] },
      ],
    };
  }

  if (kind === "privacy") {
    return {
      eyebrow: "Βασικό πρότυπο νομικών σελίδων",
      title: "Πολιτική Απορρήτου",
      intro: "Η πολιτική αυτή δημιουργείται από επαναχρησιμοποιήσιμα πεδία νομικής διαμόρφωσης πελάτη και πρέπει να ελεγχθεί πριν από εμπορική χρήση.",
      disclaimer: "Αυτό είναι basic legal pages template και όχι εγγύηση πλήρους συμμόρφωσης.",
      sections: [
        { title: "Στοιχεία επιχείρησης και υπευθύνου", body: [...details, `Υπεύθυνος επεξεργασίας: ${config.dataControllerName}`, `Διεύθυνση υπευθύνου: ${config.dataControllerAddress}`] },
        { title: "Δεδομένα που μπορεί να συλλέγονται", body: ["Στοιχεία επικοινωνίας, ερωτήσεις προϊόντων ή παραγγελιών, μηνύματα, αιτήματα υποστήριξης, τεχνικά δεδομένα χρήσης και λειτουργικά αρχεία για παραγγελίες, απόθεμα, POS, ετικέτες, αποδείξεις και υποστήριξη πελατών."] },
        { title: "Χρήση δεδομένων", body: ["Τα δεδομένα μπορεί να χρησιμοποιούνται για απάντηση σε πελάτες, διαχείριση διαθεσιμότητας, παραγγελιών, λειτουργιών POS, ασφάλειας, πρόληψης κατάχρησης, βελτίωσης υπηρεσιών και νόμιμων ή λογιστικών υποχρεώσεων."] },
        { title: "Πάροχοι επεξεργασίας", body: [`Ρυθμισμένοι πάροχοι: ${processors}. Πάροχοι που δεν είναι ενεργοί στη διαμόρφωση δεν εμφανίζονται σε αυτή τη σελίδα.`] },
        ...optionalProviderSections(config, language),
        { title: "Διατήρηση", body: [config.dataRetention] },
        { title: "Δικαιώματα πελατών", body: ["Οι πελάτες μπορούν να ζητήσουν πρόσβαση, διόρθωση, διαγραφή, περιορισμό ή φορητότητα δεδομένων, σύμφωνα με τις ισχύουσες νομικές και λογιστικές υποχρεώσεις."] },
        { title: "Τελευταία ενημέρωση", body: [config.lastUpdated] },
      ],
    };
  }

  if (kind === "terms") {
    return {
      eyebrow: "Βασικό πρότυπο νομικών σελίδων",
      title: "Όροι Χρήσης",
      intro: "Οι όροι αυτοί περιγράφουν τη βασική χρήση ιστοσελίδας, καταλόγου προϊόντων, βοηθού AI, καναλιών επικοινωνίας και ενεργών ροών παραγγελίας.",
      disclaimer: "Αυτό είναι basic legal pages template. Οι τελικοί όροι πελάτη πρέπει να επιβεβαιώνονται για κάθε επιχείρηση και κανάλι πώλησης.",
      sections: [
        { title: "Στοιχεία επιχείρησης", body: details },
        { title: "Χρήση ιστοσελίδας", body: ["Οι επισκέπτες πρέπει να χρησιμοποιούν την ιστοσελίδα νόμιμα και χωρίς κατάχρηση φορμών, εργαλείων AI, δεδομένων προϊόντων, σελίδων POS ή συστημάτων καταστήματος."] },
        { title: "Πληροφορίες προϊόντων", body: ["Τιμές, εικόνες, απόθεμα, χρώματα, μεγέθη, διαθεσιμότητα, ετικέτες, barcode και περιγραφές μπορεί να αλλάξουν. Οι πελάτες πρέπει να επιβεβαιώνουν σημαντικές πληροφορίες πριν την αγορά."] },
        { title: "Προβλέψεις για κατάστημα ρούχων", body: ["Shipping Policy, Return Policy, Refund Policy και 14-day withdrawal right sections πρέπει να συμπληρωθούν πριν από πλήρη εμπορική χρήση αν το κατάστημα πουλά απευθείας online."] },
        { title: "Προβλέψεις για εστιατόριο", body: ["Order Terms, Cancellation Policy, Payment Terms και allergy / food availability disclaimer πρέπει να συμπληρωθούν πριν χρησιμοποιηθεί το πρότυπο για εστιατόριο."] },
        { title: "Πληρωμές", body: [config.paymentProviders.length > 0 ? `Οι πληρωμές μπορεί να διαχειρίζονται από: ${config.paymentProviders.join(", ")}.` : "Δεν έχει οριστεί πάροχος online πληρωμών σε αυτό το πρότυπο."] },
        { title: "Επικοινωνία", body: [`Ερωτήσεις για τους όρους: ${config.contactEmail}.`] },
        { title: "Τελευταία ενημέρωση", body: [config.lastUpdated] },
      ],
    };
  }

  if (kind === "cookies") {
    return {
      eyebrow: "Βασικό πρότυπο νομικών σελίδων",
      title: "Πολιτική Cookies",
      intro: "Η πολιτική αυτή εξηγεί τα απαραίτητα cookies, τα προαιρετικά cookies και τη διαχείριση προτιμήσεων.",
      disclaimer: "Τα μη απαραίτητα cookies δεν πρέπει να φορτώνονται πριν από συγκατάθεση. Αυτή η σελίδα είναι basic legal pages template.",
      sections: [
        { title: "Απαραίτητα cookies", body: ["Μπορεί να χρησιμοποιούνται για επιλογή γλώσσας, συγκατάθεση cookies, ασφάλεια και βασική λειτουργία ιστοσελίδας."] },
        { title: "Προαιρετικά analytics cookies", body: [config.analyticsProviders.length > 0 ? `Ρυθμισμένοι πάροχοι analytics: ${config.analyticsProviders.join(", ")}.` : "Δεν έχει οριστεί πάροχος analytics σε αυτό το πρότυπο."] },
        { title: "Προαιρετικά marketing cookies", body: ["Marketing cookies πρέπει να ενεργοποιούνται μόνο αν ο πελάτης ρυθμίσει εργαλεία marketing και λάβει συγκατάθεση."] },
        { title: "Διαχείριση προτιμήσεων", body: ["Οι επισκέπτες μπορούν να αποδεχθούν όλα, να απορρίψουν μη απαραίτητα cookies ή να διαχειριστούν προτιμήσεις από το cookie banner."] },
        { title: "Τελευταία ενημέρωση", body: [config.lastUpdated] },
      ],
    };
  }

  return {
    eyebrow: "Βασικό πρότυπο νομικών σελίδων",
    title: "Πολιτική Επιστροφών",
    intro: "Αυτή η σελίδα είναι επαναχρησιμοποιήσιμο πρότυπο πολιτικής επιστροφών για retail projects.",
    disclaimer: "Αυτό είναι basic legal pages template. Περίοδοι επιστροφής, εξαιρέσεις και δικαίωμα υπαναχώρησης πρέπει να επιβεβαιώνονται για κάθε πελάτη πριν από εμπορική χρήση.",
    sections: [
      { title: "Στοιχεία επιχείρησης", body: details },
      { title: "Πριν την αγορά", body: ["Οι πελάτες πρέπει να επιβεβαιώνουν μέγεθος, χρώμα, διαθεσιμότητα, τιμή, κανάλι πληρωμής, παράδοση, παραλαβή και απαιτήσεις απόδειξης ή τιμολογίου πριν την αγορά."] },
      { title: "Shipping Policy placeholder", body: ["Συμπληρώστε περιοχές αποστολής, χρόνους παράδοσης, courier, έξοδα αποστολής, αποτυχημένη παράδοση και επιλογές pickup."] },
      { title: "Return Policy placeholder", body: ["Συμπληρώστε κατάσταση προϊόντος, ετικέτες, συσκευασία, απόδειξη αγοράς, διεύθυνση επιστροφής και διαδικασία ελέγχου."] },
      { title: "Refund Policy placeholder", body: ["Συμπληρώστε μέθοδο επιστροφής χρημάτων, χρόνο επεξεργασίας, κρατήσεις, πάροχο πληρωμής και συνθήκες απόρριψης refund."] },
      { title: "14-day withdrawal right placeholder", body: ["Για πωλήσεις σε καταναλωτές ΕΕ, επιβεβαιώστε με νομικό σύμβουλο πώς εφαρμόζεται το δικαίωμα υπαναχώρησης 14 ημερών στην επιχείρηση, την κατηγορία προϊόντων και το κανάλι πώλησης."] },
      { title: "Επικοινωνία", body: [`Ερωτήσεις για επιστροφές μπορούν να σταλούν στο ${config.contactEmail}${config.phone ? ` ή ${config.phone}` : ""}.`] },
      { title: "Τελευταία ενημέρωση", body: [config.lastUpdated] },
    ],
  };
}

export async function LegalPage({
  kind,
  language,
  settings,
}: {
  kind: LegalKind;
  language: Language;
  settings?: BusinessSettings;
}) {
  const resolvedSettings = settings || await getBusinessSettings();
  const config = getLegalConfig(resolvedSettings);
  const copy = policyCopy(kind, language, config);

  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} settings={resolvedSettings} />
      <section className="ui-container py-8 sm:py-12 lg:py-16">
        <div className="rounded-[2rem] border border-stone-200/70 bg-white p-6 shadow-sm shadow-stone-900/5 sm:p-8 lg:p-10">
          <p className="ui-kicker">{copy.eyebrow}</p>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-5xl">{copy.title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-stone-600 sm:text-lg">{copy.intro}</p>
          <p className="mt-4 max-w-3xl rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800">{copy.disclaimer}</p>
        </div>

        <div className="mt-6 grid gap-4">
          {copy.sections.map((section) => (
            <article className="ui-panel p-6" key={section.title}>
              <h2 className="text-lg font-black text-ink">{section.title}</h2>
              <div className="mt-3 space-y-2 text-sm leading-6 text-stone-600">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      <SiteFooter language={language} settings={resolvedSettings} />
    </main>
  );
}
