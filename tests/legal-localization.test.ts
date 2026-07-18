import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyLocalizedLegalCopy,
  localizedLegalText,
  normalizeLocalizedLegalCopy,
  validateLocalizedLegalCopy,
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
} from "../lib/legal-localization.ts";

const requiredCopy = {
  privacyRequestInstructions: "Contact the privacy email with proof of identity.",
  essentialStorageDescription: "Essential language, security and consent storage.",
  paymentTerms: "Prices include VAT. Cash and card are accepted in store.",
  shippingPolicy: "Orders ship within two working days.",
  returnPolicy: "Unworn items with tags may be returned.",
  refundPolicy: "Approved refunds use the original payment method.",
  withdrawalRight: "Consumers may exercise the statutory 14-day withdrawal right.",
  returnAddress: "Example Street 1, Athens",
  returnShippingResponsibility: "The customer pays ordinary return shipping unless the item is faulty.",
  nonReturnableItems: "Lawful hygiene and personalised-item exclusions only.",
  otherProviders: "",
};

test("legacy one-language legal copy is preserved as English but never presented as Greek", () => {
  const normalized = normalizeLocalizedLegalCopy({}, requiredCopy);
  assert.equal(normalized.en.shippingPolicy, requiredCopy.shippingPolicy);
  assert.equal(normalized.el.shippingPolicy, "");
  assert.equal(localizedLegalText(normalized, "shippingPolicy", "el"), "");
  assert.match(validateLocalizedLegalCopy(normalized).join("\n"), /希腊语.*配送/);
});

test("publish validation requires independent complete Greek and English retail policies", () => {
  const localized = createEmptyLocalizedLegalCopy();
  localized.en = { ...requiredCopy };
  localized.el = {
    privacyRequestInstructions: "Επικοινωνήστε με το email απορρήτου με αποδεικτικό ταυτότητας.",
    essentialStorageDescription: "Απαραίτητη αποθήκευση γλώσσας, ασφάλειας και συγκατάθεσης.",
    paymentTerms: "Οι τιμές περιλαμβάνουν ΦΠΑ. Δεκτά μετρητά και κάρτα.",
    shippingPolicy: "Οι παραγγελίες αποστέλλονται εντός δύο εργάσιμων ημερών.",
    returnPolicy: "Επιστρέφονται αφόρετα είδη με ετικέτες.",
    refundPolicy: "Οι εγκεκριμένες επιστροφές γίνονται στον αρχικό τρόπο πληρωμής.",
    withdrawalRight: "Ισχύει το νόμιμο δικαίωμα υπαναχώρησης 14 ημερών.",
    returnAddress: "Οδός Παραδείγματος 1, Αθήνα",
    returnShippingResponsibility: "Ο πελάτης πληρώνει τα συνήθη έξοδα, εκτός ελαττωματικού προϊόντος.",
    nonReturnableItems: "Μόνο νόμιμες εξαιρέσεις υγιεινής και εξατομικευμένων ειδών.",
    otherProviders: "",
  };

  assert.deepEqual(validateLocalizedLegalCopy(localized), []);
  assert.equal(localizedLegalText(localized, "returnPolicy", "el"), localized.el.returnPolicy);
  assert.equal(localizedLegalText(localized, "returnPolicy", "en"), localized.en.returnPolicy);
});

test("normalization never copies Greek into English or English into Greek", () => {
  const normalized = normalizeLocalizedLegalCopy({
    el: { ...requiredCopy, shippingPolicy: "Ελληνική πολιτική" },
    en: { ...requiredCopy, shippingPolicy: "English policy" },
  });
  assert.equal(normalized.el.shippingPolicy, "Ελληνική πολιτική");
  assert.equal(normalized.en.shippingPolicy, "English policy");
});
