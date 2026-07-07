import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { Language } from "@/lib/i18n";
import { providerNames } from "@/lib/legal";
import { getPublishedLegalSettings, type LegalSettingsData } from "@/lib/legal-settings";
import type { BusinessSettings } from "@/lib/settings";

export type LegalKind = "privacy" | "terms" | "cookies" | "refund" | "cancellation" | "return" | "shipping";
type Section = { title: string; paragraphs: string[] };

const pending = (language: Language) => language === "en"
  ? "This information has not been completed by the business yet. Please contact the store before relying on it."
  : "Η επιχείρηση δεν έχει ακόμη συμπληρώσει αυτές τις πληροφορίες. Επικοινωνήστε με το κατάστημα πριν βασιστείτε σε αυτές.";

function text(value: string, language: Language) {
  return value.trim() || pending(language);
}

function businessDetails(s: LegalSettingsData, language: Language) {
  const rows = language === "en"
    ? [`Trading name: ${text(s.businessName, language)}`, `Legal entity: ${text(s.legalName, language)}`, `Address: ${text(s.businessAddress, language)}`, `VAT / AFM: ${text(s.vatNumber, language)}`, s.gemiNumber ? `GEMI: ${s.gemiNumber}` : "", `Country: ${text(s.country, language)}`, `Contact: ${text(s.contactEmail, language)} / ${text(s.phone, language)}`]
    : [`Εμπορική ονομασία: ${text(s.businessName, language)}`, `Νομική επωνυμία: ${text(s.legalName, language)}`, `Διεύθυνση: ${text(s.businessAddress, language)}`, `ΑΦΜ / VAT: ${text(s.vatNumber, language)}`, s.gemiNumber ? `ΓΕΜΗ: ${s.gemiNumber}` : "", `Χώρα: ${text(s.country, language)}`, `Επικοινωνία: ${text(s.contactEmail, language)} / ${text(s.phone, language)}`];
  return rows.filter(Boolean);
}

function copy(kind: LegalKind, language: Language, s: LegalSettingsData): { title: string; intro: string; sections: Section[] } {
  const en = language === "en";
  const providers = s.enabledProviders.map((key) => providerNames[key]);
  if (s.otherProviders) providers.push(s.otherProviders);
  const details = businessDetails(s, language);

  if (kind === "privacy") return {
    title: en ? "Privacy Policy" : "Πολιτική Απορρήτου",
    intro: en ? "How the business handles personal information and privacy requests." : "Πώς η επιχείρηση χειρίζεται προσωπικά δεδομένα και αιτήματα απορρήτου.",
    sections: [
      { title: en ? "Business and data controller" : "Επιχείρηση και υπεύθυνος επεξεργασίας", paragraphs: [...details, `${en ? "Controller" : "Υπεύθυνος"}: ${text(s.dataControllerName, language)}`, `${en ? "Controller address" : "Διεύθυνση υπευθύνου"}: ${text(s.dataControllerAddress, language)}`] },
      { title: en ? "Purposes and data" : "Σκοποί και δεδομένα", paragraphs: [en ? "We may process contact, order, support, transaction and technical website data to provide services, maintain security and meet accounting or legal duties." : "Μπορεί να επεξεργαζόμαστε στοιχεία επικοινωνίας, παραγγελιών, υποστήριξης, συναλλαγών και τεχνικής χρήσης για παροχή υπηρεσιών, ασφάλεια και νόμιμες υποχρεώσεις."] },
      { title: en ? "Enabled processors and services" : "Ενεργοί πάροχοι και υπηρεσίες", paragraphs: [providers.length ? providers.join(", ") : pending(language)] },
      { title: en ? "Privacy requests" : "Αιτήματα απορρήτου", paragraphs: [`${en ? "Email" : "Email"}: ${text(s.privacyRequestEmail || s.contactEmail, language)}`, text(s.privacyRequestInstructions, language)] },
    ],
  };
  if (kind === "terms") return {
    title: en ? "Terms of Service" : "Όροι Χρήσης",
    intro: en ? "Basic terms for use of this website and the services offered by the business." : "Βασικοί όροι χρήσης της ιστοσελίδας και των υπηρεσιών της επιχείρησης.",
    sections: [
      { title: en ? "Business details" : "Στοιχεία επιχείρησης", paragraphs: details },
      { title: en ? "Website and product information" : "Ιστοσελίδα και πληροφορίες προϊόντων", paragraphs: [en ? "Product descriptions, images, prices and availability may change. Important information should be confirmed before purchase." : "Περιγραφές, εικόνες, τιμές και διαθεσιμότητα μπορεί να αλλάξουν. Επιβεβαιώστε σημαντικές πληροφορίες πριν την αγορά."] },
      { title: en ? "Payment terms" : "Όροι πληρωμής", paragraphs: [text(s.paymentTerms, language), providers.filter((name) => ["Stripe", "Viva", "Cash / 现金", "Card terminal / POS"].includes(name)).join(", ") || pending(language)] },
      { title: en ? "Fulfilment and cancellation" : "Εκτέλεση και ακύρωση", paragraphs: [s.projectType === "restaurant" ? text(s.cancellationPolicy, language) : text(s.shippingPolicy, language)] },
    ],
  };
  if (kind === "cookies") {
    const optional: string[] = [];
    if (s.analyticsEnabled) optional.push(`${en ? "Analytics" : "Analytics"}: ${s.enabledProviders.includes("posthog") ? "PostHog" : en ? "enabled" : "ενεργά"}`);
    if (s.errorMonitoringEnabled) optional.push(`${en ? "Error monitoring" : "Παρακολούθηση σφαλμάτων"}: ${s.enabledProviders.includes("sentry") ? "Sentry" : en ? "enabled" : "ενεργή"}`);
    if (s.advertisingEnabled) optional.push(en ? "Advertising or tracking cookies are enabled after consent." : "Cookies διαφήμισης ή παρακολούθησης ενεργοποιούνται μετά από συγκατάθεση.");
    return { title: en ? "Cookie Policy" : "Πολιτική Cookies", intro: en ? "Essential storage and optional consent-controlled services." : "Απαραίτητη αποθήκευση και προαιρετικές υπηρεσίες με συγκατάθεση.", sections: [
      { title: en ? "Essential storage" : "Απαραίτητη αποθήκευση", paragraphs: [text(s.essentialStorageDescription, language)] },
      { title: en ? "Optional services" : "Προαιρετικές υπηρεσίες", paragraphs: optional.length ? optional : [en ? "No optional analytics, monitoring or advertising cookies are enabled." : "Δεν είναι ενεργά προαιρετικά analytics, monitoring ή διαφημιστικά cookies."] },
      { title: en ? "Manage preferences" : "Διαχείριση προτιμήσεων", paragraphs: [en ? "Use the Cookie preferences button in the footer to change your choice at any time." : "Χρησιμοποιήστε το κουμπί Cookie preferences στο υποσέλιδο για αλλαγή επιλογής."] },
    ] };
  }
  if (kind === "cancellation") return { title: en ? "Cancellation Policy" : "Πολιτική Ακύρωσης", intro: en ? "Cancellation terms for restaurant orders or reservations." : "Όροι ακύρωσης για παραγγελίες ή κρατήσεις εστιατορίου.", sections: [
    { title: en ? "Cancellation terms" : "Όροι ακύρωσης", paragraphs: [text(s.cancellationPolicy, language)] },
    { title: en ? "Allergens" : "Αλλεργιογόνα", paragraphs: [text(s.allergenDisclaimer, language)] },
    { title: en ? "Receipt notice" : "Σημείωση απόδειξης", paragraphs: [text(s.receiptDisclaimer, language)] },
  ] };
  const map = {
    shipping: [en ? "Shipping Policy" : "Πολιτική Αποστολής", s.shippingPolicy],
    return: [en ? "Return Policy" : "Πολιτική Επιστροφών", s.returnPolicy],
    refund: [en ? "Refund Policy" : "Πολιτική Επιστροφής Χρημάτων", s.refundPolicy],
  } as const;
  const [title, primary] = map[kind as "shipping" | "return" | "refund"];
  return { title, intro: en ? "Retail fulfilment, return and consumer withdrawal information." : "Πληροφορίες αποστολής, επιστροφής και δικαιώματος υπαναχώρησης.", sections: [
    { title: en ? "Business details" : "Στοιχεία επιχείρησης", paragraphs: details },
    { title, paragraphs: [text(primary, language)] },
    { title: en ? "14-day withdrawal right" : "Δικαίωμα υπαναχώρησης 14 ημερών", paragraphs: [text(s.withdrawalRight, language)] },
    { title: en ? "Return address and shipping cost" : "Διεύθυνση και έξοδα επιστροφής", paragraphs: [text(s.returnAddress, language), text(s.returnShippingResponsibility, language)] },
    { title: en ? "Non-returnable items" : "Εξαιρέσεις επιστροφών", paragraphs: [text(s.nonReturnableItems, language)] },
  ] };
}

export async function LegalPage({ kind, language, settings }: { kind: LegalKind; language: Language; settings: BusinessSettings }) {
  const published = await getPublishedLegalSettings();
  const page = copy(kind, language, published.settings);
  return <main className="min-h-screen bg-paper"><SiteHeader language={language} settings={settings} />
    <section className="ui-container py-10 sm:py-14"><div className="mx-auto max-w-4xl"><p className="ui-kicker">{published.currentVersion ? `${published.currentVersion} · ${published.settings.projectType}` : language === "en" ? "Legal information incomplete" : "Νομικές πληροφορίες σε εκκρεμότητα"}</p><h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-5xl">{page.title}</h1><p className="mt-4 text-base leading-7 text-stone-600">{page.intro}</p>
      {!published.complete ? <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">{pending(language)}</div> : null}
      <div className="mt-8 space-y-5">{page.sections.map((section) => <section className="ui-panel p-6 sm:p-8" key={section.title}><h2 className="text-xl font-black text-ink">{section.title}</h2><div className="mt-4 space-y-3 text-sm leading-7 text-stone-600">{section.paragraphs.map((paragraph, index) => <p key={`${section.title}-${index}`}>{paragraph}</p>)}</div></section>)}</div>
      <p className="mt-8 text-xs leading-5 text-stone-500">{language === "en" ? "Last updated" : "Τελευταία ενημέρωση"}: {published.settings.legalLastUpdated || pending(language)} · {published.currentVersion || "draft"}. {language === "en" ? "This is a reusable legal template and does not replace advice from a lawyer, accountant or local compliance professional." : "Το παρόν είναι επαναχρησιμοποιήσιμο νομικό πρότυπο και δεν αντικαθιστά συμβουλή δικηγόρου, λογιστή ή επαγγελματία συμμόρφωσης."}</p>
    </div></section><SiteFooter language={language} settings={settings} /></main>;
}
