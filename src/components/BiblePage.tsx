import { useState, useEffect, useCallback, CSSProperties } from "react";

// ─────────────────────────────────────────────
// HARVEST — Bible Page (TypeScript)
// API: bible-api.com (no key, CORS enabled, public domain)
// Mobile-first, Harvest design system
// ─────────────────────────────────────────────

const GOLD = "#C9963A";
const GOLD_LIGHT = "var(--bible-gold-light)";
const GOLD_BTN = "var(--bible-gold-btn)";
const BG = "var(--bible-bg)";
const CARD = "var(--bible-card)";
const TEXT = "var(--bible-text)";
const TEXT2 = "var(--bible-text2)";
const BORDER = "var(--bible-border)";

// ── Types ──────────────────────────────────────
type Tab = "read" | "search";
type HighlightColor = "gold" | "green" | "blue" | "pink";

type Language = "English" | "Portuguese" | "Romanian" | "Maori" | "Cherokee";

const TRANSLATIONS_BY_LANGUAGE: Record<Language, { id: string, name: string }[]> = {
  English: [
    { id: "web", name: "WEB" },
    { id: "kjv", name: "KJV" },
    { id: "asv", name: "ASV" },
    { id: "ylt", name: "YLT" },
    { id: "darby", name: "DARBY" },
    { id: "webster", name: "WEBSTER" },
    { id: "bbe", name: "BBE" },
    { id: "oeb-us", name: "OEB-US" },
    { id: "oeb-cw", name: "OEB-CW" },
    { id: "webbe", name: "WEBBE" },
  ],
  Portuguese: [
    { id: "almeida", name: "Almeida" },
  ],
  Romanian: [
    { id: "rccv", name: "RCCV" },
  ],
  Maori: [
    { id: "maori", name: "Maori" },
  ],
  Cherokee: [
    { id: "cherokee", name: "Cherokee" },
  ]
};

const getTranslationName = (id: string) => {
  for (const lang of Object.values(TRANSLATIONS_BY_LANGUAGE)) {
    const found = lang.find(t => t.id === id);
    if (found) return found.name;
  }
  return id.toUpperCase();
};

interface ApiVerse {
  book_id: string;
  book_name: string;
  chapter: number;
  verse: number;
  text: string;
}

interface ApiResponse {
  reference: string;
  verses: ApiVerse[];
  text: string;
  translation_id: string;
  translation_name: string;
}

interface Verse {
  number: number;
  text: string;
}

interface VerseAction {
  verse: Verse;
  book: string;
  chapter: number;
}

interface BookMeta {
  name: string;
  id: string;
  chapters: number;
  testament: "OT" | "NT";
}

// ── Highlight colors ───────────────────────────
const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  gold: "var(--bible-hl-gold)",
  green: "var(--bible-hl-green)",
  blue: "var(--bible-hl-blue)",
  pink: "var(--bible-hl-pink)",
};

// ── Bible books ────────────────────────────────
const BOOKS: BookMeta[] = [
  { name: "Genesis", id: "genesis", chapters: 50, testament: "OT" },
  { name: "Exodus", id: "exodus", chapters: 40, testament: "OT" },
  { name: "Leviticus", id: "leviticus", chapters: 27, testament: "OT" },
  { name: "Numbers", id: "numbers", chapters: 36, testament: "OT" },
  { name: "Deuteronomy", id: "deuteronomy", chapters: 34, testament: "OT" },
  { name: "Joshua", id: "joshua", chapters: 24, testament: "OT" },
  { name: "Judges", id: "judges", chapters: 21, testament: "OT" },
  { name: "Ruth", id: "ruth", chapters: 4, testament: "OT" },
  { name: "1 Samuel", id: "1+samuel", chapters: 31, testament: "OT" },
  { name: "2 Samuel", id: "2+samuel", chapters: 24, testament: "OT" },
  { name: "1 Kings", id: "1+kings", chapters: 22, testament: "OT" },
  { name: "2 Kings", id: "2+kings", chapters: 25, testament: "OT" },
  { name: "1 Chronicles", id: "1+chronicles", chapters: 29, testament: "OT" },
  { name: "2 Chronicles", id: "2+chronicles", chapters: 36, testament: "OT" },
  { name: "Ezra", id: "ezra", chapters: 10, testament: "OT" },
  { name: "Nehemiah", id: "nehemiah", chapters: 13, testament: "OT" },
  { name: "Esther", id: "esther", chapters: 10, testament: "OT" },
  { name: "Job", id: "job", chapters: 42, testament: "OT" },
  { name: "Psalms", id: "psalms", chapters: 150, testament: "OT" },
  { name: "Proverbs", id: "proverbs", chapters: 31, testament: "OT" },
  { name: "Ecclesiastes", id: "ecclesiastes", chapters: 12, testament: "OT" },
  { name: "Song of Solomon", id: "song+of+solomon", chapters: 8, testament: "OT" },
  { name: "Isaiah", id: "isaiah", chapters: 66, testament: "OT" },
  { name: "Jeremiah", id: "jeremiah", chapters: 52, testament: "OT" },
  { name: "Lamentations", id: "lamentations", chapters: 5, testament: "OT" },
  { name: "Ezekiel", id: "ezekiel", chapters: 48, testament: "OT" },
  { name: "Daniel", id: "daniel", chapters: 12, testament: "OT" },
  { name: "Hosea", id: "hosea", chapters: 14, testament: "OT" },
  { name: "Joel", id: "joel", chapters: 3, testament: "OT" },
  { name: "Amos", id: "amos", chapters: 9, testament: "OT" },
  { name: "Jonah", id: "jonah", chapters: 4, testament: "OT" },
  { name: "Micah", id: "micah", chapters: 7, testament: "OT" },
  { name: "Zechariah", id: "zechariah", chapters: 14, testament: "OT" },
  { name: "Malachi", id: "malachi", chapters: 4, testament: "OT" },
  { name: "Matthew", id: "matthew", chapters: 28, testament: "NT" },
  { name: "Mark", id: "mark", chapters: 16, testament: "NT" },
  { name: "Luke", id: "luke", chapters: 24, testament: "NT" },
  { name: "John", id: "john", chapters: 21, testament: "NT" },
  { name: "Acts", id: "acts", chapters: 28, testament: "NT" },
  { name: "Romans", id: "romans", chapters: 16, testament: "NT" },
  { name: "1 Corinthians", id: "1+corinthians", chapters: 16, testament: "NT" },
  { name: "2 Corinthians", id: "2+corinthians", chapters: 13, testament: "NT" },
  { name: "Galatians", id: "galatians", chapters: 6, testament: "NT" },
  { name: "Ephesians", id: "ephesians", chapters: 6, testament: "NT" },
  { name: "Philippians", id: "philippians", chapters: 4, testament: "NT" },
  { name: "Colossians", id: "colossians", chapters: 4, testament: "NT" },
  { name: "1 Thessalonians", id: "1+thessalonians", chapters: 5, testament: "NT" },
  { name: "2 Thessalonians", id: "2+thessalonians", chapters: 3, testament: "NT" },
  { name: "1 Timothy", id: "1+timothy", chapters: 6, testament: "NT" },
  { name: "2 Timothy", id: "2+timothy", chapters: 4, testament: "NT" },
  { name: "Titus", id: "titus", chapters: 3, testament: "NT" },
  { name: "Philemon", id: "philemon", chapters: 1, testament: "NT" },
  { name: "Hebrews", id: "hebrews", chapters: 13, testament: "NT" },
  { name: "James", id: "james", chapters: 5, testament: "NT" },
  { name: "1 Peter", id: "1+peter", chapters: 5, testament: "NT" },
  { name: "2 Peter", id: "2+peter", chapters: 3, testament: "NT" },
  { name: "1 John", id: "1+john", chapters: 5, testament: "NT" },
  { name: "2 John", id: "2+john", chapters: 1, testament: "NT" },
  { name: "3 John", id: "3+john", chapters: 1, testament: "NT" },
  { name: "Jude", id: "jude", chapters: 1, testament: "NT" },
  { name: "Revelation", id: "revelation", chapters: 22, testament: "NT" },
];

// ── API call — bible-api.com ───────────────────
// URL format: https://bible-api.com/{book}+{chapter}?translation={trans}
const fetchChapter = async (
  bookId: string,
  chapter: number,
  translation: string
): Promise<Verse[]> => {
  const url = `https://bible-api.com/${bookId}+${chapter}?translation=${translation}`;
  const res = await fetch(url);
  if (!res.ok) {
    let msg = "Failed to fetch chapter";
    try {
      const errData = await res.json();
      if (errData.error) msg = errData.error;
    } catch (e) {}
    throw new Error(msg);
  }
  const data: ApiResponse = await res.json();
  return data.verses.map((v) => ({ number: v.verse, text: v.text.trim() }));
};

// URL format for search: https://bible-api.com/{reference}?translation={trans}
const fetchSearch = async (
  query: string,
  translation: string
): Promise<{ ref: string; text: string }[]> => {
  const encoded = encodeURIComponent(query.trim());
  const url = `https://bible-api.com/${encoded}?translation=${translation}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data: ApiResponse = await res.json();
  return data.verses.map((v) => ({
    ref: `${v.book_name} ${v.chapter}:${v.verse}`,
    text: v.text.trim(),
  }));
};

// ═══════════════════════════════════════════════
// BOOK PICKER
// ═══════════════════════════════════════════════
interface BookPickerProps {
  currentBook: BookMeta;
  currentChapter: number;
  onSelect: (book: BookMeta, chapter: number) => void;
  onClose: () => void;
}

function BookPicker({ currentBook, currentChapter, onSelect, onClose }: BookPickerProps) {
  const [search, setSearch] = useState("");
  const [selectedBook, setSelectedBook] = useState<BookMeta | null>(currentBook);

  const filtered = BOOKS.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );
  const ot = filtered.filter((b) => b.testament === "OT");
  const nt = filtered.filter((b) => b.testament === "NT");

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", background: CARD, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: GOLD, fontSize: 22, cursor: "pointer", padding: 0 }}>←</button>
        <span style={{ fontWeight: 800, fontSize: 16, color: TEXT, flex: 1 }}>
          {selectedBook ? `${selectedBook.name}` : "Choose a Book"}
        </span>
        {selectedBook && (
          <button onClick={() => setSelectedBook(null)}
            style={{ background: "none", border: "none", color: GOLD, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
            All Books
          </button>
        )}
      </div>

      {!selectedBook && (
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: BG, borderRadius: 99, border: `1.5px solid ${BORDER}`, padding: "8px 14px" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={TEXT2} strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search books..."
              style={{ flex: 1, border: "none", background: "transparent", fontSize: 14, fontFamily: "inherit", color: TEXT, outline: "none" }} />
          </div>
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1 }}>
        {!selectedBook && (
          <>
            {[{ label: "Old Testament", books: ot }, { label: "New Testament", books: nt }].map(({ label, books }) =>
              books.length > 0 ? (
                <div key={label}>
                  <div style={{ padding: "10px 16px 6px", fontSize: 10, fontWeight: 700, color: TEXT2, letterSpacing: "0.1em", textTransform: "uppercase" as const }}>{label}</div>
                  {books.map((book) => (
                    <div key={book.id} onClick={() => setSelectedBook(book)}
                      style={{ padding: "13px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: book.id === currentBook.id ? GOLD_LIGHT : "transparent" }}>
                      <span style={{ fontSize: 15, fontWeight: book.id === currentBook.id ? 700 : 500, color: book.id === currentBook.id ? GOLD : TEXT }}>{book.name}</span>
                      <span style={{ fontSize: 12, color: TEXT2 }}>{book.chapters} ch</span>
                    </div>
                  ))}
                </div>
              ) : null
            )}
          </>
        )}

        {selectedBook && (
          <div style={{ padding: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
              {Array.from({ length: selectedBook.chapters }, (_, i) => i + 1).map((ch) => {
                const active = selectedBook.id === currentBook.id && ch === currentChapter;
                return (
                  <button key={ch} onClick={() => { onSelect(selectedBook, ch); onClose(); }}
                    style={{ aspectRatio: "1", border: `1.5px solid ${active ? GOLD : BORDER}`, background: active ? GOLD_BTN : CARD, color: active ? "var(--bible-active-text)" : TEXT, fontWeight: active ? 800 : 600, fontSize: 15, borderRadius: 12, cursor: "pointer", fontFamily: "inherit", boxShadow: active ? "0 2px 8px rgba(201,150,58,0.3)" : "none", transition: "all 0.15s" }}>
                    {ch}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// VERSE ACTION SHEET
// ═══════════════════════════════════════════════
interface VerseActionSheetProps {
  verseAction: VerseAction;
  highlighted: Map<string, HighlightColor>;
  bookmarked: Set<string>;
  onHighlight: (key: string, color: HighlightColor) => void;
  onRemoveHighlight: (key: string) => void;
  onBookmark: (key: string) => void;
  onCopy: (text: string, ref: string) => void;
  onShare: (text: string, ref: string) => void;
  onClose: () => void;
}

function VerseActionSheet({
  verseAction, highlighted, bookmarked,
  onHighlight, onRemoveHighlight, onBookmark, onCopy, onShare, onClose,
}: VerseActionSheetProps) {
  const { verse, book, chapter } = verseAction;
  const key = `${book}-${chapter}-${verse.number}`;
  const ref = `${book} ${chapter}:${verse.number}`;
  const isBookmarked = bookmarked.has(key);
  const currentHighlight = highlighted.get(key);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 70 }} />
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: CARD, borderRadius: "20px 20px 0 0", zIndex: 80, boxShadow: "0 -8px 32px rgba(0,0,0,0.15)" }}>
        <div style={{ padding: "10px 0 0", display: "flex", justifyContent: "center" }}>
          <div style={{ width: 36, height: 4, background: BORDER, borderRadius: 99 }} />
        </div>
        <div style={{ padding: "12px 20px 14px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: GOLD, letterSpacing: "0.08em", textTransform: "uppercase" as const, marginBottom: 4 }}>{ref}</div>
          <div style={{ fontSize: 14, color: TEXT2, lineHeight: 1.65 }}>{verse.text}</div>
        </div>

        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: TEXT2, letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 10 }}>Highlight</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {(Object.entries(HIGHLIGHT_COLORS) as [HighlightColor, string][]).map(([color, hex]) => (
              <button key={color} onClick={() => currentHighlight === color ? onRemoveHighlight(key) : onHighlight(key, color)}
                style={{ width: 32, height: 32, borderRadius: "50%", background: hex, border: `2.5px solid ${currentHighlight === color ? GOLD : "transparent"}`, cursor: "pointer", transition: "transform 0.15s", transform: currentHighlight === color ? "scale(1.2)" : "scale(1)" }} />
            ))}
            {currentHighlight && (
              <button onClick={() => onRemoveHighlight(key)}
                style={{ fontSize: 11, color: TEXT2, background: "none", border: `1px solid ${BORDER}`, borderRadius: 99, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                Remove
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "14px 16px 32px", gap: 10 }}>
          {[
            { label: isBookmarked ? "Saved" : "Bookmark", icon: "🔖", active: isBookmarked, action: () => onBookmark(key) },
            { label: "Copy", icon: "📋", active: false, action: () => onCopy(verse.text, ref) },
            { label: "Share", icon: "↗", active: false, action: () => onShare(verse.text, ref) },
          ].map((a) => (
            <button key={a.label} onClick={() => { a.action(); onClose(); }}
              style={{ background: a.active ? GOLD_LIGHT : BG, border: `1.5px solid ${a.active ? GOLD : BORDER}`, borderRadius: 12, padding: "12px 8px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, fontFamily: "inherit" }}>
              <span style={{ fontSize: 20 }}>{a.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: a.active ? GOLD : TEXT2 }}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════
// MAIN BIBLE PAGE
// ═══════════════════════════════════════════════
export default function BiblePage() {
  const [tab, setTab] = useState<Tab>("read");
  const [translation, setTranslation] = useState<string>("web");
  const [book, setBook] = useState<BookMeta>(BOOKS.find((b) => b.id === "john")!);
  const [chapter, setChapter] = useState(3);
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showTranslations, setShowTranslations] = useState(false);
  const [highlighted, setHighlighted] = useState<Map<string, HighlightColor>>(new Map());
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set());
  const [activeVerse, setActiveVerse] = useState<VerseAction | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ ref: string; text: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(17);

  // Fetch chapter
  const loadChapter = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchChapter(book.id, chapter, translation);
      setVerses(data);
    } catch (err: any) {
      setError(err.message || "Could not load chapter. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [book, chapter, translation]);

  useEffect(() => { loadChapter(); }, [loadChapter]);

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      const results = await fetchSearch(searchQuery, translation);
      setSearchResults(results);
      setSearching(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [searchQuery, translation]);

  const showToast = (msg: string): void => {
    setToast(msg); setTimeout(() => setToast(null), 2000);
  };

  const handleHighlight = (key: string, color: HighlightColor): void =>
    setHighlighted((prev) => new Map(prev).set(key, color));

  const handleRemoveHighlight = (key: string): void =>
    setHighlighted((prev) => { const next = new Map(prev); next.delete(key); return next; });

  const handleBookmark = (key: string): void => {
    const wasBookmarked = bookmarked.has(key);
    setBookmarked((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
    showToast(wasBookmarked ? "Bookmark removed" : "Verse bookmarked 🔖");
  };

  const handleCopy = (text: string, ref: string): void => {
    navigator.clipboard?.writeText(`"${text}" — ${ref} (${getTranslationName(translation)})`);
    showToast("Verse copied 📋");
  };

  const handleShare = async (text: string, ref: string): Promise<void> => {
    if (navigator.share) {
      try {
        await navigator.share({ text: `"${text}" — ${ref} (${getTranslationName(translation)})` });
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          handleCopy(text, ref);
        }
      }
    } else {
      handleCopy(text, ref);
    }
  };

  const goToChapter = (delta: number): void => {
    const next = chapter + delta;
    if (next < 1 || next > book.chapters) return;
    setChapter(next);
    window.scrollTo(0, 0);
  };

  return (
    <div style={pageStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&family=Crimson+Pro:ital,wght@0,400;0,600;1,400&display=swap');
        :root {
          --bible-bg: #F2F4F7;
          --bible-card: #FFFFFF;
          --bible-text: #111111;
          --bible-text2: #6B7280;
          --bible-border: #E8E8E8;
          --bible-gold-light: #FBF3E4;
          --bible-gold-btn: linear-gradient(135deg, #C9963A, #D4A843);
          --bible-error-bg: #FFF5F5;
          --bible-error-border: #FED7D7;
          --bible-error-text: #C53030;
          --bible-toast-text: #FFFFFF;
          --bible-active-text: #FFFFFF;
          --bible-hl-gold: #FEF08A;
          --bible-hl-green: #BBF7D0;
          --bible-hl-blue: #BFDBFE;
          --bible-hl-pink: #FBCFE8;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --bible-bg: #111827;
            --bible-card: #1F2937;
            --bible-text: #F9FAFB;
            --bible-text2: #9CA3AF;
            --bible-border: #374151;
            --bible-gold-light: #422f09;
            --bible-gold-btn: linear-gradient(135deg, #B48533, #C0983C);
            --bible-error-bg: #450a0a;
            --bible-error-border: #7f1d1d;
            --bible-error-text: #fecaca;
            --bible-toast-text: #111827;
            --bible-active-text: #FFFFFF;
            --bible-hl-gold: #854d0e;
            --bible-hl-green: #166534;
            --bible-hl-blue: #1e40af;
            --bible-hl-pink: #9d174d;
          }
        }
        .dark {
          --bible-bg: #111827;
          --bible-card: #1F2937;
          --bible-text: #F9FAFB;
          --bible-text2: #9CA3AF;
          --bible-border: #374151;
          --bible-gold-light: #422f09;
          --bible-gold-btn: linear-gradient(135deg, #B48533, #C0983C);
          --bible-error-bg: #450a0a;
          --bible-error-border: #7f1d1d;
          --bible-error-text: #fecaca;
          --bible-toast-text: #111827;
          --bible-active-text: #FFFFFF;
          --bible-hl-gold: #854d0e;
          --bible-hl-green: #166534;
          --bible-hl-blue: #1e40af;
          --bible-hl-pink: #9d174d;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input { outline: none; }
        ::-webkit-scrollbar { width: 0; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
      `}</style>

      {showPicker && (
        <BookPicker currentBook={book} currentChapter={chapter}
          onSelect={(b, ch) => { setBook(b); setChapter(ch); }}
          onClose={() => setShowPicker(false)} />
      )}

      {activeVerse && (
        <VerseActionSheet verseAction={activeVerse} highlighted={highlighted} bookmarked={bookmarked}
          onHighlight={handleHighlight} onRemoveHighlight={handleRemoveHighlight}
          onBookmark={handleBookmark} onCopy={handleCopy} onShare={handleShare}
          onClose={() => setActiveVerse(null)} />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)", background: TEXT, color: "var(--bible-toast-text)", borderRadius: 99, padding: "8px 18px", fontSize: 13, fontWeight: 600, zIndex: 99, whiteSpace: "nowrap" as const, animation: "toastIn 0.25s ease" }}>
          {toast}
        </div>
      )}

      {/* ── TOP BAR ── */}
      <div style={{ background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "12px 16px", flexShrink: 0, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          {/* Back */}
          <button style={{ background: "none", border: "none", color: GOLD, fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1 }}>←</button>

          {/* Book + Chapter picker trigger */}
          <button onClick={() => setShowPicker(true)}
            style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontWeight: 800, fontSize: 16, color: TEXT }}>{book.name} {chapter}</span>
            <span style={{ color: TEXT2, fontSize: 12 }}>▼</span>
          </button>

          {/* Translation picker */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowTranslations((v) => !v)}
              style={{ background: GOLD_LIGHT, border: `1.5px solid ${GOLD}33`, borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12, color: GOLD }}>
              {getTranslationName(translation)} ▾
            </button>
            {showTranslations && (
              <>
                <div onClick={() => setShowTranslations(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
                <div style={{ position: "absolute", top: 36, right: 0, background: CARD, borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: `1px solid ${BORDER}`, zIndex: 40, overflowY: "auto", maxHeight: "60vh", minWidth: 160 }}>
                  {(Object.entries(TRANSLATIONS_BY_LANGUAGE) as [Language, {id: string, name: string}[]][]).map(([lang, transList]) => (
                    <div key={lang}>
                      <div style={{ padding: "8px 16px", fontSize: 10, fontWeight: 700, color: TEXT2, letterSpacing: "0.1em", textTransform: "uppercase", background: BG }}>
                        {lang}
                      </div>
                      {transList.map((t) => (
                        <div key={t.id} onClick={() => { setTranslation(t.id); setShowTranslations(false); }}
                          style={{ padding: "11px 16px", cursor: "pointer", fontWeight: t.id === translation ? 800 : 500, color: t.id === translation ? GOLD : TEXT, background: t.id === translation ? GOLD_LIGHT : "transparent", fontSize: 14, borderBottom: `1px solid ${BORDER}` }}>
                          {t.name}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}`, marginInline: -16, paddingInline: 16 }}>
          {(["read", "search"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, background: "none", border: "none", borderBottom: `2.5px solid ${tab === t ? GOLD : "transparent"}`, color: tab === t ? GOLD : TEXT2, fontWeight: 700, fontSize: 14, padding: "8px", cursor: "pointer", fontFamily: "inherit" }}>
              {t === "read" ? "📖 Read" : "🔍 Search"}
            </button>
          ))}
        </div>
      </div>

      {/* ── READ TAB ── */}
      {tab === "read" && (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {/* Font controls */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setFontSize((s) => Math.max(13, s - 2))}
                style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 12, fontWeight: 700, color: TEXT2, display: "flex", alignItems: "center", justifyContent: "center" }}>A-</button>
              <button onClick={() => setFontSize((s) => Math.min(26, s + 2))}
                style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 16, fontWeight: 700, color: TEXT2, display: "flex", alignItems: "center", justifyContent: "center" }}>A+</button>
            </div>
            <span style={{ fontSize: 11, color: TEXT2 }}>Tap a verse for options</span>
          </div>

          {/* Loading */}
          {loading && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
              <div style={{ width: 32, height: 32, border: `3px solid ${GOLD_LIGHT}`, borderTopColor: GOLD, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div style={{ margin: 20, background: "var(--bible-error-bg)", border: "1px solid var(--bible-error-border)", borderRadius: 14, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
              <div style={{ fontSize: 14, color: "var(--bible-error-text)", fontWeight: 600, marginBottom: 10 }}>{error}</div>
              <button onClick={loadChapter} style={{ background: GOLD_BTN, border: "none", color: "var(--bible-active-text)", fontWeight: 700, padding: "8px 20px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit" }}>Try Again</button>
            </div>
          )}

          {/* Verses */}
          {!loading && !error && (
            <div style={{ padding: "12px 16px 8px", flex: 1 }}>
              {verses.map((verse) => {
                const key = `${book.name}-${chapter}-${verse.number}`;
                const hlColor = highlighted.get(key);
                const isBookmarkedVerse = bookmarked.has(key);
                return (
                  <div key={verse.number} onClick={() => setActiveVerse({ verse, book: book.name, chapter })}
                    style={{ display: "flex", gap: 10, marginBottom: 14, cursor: "pointer", borderRadius: 10, padding: "6px 8px", background: hlColor ? HIGHLIGHT_COLORS[hlColor] : "transparent", transition: "background 0.2s", position: "relative" as const }}>
                    {isBookmarkedVerse && (
                      <div style={{ position: "absolute" as const, top: 4, right: 8, fontSize: 11 }}>🔖</div>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 800, color: GOLD, minWidth: 22, paddingTop: 3, flexShrink: 0 }}>{verse.number}</span>
                    <span style={{ fontSize: fontSize, fontFamily: "'Crimson Pro', Georgia, serif", color: TEXT, lineHeight: 1.8 }}>{verse.text}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Chapter navigation */}
          {!loading && !error && (
            <div style={{ display: "flex", gap: 10, padding: "8px 16px 32px", flexShrink: 0 }}>
              <button onClick={() => goToChapter(-1)} disabled={chapter === 1}
                style={{ flex: 1, background: CARD, border: `1.5px solid ${BORDER}`, borderRadius: 12, padding: "13px", cursor: chapter > 1 ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 700, fontSize: 14, color: chapter > 1 ? TEXT : TEXT2, opacity: chapter === 1 ? 0.4 : 1 }}>
                ← Chapter {chapter - 1}
              </button>
              <button onClick={() => goToChapter(1)} disabled={chapter === book.chapters}
                style={{ flex: 1, background: chapter < book.chapters ? GOLD_LIGHT : CARD, border: `1.5px solid ${chapter < book.chapters ? GOLD : BORDER}`, borderRadius: 12, padding: "13px", cursor: chapter < book.chapters ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 700, fontSize: 14, color: chapter < book.chapters ? GOLD : TEXT2, opacity: chapter === book.chapters ? 0.4 : 1 }}>
                Chapter {chapter + 1} →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── SEARCH TAB ── */}
      {tab === "search" && (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 16px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: CARD, borderRadius: 99, border: `1.5px solid ${BORDER}`, padding: "10px 16px" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={TEXT2} strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='Try "John 3:16" or "love"...'
                autoFocus
                style={{ flex: 1, border: "none", background: "transparent", fontSize: 14, fontFamily: "inherit", color: TEXT }} />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(""); setSearchResults([]); }}
                  style={{ background: "none", border: "none", color: TEXT2, cursor: "pointer", fontSize: 14 }}>✕</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: TEXT2, marginTop: 6, textAlign: "center" as const }}>
              Powered by bible-api.com · {getTranslationName(translation)}
            </div>
          </div>

          <div style={{ flex: 1, padding: "0 16px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
            {!searchQuery && (
              <div style={{ textAlign: "center" as const, padding: "40px 20px", color: TEXT2 }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📖</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Search the Scriptures</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>Type a verse reference or keyword</div>
              </div>
            )}

            {searching && (
              <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
                <div style={{ width: 24, height: 24, border: `3px solid ${GOLD_LIGHT}`, borderTopColor: GOLD, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              </div>
            )}

            {!searching && searchQuery && searchResults.length === 0 && (
              <div style={{ textAlign: "center" as const, padding: "32px 20px", color: TEXT2, fontSize: 14 }}>
                No results. Try a verse reference like &quot;Romans 8:28&quot;.
              </div>
            )}

            {searchResults.map((result, i) => (
              <div key={i}
                onClick={() => {
                  const parts = result.ref.split(" ");
                  const chVerse = parts[parts.length - 1].split(":");
                  const ch = parseInt(chVerse[0]);
                  const bookName = parts.slice(0, parts.length - 1).join(" ");
                  const found = BOOKS.find((b) => b.name.toLowerCase() === bookName.toLowerCase());
                  if (found) { setBook(found); setChapter(ch); setTab("read"); }
                }}
                style={{ background: CARD, borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 6px rgba(0,0,0,0.06)", cursor: "pointer", border: `1.5px solid ${BORDER}`, animation: "fadeUp 0.2s ease" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: GOLD, marginBottom: 6, letterSpacing: "0.04em" }}>{result.ref} · {getTranslationName(translation)}</div>
                <div style={{ fontSize: fontSize, fontFamily: "'Crimson Pro', Georgia, serif", color: TEXT, lineHeight: 1.75 }}>{result.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const pageStyle: CSSProperties = {
  fontFamily: "'Nunito', sans-serif",
  background: BG,
  height: "100vh",
  maxWidth: 480,
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  position: "relative",
};
