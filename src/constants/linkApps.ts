export interface LinkApp {
  name: string;
  scheme: string; // stored in Task.linkUrl verbatim when selected
  icon: string;   // Ionicons name for the chip
  sfSymbol: string; // SF Symbol name for the same app, used by the Live Activity (native, no Ionicons there)
}

// Best-effort custom URL schemes for popular apps — not guaranteed to stay
// accurate across app updates, but "Custom URL" is always available as a
// fallback if one stops working.
export const KNOWN_LINK_APPS: LinkApp[] = [
  // First, and the one entry the "may stop working" caveat above doesn't apply
  // to — it's this app's own scheme. A recurring "Grocery run" task carrying
  // it opens the list, which is how groceries reach Today without a grocery
  // item ever having to pretend to be a task.
  { name: 'Groceries', scheme: 'dundundun://groceries', icon: 'cart-outline', sfSymbol: 'cart.fill' },
  { name: 'Duolingo', scheme: 'duolingo://', icon: 'school-outline', sfSymbol: 'graduationcap.fill' },
  { name: 'Spotify', scheme: 'spotify://', icon: 'musical-notes-outline', sfSymbol: 'music.note' },
  { name: 'YouTube', scheme: 'youtube://', icon: 'logo-youtube', sfSymbol: 'play.rectangle.fill' },
  { name: 'Gmail', scheme: 'googlegmail://', icon: 'mail-outline', sfSymbol: 'envelope.fill' },
  { name: 'Instagram', scheme: 'instagram://app', icon: 'logo-instagram', sfSymbol: 'camera.fill' },
  { name: 'Notion', scheme: 'notion://', icon: 'document-text-outline', sfSymbol: 'doc.text.fill' },
];
