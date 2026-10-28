import { BookOpen, FileDown, Layers, Sparkles, UserRound, Users } from 'lucide-react';

import type { ProductTypeOption } from './NewProductDialog';

/**
 * What the "New product" picker offers: things a ministry makes for its people
 * to keep or work through. Fundraising, Events, Services and Forms are not in
 * here. Each has its own section in the sidebar and its own builder, and
 * offering them in a product picker made one product look like four.
 *
 * Course and Digital download have builders today. The rest are listed so the
 * roadmap is visible and cannot be picked. Community is one of them: it will
 * be made here, as a product, once it is built. The last card says more types
 * are on the way and is not a type at all.
 */
export const PRODUCT_TYPES: readonly ProductTypeOption[] = [
  { id: 'course', label: 'Course', description: 'Lessons people read or watch, in order, with progress.', membersGet: 'Lessons, progress and a certificate', icon: <BookOpen />, tag: 'Start here', available: true },
  { id: 'digital-download', label: 'Digital download / Ebook', description: 'A file people download: an ebook, a study guide, a worksheet.', membersGet: 'A file to keep', icon: <FileDown />, available: true },
  { id: 'coaching', label: 'Coaching', description: 'One-to-one or small-group sessions you book with people.', membersGet: 'A booked session', icon: <UserRound />, available: false },
  { id: 'bundle', label: 'Bundle', description: 'Several products offered together.', membersGet: 'Everything in the bundle', icon: <Layers />, available: false },
  { id: 'community', label: 'Community', description: 'A space where members talk, share and pray together.', membersGet: 'Conversations and groups', icon: <Users />, available: false },
  { id: 'more', label: 'More coming soon', description: 'More ways to share what you teach are on the way.', icon: <Sparkles />, available: false, placeholder: true },
];

/** The ids the picker offers. A section with its own builder must never appear here. */
export const PRODUCT_TYPE_IDS: readonly string[] = PRODUCT_TYPES.map((t) => t.id);
