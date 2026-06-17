export const siteName = "Helios Wear";
export const whatsappUrl = "https://wa.me/306900000000";
export const instagramUrl = "https://instagram.com/";
export const googleMapsUrl = "https://maps.google.com/?q=Ermou+45+Athens+Greece";
export const storeAddress = "Ermou 45, Athens 10563, Greece";
export const storePhone = "+30 690 000 0000";

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}
