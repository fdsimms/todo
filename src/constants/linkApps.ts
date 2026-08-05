export interface LinkApp {
  name: string;
  scheme: string; // stored in Task.linkUrl verbatim when selected
  icon: string;   // Ionicons name for the chip
}

// Best-effort custom URL schemes for popular apps — not guaranteed to stay
// accurate across app updates, but "Custom URL" is always available as a
// fallback if one stops working.
export const KNOWN_LINK_APPS: LinkApp[] = [
  { name: 'Duolingo', scheme: 'duolingo://', icon: 'school-outline' },
  { name: 'Spotify', scheme: 'spotify://', icon: 'musical-notes-outline' },
  { name: 'YouTube', scheme: 'youtube://', icon: 'logo-youtube' },
  { name: 'Gmail', scheme: 'googlegmail://', icon: 'mail-outline' },
  { name: 'Instagram', scheme: 'instagram://app', icon: 'logo-instagram' },
  { name: 'Notion', scheme: 'notion://', icon: 'document-text-outline' },
];
