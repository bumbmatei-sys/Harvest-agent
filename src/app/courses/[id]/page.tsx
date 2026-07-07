import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantFromHost } from '@/lib/server-tenant';
import type { Course, Level } from '@/types/course.types';

interface CourseDoc extends Course {
  status?: string;
  tenantId?: string | null;
}

function countLessons(levels: Level[]): number {
  return levels.reduce(
    (acc, lvl) => acc + lvl.sections.reduce((a, s) => a + s.lessons.length, 0),
    0,
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const snap = await adminDb.collection('courses').doc(id).get();
  if (!snap.exists) return { title: 'Course Not Found' };

  const course = snap.data() as CourseDoc;

  return {
    title: course.title,
    description: course.description || undefined,
    openGraph: {
      title: course.title,
      description: course.description || undefined,
      type: 'website',
      ...(course.thumbnail ? { images: [course.thumbnail] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: course.title,
      description: course.description || undefined,
      ...(course.thumbnail ? { images: [course.thumbnail] } : {}),
    },
  };
}

export default async function CoursePublicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const headersList = await headers();
  const host = headersList.get('host') || '';

  const [snap, tenant] = await Promise.all([
    adminDb.collection('courses').doc(id).get(),
    getTenantFromHost(host),
  ]);

  if (!snap.exists) notFound();

  const course = { id: snap.id, ...snap.data() } as CourseDoc;

  // Only expose published courses publicly
  if (course.status && course.status !== 'published') notFound();

  const lessonCount = countLessons(course.levels ?? []);
  const levelCount = course.levels?.length ?? 0;
  const appUrl = `/?course=${id}`;
  const backLabel = tenant ? `Back to ${tenant.name}` : 'Back to Harvest';

  return (
    <div className="min-h-screen bg-white">
      {/* Minimal header */}
      <header className="border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-[#D4AF37] hover:text-[#C9963A] font-medium transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {backLabel}
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10">
        {/* Thumbnail */}
        {course.thumbnail && (
          <img
            src={course.thumbnail}
            alt={course.title}
            className="w-full rounded-2xl mb-8 aspect-video object-cover"
          />
        )}

        {/* Category */}
        {course.category && (
          <span className="text-xs font-semibold uppercase tracking-wider text-[#D4AF37] mb-3 block">
            {course.category}
          </span>
        )}

        <h1 className="font-display text-3xl font-black text-[#0b1121] mb-3 leading-tight">
          {course.title}
        </h1>

        {course.description && (
          <p className="text-gray-600 text-base mb-6 leading-relaxed">
            {course.description}
          </p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-gray-400 mb-8">
          <span>
            {levelCount} level{levelCount !== 1 ? 's' : ''}
          </span>
          <span className="w-1 h-1 rounded-full bg-gray-300" />
          <span>
            {lessonCount} lesson{lessonCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Level preview — first level only */}
        {(course.levels ?? []).slice(0, 1).map(level => (
          <div key={level.id} className="mb-8 p-5 rounded-2xl bg-gray-50">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              Preview
            </p>
            <h2 className="font-bold text-[#0b1121] mb-3">{level.title}</h2>
            <ul className="space-y-2.5">
              {level.sections.slice(0, 3).map(section => (
                <li
                  key={section.id}
                  className="flex items-center gap-2.5 text-sm text-gray-600"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] flex-shrink-0" />
                  {section.title}
                  {section.lessons.length > 0 && (
                    <span className="text-gray-400">
                      · {section.lessons.length} lesson{section.lessons.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </li>
              ))}
              {level.sections.length > 3 && (
                <li className="text-sm text-gray-400 pl-4">
                  +{level.sections.length - 3} more sections
                </li>
              )}
            </ul>
          </div>
        ))}

        {/* Enroll CTA */}
        <a
          href={appUrl}
          className="block w-full text-center bg-[#D4AF37] text-white font-bold py-4 rounded-xl hover:bg-[#C9963A] transition-colors text-base"
        >
          Start Learning
        </a>

        <p className="text-center text-xs text-gray-400 mt-3">
          Free to access · Opens in the {tenant?.name || 'Harvest'} app
        </p>
      </main>
    </div>
  );
}
