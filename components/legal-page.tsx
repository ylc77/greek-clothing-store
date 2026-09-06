import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { storefrontText, type Language } from "@/lib/i18n";
import { providerNames } from "@/lib/legal";
import { localizedLegalText, type LocalizedLegalKey } from "@/lib/legal-localization";
import { getPublishedLegalSettings, type LegalSettingsData } from "@/lib/legal-settings";
import type { BusinessSettings } from "@/lib/settings";

export type LegalKind = "privacy" | "terms" | "cookies" | "refund" | "return" | "shipping";
type Section = { title: string; paragraphs: string[] };

const pending = (language: Language) => language === "en"
  ? "This information has not yet been completed by the store. Please contact us before placing an order."
  : "Το κατάστημα δεν έχει ακόμη συμπληρώσει αυτές τις πληροφορίες. Επικοινωνήστε μαζί μας πριν από την παραγγελία.";

function text(value: string, language: Language) {
  return storefrontText(value) || pending(language);
}

function legalText(settings: LegalSettingsData, key: LocalizedLegalKey, language: Language) {
  return text(localizedLegalText(settings.localized, key, language), language);
}

function businessDetails(settings: LegalSettingsData, language: Language) {
  const rows = language === "en"
    ? [
        `Trading name: ${text(settings.businessName, language)}`,
        `Legal entity: ${text(settings.legalName, language)}`,
        `Registered address: ${text(settings.businessAddress, language)}`,
        `VAT / AFM: ${text(settings.vatNumber, language)}`,
        settings.gemiNumber ? `GEMI: ${settings.gemiNumber}` : "",
        `Contact: ${text(settings.contactEmail, language)} · ${text(settings.phone, language)}`,
      ]
    : [
        `Εμπορική ονομασία: ${text(settings.businessName, language)}`,
        `Νομική επωνυμία: ${text(settings.legalName, language)}`,
        `Έδρα: ${text(settings.businessAddress, language)}`,
        `ΑΦΜ / VAT: ${text(settings.vatNumber, language)}`,
        settings.gemiNumber ? `ΓΕΜΗ: ${settings.gemiNumber}` : "",
        `Επικοινωνία: ${text(settings.contactEmail, language)} · ${text(settings.phone, language)}`,
      ];
  return rows.filter(Boolean);
}

function enabledServices(settings: LegalSettingsData, language: Language) {
  const services = settings.enabledProviders.map((key) => providerNames[key]);
  const otherProviders = storefrontText(localizedLegalText(settings.localized, "otherProviders", language));
  if (otherProviders) services.push(otherProviders);
  return services;
}

function legalCopy(kind: LegalKind, language: Language, settings: LegalSettingsData): { title: string; intro: string; sections: Section[] } {
  const en = language === "en";
  const details = businessDetails(settings, language);
  const services = enabledServices(settings, language);
  const paymentServices = settings.enabledProviders
    .filter((key) => ["stripe", "viva", "cash", "pos"].includes(key))
    .map((key) => providerNames[key]);

  if (kind === "privacy") return {
    title: en ? "Privacy Policy" : "Πολιτική Απορρήτου",
    intro: en
      ? "How our clothing store uses and protects customer information."
      : "Πώς το κατάστημα ένδυσης χρησιμοποιεί και προστατεύει τα στοιχεία των πελατών.",
    sections: [
      {
        title: en ? "Store and data controller" : "Κατάστημα και υπεύθυνος επεξεργασίας",
        paragraphs: [
          ...details,
          `${en ? "Data controller" : "Υπεύθυνος επεξεργασίας"}: ${text(settings.dataControllerName || settings.legalName, language)}`,
          `${en ? "Controller address" : "Διεύθυνση υπευθύνου"}: ${text(settings.dataControllerAddress || settings.businessAddress, language)}`,
        ],
      },
      {
        title: en ? "Information we use" : "Πληροφορίες που χρησιμοποιούμε",
        paragraphs: [en
          ? "We may use contact details, delivery and billing information, order and return history, payment status, customer-support messages, and basic technical information needed to operate and secure the website."
          : "Μπορεί να χρησιμοποιούμε στοιχεία επικοινωνίας, παράδοσης και τιμολόγησης, ιστορικό παραγγελιών και επιστροφών, κατάσταση πληρωμής, μηνύματα υποστήριξης και βασικά τεχνικά δεδομένα για τη λειτουργία και ασφάλεια του ιστοτόπου."],
      },
      {
        title: en ? "Why we use it" : "Γιατί τα χρησιμοποιούμε",
        paragraphs: [en
          ? "We use this information to answer enquiries, process purchases and returns, deliver products, prevent misuse, keep accounting records and comply with legal obligations."
          : "Χρησιμοποιούμε αυτά τα στοιχεία για απαντήσεις σε αιτήματα, αγορές και επιστροφές, παράδοση προϊόντων, πρόληψη κατάχρησης, τήρηση λογιστικών αρχείων και συμμόρφωση με νομικές υποχρεώσεις."],
      },
      {
        title: en ? "Service providers" : "Πάροχοι υπηρεσιών",
        paragraphs: [services.length ? services.join(", ") : (en ? "No optional third-party services are currently listed." : "Δεν αναφέρονται προαιρετικοί τρίτοι πάροχοι.")],
      },
      {
        title: en ? "Your privacy rights" : "Τα δικαιώματά σας",
        paragraphs: [
          en
            ? "Subject to applicable law, you may request access, correction, deletion, restriction or portability of your information, or object to certain processing."
            : "Σύμφωνα με την ισχύουσα νομοθεσία, μπορείτε να ζητήσετε πρόσβαση, διόρθωση, διαγραφή, περιορισμό ή φορητότητα των δεδομένων σας ή να αντιταχθείτε σε ορισμένη επεξεργασία.",
          `${en ? "Privacy contact" : "Επικοινωνία απορρήτου"}: ${text(settings.privacyRequestEmail || settings.contactEmail, language)}`,
          legalText(settings, "privacyRequestInstructions", language),
        ],
      },
      ...(settings.enabledProviders.some((provider) => provider === "openai" || provider === "deepseek") ? [{
        title: en ? "AI shopping assistance" : "Βοήθεια αγορών με τεχνητή νοημοσύνη",
        paragraphs: [en
          ? "When you choose to use the AI shopping assistant, the enabled AI provider processes your prompt and a limited product context to answer your request. Optional body measurements are used only for that request and are not stored in PostgreSQL, browser storage, application logs or analytics. The assistant does not make an automated purchasing decision for you."
          : "Όταν επιλέγετε να χρησιμοποιήσετε τον βοηθό αγορών τεχνητής νοημοσύνης, ο ενεργός πάροχος AI επεξεργάζεται το αίτημά σας και περιορισμένα στοιχεία προϊόντων για να απαντήσει. Οι προαιρετικές σωματικές μετρήσεις χρησιμοποιούνται μόνο για το συγκεκριμένο αίτημα και δεν αποθηκεύονται σε PostgreSQL, στον browser, στα αρχεία καταγραφής της εφαρμογής ή στα analytics. Ο βοηθός δεν λαμβάνει αυτοματοποιημένη απόφαση αγοράς για εσάς."],
      }] : []),
    ],
  };

  if (kind === "terms") return {
    title: en ? "Terms of Sale" : "Όροι Πώλησης",
    intro: en
      ? "The terms that apply when buying clothing and accessories from this store."
      : "Οι όροι που ισχύουν για αγορές ενδυμάτων και αξεσουάρ από το κατάστημα.",
    sections: [
      { title: en ? "Seller information" : "Στοιχεία πωλητή", paragraphs: details },
      {
        title: en ? "Products, sizing and availability" : "Προϊόντα, μεγέθη και διαθεσιμότητα",
        paragraphs: [en
          ? "We aim to present product descriptions, colours, sizing, materials, prices and stock accurately. Screen colours and measurements may vary slightly. An order is subject to stock availability and confirmation by the store."
          : "Στόχος μας είναι η ακριβής παρουσίαση περιγραφών, χρωμάτων, μεγεθών, υλικών, τιμών και αποθέματος. Τα χρώματα οθόνης και οι μετρήσεις ενδέχεται να διαφέρουν ελαφρώς. Η παραγγελία εξαρτάται από τη διαθεσιμότητα και την επιβεβαίωση του καταστήματος."],
      },
      {
        title: en ? "Prices and payment" : "Τιμές και πληρωμή",
        paragraphs: [
          legalText(settings, "paymentTerms", language),
          paymentServices.length
            ? `${en ? "Accepted methods" : "Αποδεκτοί τρόποι"}: ${paymentServices.join(", ")}`
            : pending(language),
        ],
      },
      {
        title: en ? "Delivery" : "Παράδοση",
        paragraphs: [legalText(settings, "shippingPolicy", language)],
      },
      {
        title: en ? "Returns, withdrawal and refunds" : "Επιστροφές, υπαναχώρηση και επιστροφή χρημάτων",
        paragraphs: [legalText(settings, "returnPolicy", language), legalText(settings, "withdrawalRight", language), legalText(settings, "refundPolicy", language)],
      },
    ],
  };

  if (kind === "cookies") {
    const optional: string[] = [];
    if (settings.analyticsEnabled) optional.push(settings.enabledProviders.includes("posthog") ? "PostHog analytics" : (en ? "Analytics" : "Analytics"));
    if (settings.errorMonitoringEnabled) optional.push(settings.enabledProviders.includes("sentry") ? "Sentry error monitoring" : (en ? "Error monitoring" : "Παρακολούθηση σφαλμάτων"));
    if (settings.advertisingEnabled) optional.push(en ? "Advertising or tracking technologies" : "Τεχνολογίες διαφήμισης ή παρακολούθησης");
    return {
      title: en ? "Cookie Policy" : "Πολιτική Cookies",
      intro: en ? "What this store saves in your browser and how you control optional services." : "Τι αποθηκεύει το κατάστημα στον browser σας και πώς ελέγχετε τις προαιρετικές υπηρεσίες.",
      sections: [
        { title: en ? "Essential storage" : "Απαραίτητη αποθήκευση", paragraphs: [legalText(settings, "essentialStorageDescription", language)] },
        {
          title: en ? "Optional services" : "Προαιρετικές υπηρεσίες",
          paragraphs: optional.length
            ? [en ? `The following load only after consent: ${optional.join(", ")}.` : `Τα ακόλουθα φορτώνονται μόνο μετά από συγκατάθεση: ${optional.join(", ")}.`]
            : [en ? "No optional analytics, error-monitoring or advertising technologies are currently enabled." : "Δεν είναι ενεργές προαιρετικές τεχνολογίες analytics, παρακολούθησης σφαλμάτων ή διαφήμισης."],
        },
        { title: en ? "Change your choice" : "Αλλαγή επιλογής", paragraphs: [en ? "Use Cookie preferences in the footer at any time. Rejecting optional services does not prevent shopping or using essential website functions." : "Χρησιμοποιήστε τις Προτιμήσεις Cookies στο υποσέλιδο οποιαδήποτε στιγμή. Η απόρριψη προαιρετικών υπηρεσιών δεν εμποδίζει τις αγορές ή τις βασικές λειτουργίες του ιστοτόπου."] },
      ],
    };
  }

  if (kind === "shipping") return {
    title: en ? "Shipping Policy" : "Πολιτική Αποστολής",
    intro: en ? "BOX NOW Locker delivery, store pickup, charges and what to do if an order has a problem." : "Παράδοση σε BOX NOW Locker, παραλαβή από το κατάστημα, χρεώσεις και αντιμετώπιση προβλημάτων παραγγελίας.",
    sections: [
      { title: en ? "Shipping and delivery" : "Αποστολή και παράδοση", paragraphs: [legalText(settings, "shippingPolicy", language)] },
      { title: "BOX NOW Locker", paragraphs: [en ? "Choose the intended BOX NOW Locker during checkout and provide accurate contact details. The store does not request a home-delivery address for this method. Contact the store promptly if the selected Locker is incorrect or the parcel appears damaged." : "Επιλέξτε το σωστό BOX NOW Locker κατά την ολοκλήρωση της αγοράς και δώστε ακριβή στοιχεία επικοινωνίας. Για αυτή τη μέθοδο το κατάστημα δεν ζητά διεύθυνση κατ’ οίκον παράδοσης. Επικοινωνήστε άμεσα με το κατάστημα αν το Locker είναι λάθος ή το δέμα φαίνεται κατεστραμμένο."] },
      { title: en ? "Store pickup" : "Παραλαβή από το κατάστημα", paragraphs: [en ? "Wait until the store confirms that the prepaid order is ready. Bring the pickup code and collect the order within the stated holding period. An overdue pickup is handled by the store and is not cancelled or refunded automatically." : "Περιμένετε την επιβεβαίωση ότι η προπληρωμένη παραγγελία είναι έτοιμη. Έχετε μαζί σας τον κωδικό παραλαβής και παραλάβετε εντός της αναφερόμενης προθεσμίας. Μια εκπρόθεσμη παραλαβή εξετάζεται από το κατάστημα και δεν ακυρώνεται ούτε επιστρέφεται αυτόματα."] },
      { title: en ? "Contact" : "Επικοινωνία", paragraphs: [`${text(settings.contactEmail, language)} · ${text(settings.phone, language)}`] },
    ],
  };

  if (kind === "return") return {
    title: en ? "Return Policy" : "Πολιτική Επιστροφών",
    intro: en ? "How to return clothing or accessories and which items may be excluded." : "Πώς επιστρέφονται ενδύματα ή αξεσουάρ και ποια είδη μπορεί να εξαιρούνται.",
    sections: [
      { title: en ? "Return conditions" : "Προϋποθέσεις επιστροφής", paragraphs: [legalText(settings, "returnPolicy", language)] },
      { title: en ? "14-day withdrawal right" : "Δικαίωμα υπαναχώρησης 14 ημερών", paragraphs: [legalText(settings, "withdrawalRight", language)] },
      { title: en ? "Return address" : "Διεύθυνση επιστροφής", paragraphs: [legalText(settings, "returnAddress", language)] },
      { title: en ? "Return shipping costs" : "Έξοδα επιστροφής", paragraphs: [legalText(settings, "returnShippingResponsibility", language)] },
      { title: en ? "Items excluded from return" : "Είδη που εξαιρούνται", paragraphs: [legalText(settings, "nonReturnableItems", language)] },
    ],
  };

  return {
    title: en ? "Refund Policy" : "Πολιτική Επιστροφής Χρημάτων",
    intro: en ? "When and how an approved clothing return is refunded." : "Πότε και πώς επιστρέφονται χρήματα για εγκεκριμένη επιστροφή προϊόντος.",
    sections: [
      { title: en ? "Refund conditions and timing" : "Προϋποθέσεις και χρόνος επιστροφής χρημάτων", paragraphs: [legalText(settings, "refundPolicy", language)] },
      { title: en ? "Original payment method" : "Αρχικός τρόπος πληρωμής", paragraphs: [en ? "Unless otherwise agreed or required by law, an approved refund is made to the original payment method. Bank or payment-provider processing times may apply." : "Εκτός αν συμφωνηθεί διαφορετικά ή απαιτείται από τον νόμο, η εγκεκριμένη επιστροφή χρημάτων γίνεται στον αρχικό τρόπο πληρωμής. Ενδέχεται να ισχύουν χρόνοι επεξεργασίας τράπεζας ή παρόχου πληρωμών."] },
      { title: en ? "Need help?" : "Χρειάζεστε βοήθεια;", paragraphs: [`${text(settings.contactEmail, language)} · ${text(settings.phone, language)}`] },
    ],
  };
}

export async function LegalPage({ kind, language, settings }: { kind: LegalKind; language: Language; settings: BusinessSettings }) {
  const published = await getPublishedLegalSettings();
  const page = legalCopy(kind, language, published.settings);
  return (
    <main className="min-h-screen bg-paper">
      <SiteHeader language={language} settings={settings} />
      <section className="ui-container py-10 sm:py-14">
        <div className="mx-auto max-w-4xl">
          <p className="ui-kicker">{published.currentVersion || (language === "en" ? "Legal information incomplete" : "Νομικές πληροφορίες σε εκκρεμότητα")}</p>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-5xl">{page.title}</h1>
          <p className="mt-4 text-base leading-7 text-stone-600">{page.intro}</p>
          {!published.complete ? <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">{pending(language)}</div> : null}
          <div className="mt-8 space-y-5">
            {page.sections.map((section) => (
              <section className="ui-panel p-6 sm:p-8" key={section.title}>
                <h2 className="text-xl font-black text-ink">{section.title}</h2>
                <div className="mt-4 space-y-3 text-sm leading-7 text-stone-600">
                  {section.paragraphs.map((paragraph, index) => <p key={`${section.title}-${index}`}>{paragraph}</p>)}
                </div>
              </section>
            ))}
          </div>
          <p className="mt-8 text-xs leading-5 text-stone-500">
            {language === "en" ? "Last updated" : "Τελευταία ενημέρωση"}: {published.settings.legalLastUpdated || pending(language)} · {published.currentVersion || "draft"}. {language === "en" ? "This general information does not replace advice tailored to the business by a lawyer, accountant or local compliance professional." : "Οι γενικές αυτές πληροφορίες δεν αντικαθιστούν εξατομικευμένη συμβουλή δικηγόρου, λογιστή ή επαγγελματία συμμόρφωσης."}
          </p>
        </div>
      </section>
      <SiteFooter language={language} settings={settings} />
    </main>
  );
}
