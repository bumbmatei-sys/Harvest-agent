"use client";
import React from "react";
import { Youtube, Instagram, Facebook, Linkedin, Podcast, Globe } from "lucide-react";
import { Author, Course } from "../../types/course.types";
import { GOLD, GOLD_LIGHT } from "../../utils/course.constants";
import { sanitizeHtml } from "../../utils/sanitize";

// Real brand glyphs lucide-react (v0.453) does not ship: the X wordmark and
// the TikTok note. Rendered with fill=currentColor so they inherit the same
// hover color transition as the lucide (stroke-based) icons.
function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

// Map a stored platform label to its icon. The editor stores Title Case labels
// ("YouTube", "Twitter / X", …) so we normalize to lowercase and match on
// substrings — case/format no longer matters. The globe is the explicit
// fallback for "Website", "Other", and any unknown value.
function SocialIcon({ platform }: { platform: string }) {
  const key = (platform || "").toLowerCase();
  if (key.includes("youtube")) return <Youtube size={18} strokeWidth={2} />;
  if (key.includes("instagram")) return <Instagram size={18} strokeWidth={2} />;
  if (key.includes("facebook")) return <Facebook size={18} strokeWidth={2} />;
  if (key.includes("linkedin")) return <Linkedin size={18} strokeWidth={2} />;
  if (key.includes("tiktok")) return <TikTokIcon />;
  if (key.includes("twitter") || key.includes("/ x") || key.trim() === "x") return <XIcon />;
  if (key.includes("podcast")) return <Podcast size={18} strokeWidth={2} />;
  return <Globe size={18} strokeWidth={2} />;
}

interface AuthorProfileProps {
  author: Author;
  onBack: () => void;
  courses?: Course[];
  onSelectCourse?: (course: Course) => void;
}

export function AuthorProfile({ author, onBack, courses, onSelectCourse }: AuthorProfileProps) {
  const authorCourses = courses?.filter((c) => c.authorIds?.includes(author.id)) || [];
  const totalLessons = authorCourses.reduce(
    (sum, c) => sum + (c.levels?.reduce((s, l) => s + l.sections?.reduce((s2, sec) => s2 + (sec.lessons?.length || 0), 0), 0) || 0),
    0
  );

  return (
    <div className="max-w-[480px] mx-auto pb-24">
      {/* Hero */}
      <div className="relative bg-gradient-to-br from-[color-mix(in_srgb,var(--brand-color)_10%,white)] to-[color-mix(in_srgb,var(--brand-color)_20%,white)] px-5 pt-4 pb-8 text-center">
        <button
          onClick={onBack}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/5 border-none flex items-center justify-center cursor-pointer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>

        {author.picture ? (
          <img
            src={author.picture}
            alt={author.name}
            className="w-24 h-24 rounded-full object-cover border-[3px] border-white shadow-lg mx-auto mb-4"
          />
        ) : (
          <div
            className="w-24 h-24 rounded-full border-[3px] border-white shadow-lg mx-auto mb-4 flex items-center justify-center text-2xl font-bold"
            style={{ background: GOLD_LIGHT, color: GOLD }}
          >
            {author.name?.charAt(0) || "?"}
          </div>
        )}

        <div className="text-2xl font-extrabold tracking-tight mb-1 font-display">{author.name}</div>
        <div className="text-sm text-warm-brown font-medium mb-4">{author.title || "Instructor"}</div>

        <div className="flex justify-center gap-8">
          <div className="text-center">
            <div className="text-xl font-extrabold">{authorCourses.length}</div>
            <div className="text-[11px] text-[color:var(--text-faint)] font-semibold uppercase tracking-wider">Courses</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-extrabold">{totalLessons}</div>
            <div className="text-[11px] text-[color:var(--text-faint)] font-semibold uppercase tracking-wider">Lessons</div>
          </div>
        </div>
      </div>

      <div className="px-5">
        {/* Bio */}
        {author.bio && (
          <div className="prose max-w-none text-sm leading-7 text-warm-brown py-5 border-b border-stone-200">
            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(author.bio) }} />
          </div>
        )}

        {/* Courses */}
        {authorCourses.length > 0 && (
          <div className="py-5">
            <h3 className="text-base font-bold mb-3.5 font-display">Courses by {author.name.split(" ")[0]}</h3>
            {authorCourses.map((course) => {
              const lessonCount = course.levels?.reduce(
                (s, l) => s + l.sections?.reduce((s2, sec) => s2 + (sec.lessons?.length || 0), 0),
                0
              ) || 0;

              return (
                <div
                  key={course.id}
                  className="flex gap-3 p-3 border border-stone-200 rounded-xl mb-2.5 cursor-pointer hover:shadow-md transition-all"
                  onClick={() => onSelectCourse?.(course)}
                >
                  <div className="w-20 h-[60px] rounded-lg overflow-hidden flex-shrink-0 bg-stone-100">
                    {course.thumbnail ? (
                      <img src={course.thumbnail} alt={course.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-stone-300">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="m8 21 4-4 4 4" /></svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 flex flex-col justify-center">
                    <div className="text-sm font-bold mb-0.5">{course.title}</div>
                    <div className="text-xs text-[color:var(--text-faint)]">{lessonCount} lessons</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Social links */}
        {author.links && author.links.length > 0 && (
          <div className="flex gap-2.5 pt-3 pb-5">
            {author.links.map((link, idx) => (
              <a
                key={idx}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center cursor-pointer transition-all hover:bg-gray-900 hover:text-white hover:border-gray-900 text-warm-brown"
                title={link.platform}
              >
                <SocialIcon platform={link.platform} />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
