import { Badge } from '@/components/ui/badge';
import { toSafeDate, type DateLike } from '@/utils/format-date';
import type { CommunitySource, MembershipStatus } from '@/lib/community-membership';
export type CommunityContactFields = {
  source?: string; communityUserId?: string; communitySource?: CommunitySource;
  consentAt?: DateLike; consentScope?: string; consentVersion?: number;
  communityStatus?: MembershipStatus; communityJoinedAt?: DateLike; communityLeftAt?: DateLike;
};
const labels = { discover: 'Discover', link: 'Link', website: 'Website' };
export function CommunityContactBadge({ contact }: { contact: CommunityContactFields }) {
  if (contact.source !== 'community') return null;
  const date = toSafeDate(contact.communityLeftAt);
  return <Badge variant="secondary" className="max-w-full whitespace-normal text-xs">Community · {contact.communitySource ? (labels[contact.communitySource] || 'Source unavailable') : 'Source unavailable'}{contact.communityStatus === 'left' && ` · Left ${date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '(date unavailable)'}`}</Badge>;
}
