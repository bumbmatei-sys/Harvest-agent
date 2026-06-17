# Course UI Redesign — Implementation Plan

> **For Hermes:** Implement task-by-task. Each task = one file rewrite.

**Goal:** Replace the current "AI slop" course UI with a premium Notion×MasterClass design.

**Architecture:** Rewrite all 6 course components to use Tailwind CSS (not inline styles), consistent gold system, Inter font, multi-layer shadows. Keep existing data types and Firestore queries unchanged.

**Tech Stack:** React, Tailwind CSS, TipTap, Firebase, Lucide icons

---

## Files to Change

| File | Action | Lines |
|------|--------|-------|
| `src/utils/course.constants.ts` | Rewrite | ~25 |
| `src/components/course/CourseCard.tsx` | Rewrite | ~60 |
| `src/components/course/CourseLibrary.tsx` | Rewrite | ~120 |
| `src/components/course/CourseOverview.tsx` | Rewrite | ~200 |
| `src/components/course/LessonView.tsx` | Rewrite | ~250 |
| `src/components/course/AuthorProfile.tsx` | Rewrite | ~130 |
| `src/components/CoursePage.tsx` | Update | ~200 |
| `src/components/course/ProgressBar.tsx` | Keep | 15 |

## Design Tokens

- Gold: `#C9963A`, Gold Light: `#FBF3E4`, Gold Hover: `#b8860b`
- BG: `#ffffff`, BG Warm: `#faf9f7`
- Text: `#1a1a1a`, Text2: `#6b7280`, Text3: `#9ca3af`
- Border: `#e5e7eb`, Border Light: `#f3f4f6`
- Green: `#16a34a`, Green BG: `#f0fdf4`
- Radius: 12px cards, 8px buttons
- Shadows: multi-layer (Notion style)
- Font: Inter (already in layout.tsx)

## Task Order

1. Constants → 2. Card → 3. Library → 4. Overview → 5. Lesson → 6. Author → 7. CoursePage → 8. Deploy
