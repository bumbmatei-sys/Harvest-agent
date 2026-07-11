// ─────────────────────────────────────────────
// HARVEST — Parse + normalize AI-generated lesson content (pure, server-safe)
//
// The Gemini video route asks for a STRICT JSON object; models still wrap it in
// fences, append prose, or drift on field names, so parsing is defensive and
// the shape is normalized before it ever reaches the client. Kept pure so it's
// unit tested without the route.
// ─────────────────────────────────────────────

export interface GenOutlineItem {
  title: string;
  text: string;
}

export interface GenQuizOption {
  text: string;
  correct: boolean;
}

export interface GenQuizQuestion {
  q: string;
  options: GenQuizOption[];
}

export interface GeneratedLessonContent {
  title: string;
  summary: string;
  outline: GenOutlineItem[];
  quiz: GenQuizQuestion[];
  /** REFERENCE ONLY, e.g. "John 1:14" — never verse text (copyright). */
  scripture: string;
  /** Longer plain-text recap, fed to AI Knowledge when the admin opts in. */
  videoSummary: string;
}

// The 66 canonical books (+ a couple of common alternates). Used to validate
// that a scripture value is a REFERENCE and to strip any trailing verse text.
const BIBLE_BOOKS: string[] = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Psalm', 'Proverbs', 'Ecclesiastes',
  'Song of Solomon', 'Song of Songs', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel',
  'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians',
  'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus',
  'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Book alternation, longest names first so "Song of Solomon" / "1 John" win
// over "Song" / "John". Built once at module load.
const BOOK_ALTERNATION = [...BIBLE_BOOKS]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');
const SCRIPTURE_RE = new RegExp(
  `\\b(${BOOK_ALTERNATION})\\.?\\s+(\\d{1,3})(?::(\\d{1,3})(?:\\s?[-–]\\s?(\\d{1,3}))?)?`,
  'i',
);

/**
 * Reduce a scripture value to a bare REFERENCE ("John 1:14", "1 Corinthians
 * 13:4-7", "Psalm 23") and NOTHING else. This is the copyright guardrail: if
 * the model appended the verse text, only the leading reference survives; if it
 * returned verse text with no recognizable reference, we return "" so no verse
 * text is ever stored or shown.
 */
export function sanitizeScriptureReference(input: string): string {
  const s = (input || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  const m = SCRIPTURE_RE.exec(s);
  if (!m) return '';

  // Re-emit from captured groups only — never the surrounding text.
  const canonical = BIBLE_BOOKS.find((b) => b.toLowerCase() === m[1].toLowerCase()) || m[1];
  let ref = `${canonical} ${m[2]}`;
  if (m[3]) {
    ref += `:${m[3]}`;
    if (m[4]) ref += `-${m[4]}`;
  }
  return ref;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Coerce a loosely-shaped parsed object into a clean GeneratedLessonContent.
 * Tolerates common field-name drift (description/summary, question/q,
 * body/content for outline text). Returns null only when the object carries no
 * usable content at all.
 */
export function normalizeLessonContent(obj: any): GeneratedLessonContent | null {
  if (!obj || typeof obj !== 'object') return null;

  const title = str(obj.title);
  const summary = str(obj.summary ?? obj.description);
  const videoSummary = str(obj.videoSummary ?? obj.transcript ?? obj.summary ?? obj.description);
  const scripture = sanitizeScriptureReference(str(obj.scripture ?? obj.scriptureReference));

  const outline: GenOutlineItem[] = Array.isArray(obj.outline)
    ? obj.outline
        .map((o: any) => ({
          title: str(o?.title ?? o?.heading ?? o?.point),
          text: str(o?.text ?? o?.body ?? o?.content ?? o?.description),
        }))
        .filter((o: GenOutlineItem) => o.title || o.text)
    : [];

  const quiz: GenQuizQuestion[] = Array.isArray(obj.quiz)
    ? obj.quiz
        .map((q: any) => {
          const options: GenQuizOption[] = Array.isArray(q?.options)
            ? q.options
                .map((op: any) => ({
                  text: str(typeof op === 'string' ? op : op?.text ?? op?.label),
                  correct: (typeof op === 'object' && op?.correct === true) || false,
                }))
                .filter((op: GenQuizOption) => op.text)
            : [];
          return { q: str(q?.q ?? q?.question), options };
        })
        .filter((q: GenQuizQuestion) => q.q && q.options.length >= 2)
    : [];

  // Enforce exactly one correct option per question (default to the first).
  for (const q of quiz) {
    let seenCorrect = false;
    for (const o of q.options) {
      if (o.correct && !seenCorrect) seenCorrect = true;
      else o.correct = false;
    }
    if (!seenCorrect && q.options.length) q.options[0].correct = true;
  }

  if (!title && !summary && outline.length === 0 && quiz.length === 0) return null;

  return { title, summary, outline, quiz, scripture, videoSummary };
}

/**
 * Defensively parse the model's raw text into GeneratedLessonContent. Strips
 * markdown fences, and if a straight JSON.parse fails, salvages the first
 * `{ … }` block. Returns null when nothing usable can be recovered so the route
 * can tell the admin to fill the lesson in manually.
 */
export function parseLessonGenerationJson(raw: string): GeneratedLessonContent | null {
  if (!raw || typeof raw !== 'string') return null;

  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let obj: any = null;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        obj = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        obj = null;
      }
    }
  }

  return normalizeLessonContent(obj);
}
