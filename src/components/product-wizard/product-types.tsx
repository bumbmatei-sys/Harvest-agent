import { BookOpen, FileDown, Layers, UserRound } from 'lucide-react';

import type { ProductTypeOption } from './NewProductDialog';

/**
 * What the "New product" picker offers: things a ministry makes for its people
 * to keep or work through. Fundraising, Events, Services and Forms are not in
 * here. Each has its own section in the sidebar and its own builder, and
 * offering them in a product picker made one product look like four.
 *
 * Course is the only type with a builder today. The rest are listed so the
 * roadmap is visible and cannot be picked.
 */
export const PRODUCT_TYPES: readonly ProductTypeOption[] = [
  { id: 'course', label: 'Course', description: 'Lessons people read or watch, in order, with progress.', membersGet: 'Lessons, progress and a certificate', icon: <BookOpen />, tag: 'Start here', available: true },
  { id: 'digital-download', label: 'Digital download / Ebook', description: 'A file people download: an ebook, a study guide, a worksheet.', membersGet: 'A file to keep', icon: <FileDown />, available: false },
  { id: 'coaching', label: 'Coaching', description: 'One-to-one or small-group sessions you book with people.', membersGet: 'A booked session', icon: <UserRound />, available: false },
  { id: 'bundle', label: 'Bundle', description: 'Several products offered together.', membersGet: 'Everything in the bundle', icon: <Layers />, available: false },
];

/** The ids the picker offers. A section with its own builder must never appear here. */
export const PRODUCT_TYPE_IDS: readonly string[] = PRODUCT_TYPES.map((t) => t.id);
