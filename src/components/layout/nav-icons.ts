import { Compass, Mailbox, ToolCase, Wallpaper } from 'lucide-react';

/** Standard Lucide identities shared by the admin and member navigation. */
export const NAV_ICONS = {
  discover: Compass,
  communities: ToolCase,
  website: Wallpaper,
  newsletter: Mailbox,
} as const;
