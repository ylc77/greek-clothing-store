import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getLegalConfig, type LegalConfig } from "@/lib/legal";
import { getBusinessSettings, type BusinessSettings } from "@/lib/settings";
import { getLanguage, type Language } from "@/lib/i18n";

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

function processorsText(config: LegalConfig) {
  return config.dataProcessors.join(", ");
}

function policyCopy(kind: "privacy" | "terms" | "cookies" | "refund", language: Language, config: LegalConfig): LegalPageCopy {
  const common = {
    business: config.businessName,
    address: config.businessAddress,
    email: config.contactEmail,
    phone: config.phone || "Not provided",
    country: config.country,
    processors: processorsText(config),
    retention: config.dataRetention,
    updated: config.lastUpdated,
  };

  if (language === "en") {
    if (kind === "privacy") {
      return {
        eyebrow: "Legal",
        title: "Privacy Policy",
        intro: `${common.business} respects your privacy. This template explains how we collect, use, and protect customer information.`,
        disclaimer: "This is a basic template and should be reviewed by a qualified legal or accounting advisor before full commercial use.",
        sections: [
          { title: "Business details", body: [`Business name: ${common.business}`, `Address: ${common.address}`, `Country: ${common.country}`, `Contact: ${common.email}${config.phone ? ` / ${config.phone}` : ""}`] },
          { title: "Data we may collect", body: ["Contact details you send to us, order or product enquiries, website usage information, device/browser data, and messages sent through WhatsApp, AI assistant, or other contact channels."] },
          { title: "How we use data", body: ["We use data to respond to enquiries, manage orders, maintain inventory, provide customer support, prevent abuse, improve the website, and meet legal or accounting obligations."] },
          { title: "Processors", body: [`We may use service providers such as: ${common.processors}. These providers process data only for store operations and technical delivery.`] },
          { title: "Retention", body: [common.retention] },
          { title: "Your rights", body: ["You may contact us to request access, correction, deletion, or restriction of your personal data, subject to legal and accounting requirements."] },
          { title: "Last updated", body: [common.updated] },
        ],
      };
    }
    if (kind === "terms") {
      return {
        eyebrow: "Legal",
        title: "Terms of Service",
        intro: `These terms describe the basic rules for using ${common.business}'s website and contacting the store.`,
        disclaimer: "This website is a product catalogue and store communication channel. Final purchase, availability, tax documentation, and delivery terms must be confirmed by the store or the relevant checkout platform.",
        sections: [
          { title: "Use of the website", body: ["You agree to use the website lawfully and not to misuse product information, contact forms, AI assistant, or store systems."] },
          { title: "Product information", body: ["Prices, availability, colours, sizes, descriptions, and images are provided in good faith but may change. Please confirm availability before purchase."] },
          { title: "Orders and payments", body: ["Orders may be completed through the store, Skroutz, or enabled payment channels. Payment and delivery terms depend on the chosen channel."] },
          { title: "Limitation", body: ["The store is not responsible for temporary website unavailability, inaccurate third-party platform data, or delays caused by external providers."] },
          { title: "Contact", body: [`Questions about these terms can be sent to ${common.email}.`] },
          { title: "Last updated", body: [common.updated] },
        ],
      };
    }
    if (kind === "cookies") {
      return {
        eyebrow: "Legal",
        title: "Cookie Policy",
        intro: "This policy explains how cookies and similar technologies may be used on this website.",
        disclaimer: "Non-essential analytics or marketing cookies are not loaded unless you consent through the cookie banner.",
        sections: [
          { title: "Essential cookies", body: ["Essential cookies or local storage may be used for language choice, cookie consent, security, and basic website operation."] },
          { title: "Analytics and marketing", body: ["If enabled in the future, analytics or marketing cookies will only load after consent. You can reject non-essential cookies."] },
          { title: "Managing preferences", body: ["Use the cookie banner to accept all, reject non-essential cookies, or manage preferences. You can also clear browser storage to reset your choice."] },
          { title: "Processors", body: [`Possible technical providers include: ${common.processors}.`] },
          { title: "Last updated", body: [common.updated] },
        ],
      };
    }
    return {
      eyebrow: "Legal",
      title: "Refund Policy",
      intro: "This refund policy is a basic template for store enquiries and should be adapted to the final sales channel and Greek consumer rules.",
      disclaimer: "This page is not a tax invoice policy and does not replace the terms of Skroutz, payment providers, or official accounting advice.",
      sections: [
        { title: "Before purchase", body: ["Please confirm size, colour, availability, price, and delivery or pickup details before completing a purchase."] },
        { title: "Returns and exchanges", body: ["Returns, exchanges, and cancellations depend on product condition, purchase channel, applicable consumer rules, and store approval."] },
        { title: "Non-returnable items", body: ["Items may be refused if used, damaged, missing labels, or outside the allowed return period, subject to applicable law."] },
        { title: "How to request help", body: [`Contact ${common.business} at ${common.email}${config.phone ? ` or ${config.phone}` : ""} with your order details.`] },
        { title: "Last updated", body: [common.updated] },
      ],
    };
  }

  if (kind === "privacy") {
    return {
      eyebrow: "Νομικά",
      title: "Πολιτική Απορρήτου",
      intro: `Το ${common.business} σέβεται το απόρρητό σας. Αυτή η σελίδα εξηγεί με απλό τρόπο πώς χρησιμοποιούνται τα στοιχεία πελατών.`,
      disclaimer: "Αυτό είναι βασικό πρότυπο και πρέπει να ελεγχθεί από νομικό ή λογιστικό σύμβουλο πριν από πλήρη εμπορική χρήση.",
      sections: [
        { title: "Στοιχεία επιχείρησης", body: [`Επωνυμία: ${common.business}`, `Διεύθυνση: ${common.address}`, `Χώρα: ${common.country}`, `Επικοινωνία: ${common.email}${config.phone ? ` / ${config.phone}` : ""}`] },
        { title: "Δεδομένα που συλλέγουμε", body: ["Στοιχεία επικοινωνίας, μηνύματα, ερωτήσεις για προϊόντα, τεχνικά δεδομένα χρήσης και επικοινωνίες μέσω WhatsApp ή βοηθού AI."] },
        { title: "Χρήση δεδομένων", body: ["Χρησιμοποιούμε τα δεδομένα για εξυπηρέτηση πελατών, διαχείριση παραγγελιών, αποθέματα, ασφάλεια, βελτίωση της ιστοσελίδας και νόμιμες υποχρεώσεις."] },
        { title: "Πάροχοι", body: [`Πιθανοί πάροχοι επεξεργασίας: ${common.processors}.`] },
        { title: "Διατήρηση", body: [common.retention] },
        { title: "Δικαιώματα", body: ["Μπορείτε να ζητήσετε πρόσβαση, διόρθωση ή διαγραφή δεδομένων, σύμφωνα με τις νόμιμες και λογιστικές υποχρεώσεις."] },
        { title: "Τελευταία ενημέρωση", body: [common.updated] },
      ],
    };
  }
  if (kind === "terms") {
    return {
      eyebrow: "Νομικά",
      title: "Όροι Χρήσης",
      intro: `Οι όροι αυτοί περιγράφουν τη βασική χρήση της ιστοσελίδας του ${common.business}.`,
      disclaimer: "Η ιστοσελίδα λειτουργεί ως κατάλογος προϊόντων και κανάλι επικοινωνίας. Η τελική αγορά και η διαθεσιμότητα επιβεβαιώνονται από το κατάστημα ή την πλατφόρμα αγοράς.",
      sections: [
        { title: "Χρήση ιστοσελίδας", body: ["Συμφωνείτε να χρησιμοποιείτε την ιστοσελίδα νόμιμα και χωρίς κατάχρηση πληροφοριών, φορμών ή συστημάτων."] },
        { title: "Πληροφορίες προϊόντων", body: ["Τιμές, διαθεσιμότητα, χρώματα, μεγέθη, περιγραφές και εικόνες μπορεί να αλλάξουν. Παρακαλούμε επιβεβαιώστε πριν την αγορά."] },
        { title: "Παραγγελίες και πληρωμές", body: ["Οι αγορές μπορούν να ολοκληρωθούν μέσω καταστήματος, Skroutz ή άλλων ενεργών καναλιών πληρωμής."] },
        { title: "Περιορισμός ευθύνης", body: ["Το κατάστημα δεν ευθύνεται για προσωρινή μη διαθεσιμότητα ιστοσελίδας ή καθυστερήσεις τρίτων παρόχων."] },
        { title: "Επικοινωνία", body: [`Για ερωτήσεις: ${common.email}.`] },
        { title: "Τελευταία ενημέρωση", body: [common.updated] },
      ],
    };
  }
  if (kind === "cookies") {
    return {
      eyebrow: "Νομικά",
      title: "Πολιτική Cookies",
      intro: "Αυτή η πολιτική εξηγεί τη χρήση cookies και παρόμοιων τεχνολογιών.",
      disclaimer: "Μη απαραίτητα analytics ή marketing cookies δεν φορτώνονται χωρίς συγκατάθεση.",
      sections: [
        { title: "Απαραίτητα cookies", body: ["Χρησιμοποιούνται για γλώσσα, προτιμήσεις συγκατάθεσης, ασφάλεια και βασική λειτουργία ιστοσελίδας."] },
        { title: "Analytics και marketing", body: ["Αν ενεργοποιηθούν στο μέλλον, θα φορτώνονται μόνο μετά από συγκατάθεση."] },
        { title: "Διαχείριση", body: ["Μπορείτε να αποδεχτείτε, να απορρίψετε μη απαραίτητα cookies ή να αλλάξετε προτιμήσεις από το banner."] },
        { title: "Πάροχοι", body: [`Πιθανοί τεχνικοί πάροχοι: ${common.processors}.`] },
        { title: "Τελευταία ενημέρωση", body: [common.updated] },
      ],
    };
  }
  return {
    eyebrow: "Νομικά",
    title: "Πολιτική Επιστροφών",
    intro: "Αυτή είναι βασική πολιτική επιστροφών για ερωτήσεις πελατών και πρέπει να προσαρμοστεί στο τελικό κανάλι πώλησης.",
    disclaimer: "Δεν αποτελεί πολιτική φορολογικού παραστατικού και δεν αντικαθιστά τους όρους Skroutz ή λογιστική συμβουλή.",
    sections: [
      { title: "Πριν την αγορά", body: ["Επιβεβαιώστε μέγεθος, χρώμα, διαθεσιμότητα, τιμή και τρόπο παραλαβής ή αποστολής."] },
      { title: "Επιστροφές και αλλαγές", body: ["Εξαρτώνται από την κατάσταση του προϊόντος, το κανάλι αγοράς, τους νόμους προστασίας καταναλωτή και την έγκριση του καταστήματος."] },
      { title: "Προϊόντα που δεν επιστρέφονται", body: ["Μπορεί να απορριφθούν προϊόντα χρησιμοποιημένα, κατεστραμμένα, χωρίς ετικέτες ή εκτός περιόδου επιστροφής, σύμφωνα με τον νόμο."] },
      { title: "Αίτημα υποστήριξης", body: [`Επικοινωνήστε με ${common.business} στο ${common.email}${config.phone ? ` ή ${config.phone}` : ""}.`] },
      { title: "Τελευταία ενημέρωση", body: [common.updated] },
    ],
  };
}

export async function LegalPage({
  kind,
  language,
  settings,
}: {
  kind: "privacy" | "terms" | "cookies" | "refund";
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
