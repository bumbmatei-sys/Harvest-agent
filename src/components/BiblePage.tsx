"use client";
import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────
// HARVEST — Bible Page
// API: bible-api.com (no key, CORS enabled)
// Tailwind CSS, Inter + Crimson Pro
// ─────────────────────────────────────────────

const GOLD = "var(--brand-color, #C9963A)";
const GOLD_LIGHT = "color-mix(in srgb, var(--brand-color, #C9963A) 12%, white)";

// ── Types ──────────────────────────────────────
type Tab = "read" | "search";
type HighlightColor = "gold" | "green" | "blue" | "pink";
type Language = "English" | "Portuguese" | "Romanian" | "Maori" | "Cherokee";

const TRANSLATIONS_BY_LANGUAGE: Record<Language, { id: string; name: string }[]> = {
  English: [
    { id: "web", name: "WEB" }, { id: "kjv", name: "KJV" }, { id: "asv", name: "ASV" },
    { id: "ylt", name: "YLT" }, { id: "darby", name: "DARBY" }, { id: "webster", name: "WEBSTER" },
    { id: "bbe", name: "BBE" }, { id: "oeb-us", name: "OEB-US" }, { id: "oeb-cw", name: "OEB-CW" },
    { id: "webbe", name: "WEBBE" },
  ],
  Portuguese: [{ id: "almeida", name: "Almeida" }],
  Romanian: [{ id: "rccv", name: "RCCV" }],
  Maori: [{ id: "maori", name: "Maori" }],
  Cherokee: [{ id: "cherokee", name: "Cherokee" }],
};

const getTranslationName = (id: string) => {
  for (const lang of Object.values(TRANSLATIONS_BY_LANGUAGE)) {
    const found = lang.find((t) => t.id === id);
    if (found) return found.name;
  }
  return id.toUpperCase();
};

interface ApiVerse { book_id: string; book_name: string; chapter: number; verse: number; text: string; }
interface ApiResponse { reference: string; verses: ApiVerse[]; text: string; translation_id: string; translation_name: string; }
interface Verse { number: number; text: string; }
interface VerseAction { verse: Verse; book: string; chapter: number; }
interface BookMeta { name: string; id: string; chapters: number; testament: "OT" | "NT"; }

// ── Highlight colors ───────────────────────────
const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  gold: "#FEF08A", green: "#BBF7D0", blue: "#BFDBFE", pink: "#FBCFE8",
};

// ── Highlight persistence ──────────────────────
const HL_KEY = "harvest-bible-highlights";
function loadHighlights(): Map<string, HighlightColor> {
  try { const raw = localStorage.getItem(HL_KEY); if (raw) return new Map(Object.entries(JSON.parse(raw))); } catch {}
  return new Map();
}
function saveHighlights(map: Map<string, HighlightColor>): void {
  try { const obj: Record<string, HighlightColor> = {}; map.forEach((v, k) => { obj[k] = v; }); localStorage.setItem(HL_KEY, JSON.stringify(obj)); } catch {}
}

// ── Bible books ────────────────────────────────
const BOOKS: BookMeta[] = [
  { name: "Genesis", id: "genesis", chapters: 50, testament: "OT" }, { name: "Exodus", id: "exodus", chapters: 40, testament: "OT" },
  { name: "Leviticus", id: "leviticus", chapters: 27, testament: "OT" }, { name: "Numbers", id: "numbers", chapters: 36, testament: "OT" },
  { name: "Deuteronomy", id: "deuteronomy", chapters: 34, testament: "OT" }, { name: "Joshua", id: "joshua", chapters: 24, testament: "OT" },
  { name: "Judges", id: "judges", chapters: 21, testament: "OT" }, { name: "Ruth", id: "ruth", chapters: 4, testament: "OT" },
  { name: "1 Samuel", id: "1+samuel", chapters: 31, testament: "OT" }, { name: "2 Samuel", id: "2+samuel", chapters: 24, testament: "OT" },
  { name: "1 Kings", id: "1+kings", chapters: 22, testament: "OT" }, { name: "2 Kings", id: "2+kings", chapters: 25, testament: "OT" },
  { name: "1 Chronicles", id: "1+chronicles", chapters: 29, testament: "OT" }, { name: "2 Chronicles", id: "2+chronicles", chapters: 36, testament: "OT" },
  { name: "Ezra", id: "ezra", chapters: 10, testament: "OT" }, { name: "Nehemiah", id: "nehemiah", chapters: 13, testament: "OT" },
  { name: "Esther", id: "esther", chapters: 10, testament: "OT" }, { name: "Job", id: "job", chapters: 42, testament: "OT" },
  { name: "Psalms", id: "psalms", chapters: 150, testament: "OT" }, { name: "Proverbs", id: "proverbs", chapters: 31, testament: "OT" },
  { name: "Ecclesiastes", id: "ecclesiastes", chapters: 12, testament: "OT" }, { name: "Song of Solomon", id: "song+of+solomon", chapters: 8, testament: "OT" },
  { name: "Isaiah", id: "isaiah", chapters: 66, testament: "OT" }, { name: "Jeremiah", id: "jeremiah", chapters: 52, testament: "OT" },
  { name: "Lamentations", id: "lamentations", chapters: 5, testament: "OT" }, { name: "Ezekiel", id: "ezekiel", chapters: 48, testament: "OT" },
  { name: "Daniel", id: "daniel", chapters: 12, testament: "OT" }, { name: "Hosea", id: "hosea", chapters: 14, testament: "OT" },
  { name: "Joel", id: "joel", chapters: 3, testament: "OT" }, { name: "Amos", id: "amos", chapters: 9, testament: "OT" },
  { name: "Obadiah", id: "obadiah", chapters: 1, testament: "OT" }, { name: "Jonah", id: "jonah", chapters: 4, testament: "OT" },
  { name: "Micah", id: "micah", chapters: 7, testament: "OT" }, { name: "Nahum", id: "nahum", chapters: 3, testament: "OT" },
  { name: "Habakkuk", id: "habakkuk", chapters: 3, testament: "OT" }, { name: "Zephaniah", id: "zephaniah", chapters: 3, testament: "OT" },
  { name: "Haggai", id: "haggai", chapters: 2, testament: "OT" }, { name: "Zechariah", id: "zechariah", chapters: 14, testament: "OT" },
  { name: "Malachi", id: "malachi", chapters: 4, testament: "OT" },
  { name: "Matthew", id: "matthew", chapters: 28, testament: "NT" }, { name: "Mark", id: "mark", chapters: 16, testament: "NT" },
  { name: "Luke", id: "luke", chapters: 24, testament: "NT" }, { name: "John", id: "john", chapters: 21, testament: "NT" },
  { name: "Acts", id: "acts", chapters: 28, testament: "NT" }, { name: "Romans", id: "romans", chapters: 16, testament: "NT" },
  { name: "1 Corinthians", id: "1+corinthians", chapters: 16, testament: "NT" }, { name: "2 Corinthians", id: "2+corinthians", chapters: 13, testament: "NT" },
  { name: "Galatians", id: "galatians", chapters: 6, testament: "NT" }, { name: "Ephesians", id: "ephesians", chapters: 6, testament: "NT" },
  { name: "Philippians", id: "philippians", chapters: 4, testament: "NT" }, { name: "Colossians", id: "colossians", chapters: 4, testament: "NT" },
  { name: "1 Thessalonians", id: "1+thessalonians", chapters: 5, testament: "NT" }, { name: "2 Thessalonians", id: "2+thessalonians", chapters: 3, testament: "NT" },
  { name: "1 Timothy", id: "1+timothy", chapters: 6, testament: "NT" }, { name: "2 Timothy", id: "2+timothy", chapters: 4, testament: "NT" },
  { name: "Titus", id: "titus", chapters: 3, testament: "NT" }, { name: "Philemon", id: "philemon", chapters: 1, testament: "NT" },
  { name: "Hebrews", id: "hebrews", chapters: 13, testament: "NT" }, { name: "James", id: "james", chapters: 5, testament: "NT" },
  { name: "1 Peter", id: "1+peter", chapters: 5, testament: "NT" }, { name: "2 Peter", id: "2+peter", chapters: 3, testament: "NT" },
  { name: "1 John", id: "1+john", chapters: 5, testament: "NT" }, { name: "2 John", id: "2+john", chapters: 1, testament: "NT" },
  { name: "3 John", id: "3+john", chapters: 1, testament: "NT" }, { name: "Jude", id: "jude", chapters: 1, testament: "NT" },
  { name: "Revelation", id: "revelation", chapters: 22, testament: "NT" },
];

// ── API ────────────────────────────────────────
const fetchChapter = async (bookId: string, chapter: number, translation: string): Promise<Verse[]> => {
  const res = await fetch(`https://bible-api.com/${bookId}+${chapter}?translation=${translation}`);
  if (!res.ok) { let msg = "Failed to fetch chapter"; try { const e = await res.json(); if (e.error) msg = e.error; } catch {} throw new Error(msg); }
  const data: ApiResponse = await res.json();
  return data.verses.map((v) => ({ number: v.verse, text: v.text.trim() }));
};

const fetchSearch = async (query: string, translation: string): Promise<{ ref: string; text: string }[]> => {
  const res = await fetch(`https://bible-api.com/${encodeURIComponent(query.trim())}?translation=${translation}`);
  if (!res.ok) return [];
  const data: ApiResponse = await res.json();
  return data.verses.map((v) => ({ ref: `${v.book_name} ${v.chapter}:${v.verse}`, text: v.text.trim() }));
};

// ═══════════════════════════════════════════════
// BOOK PICKER
// ═══════════════════════════════════════════════
function BookPicker({ currentBook, currentChapter, onSelect, onClose }: { currentBook: BookMeta; currentChapter: number; onSelect: (b: BookMeta, ch: number) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [selectedBook, setSelectedBook] = useState<BookMeta | null>(currentBook);
  const filtered = BOOKS.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()));
  const ot = filtered.filter((b) => b.testament === "OT");
  const nt = filtered.filter((b) => b.testament === "NT");

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white max-w-[480px] mx-auto">
      <div className="px-4 py-3.5 border-b border-stone-200 flex items-center gap-3 flex-shrink-0">
        <button onClick={onClose} className="text-amber-600 p-0 bg-transparent border-none cursor-pointer">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <span className="font-extrabold text-base flex-1 font-display">{selectedBook ? selectedBook.name : "Choose a Book"}</span>
        {selectedBook && (
          <button onClick={() => setSelectedBook(null)} className="text-amber-600 text-xs font-bold bg-transparent border-none cursor-pointer">All Books</button>
        )}
      </div>

      {!selectedBook && (
        <div className="px-4 py-2.5 border-b border-stone-200 flex-shrink-0">
          <div className="flex items-center gap-2 bg-stone-100 rounded-full border-[1.5px] border-stone-200 px-3.5 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B7355" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search books..." className="flex-1 border-none bg-transparent text-sm outline-none text-earth" />
          </div>
        </div>
      )}

      <div className="overflow-y-auto flex-1">
        {!selectedBook && (
          <>
            {[
              { label: "Old Testament", books: ot },
              { label: "New Testament", books: nt },
            ].map(({ label, books }) =>
              books.length > 0 ? (
                <div key={label}>
                  <div className="px-4 pt-3 pb-1.5 text-[10px] font-bold text-[color:var(--text-faint)] tracking-widest uppercase">{label}</div>
                  {books.map((book) => (
                    <div
                      key={book.id}
                      onClick={() => setSelectedBook(book)}
                      className={`px-4 py-3.5 border-b border-gray-50 flex justify-between items-center cursor-pointer transition-colors ${
                        book.id === currentBook.id ? "bg-amber-50" : "hover:bg-stone-100"
                      }`}
                    >
                      <span className={`text-[15px] ${book.id === currentBook.id ? "font-bold text-amber-600" : "font-medium text-earth"}`}>{book.name}</span>
                      <span className="text-xs text-[color:var(--text-faint)]">{book.chapters} ch</span>
                    </div>
                  ))}
                </div>
              ) : null
            )}
          </>
        )}

        {selectedBook && (
          <div className="p-4">
            <div className="grid grid-cols-5 gap-2.5">
              {Array.from({ length: selectedBook.chapters }, (_, i) => i + 1).map((ch) => {
                const active = selectedBook.id === currentBook.id && ch === currentChapter;
                return (
                  <button
                    key={ch}
                    onClick={() => { onSelect(selectedBook, ch); onClose(); }}
                    className={`aspect-square border-[1.5px] font-semibold text-[15px] rounded-xl cursor-pointer transition-all ${
                      active
                        ? "bg-amber-600 border-amber-600 text-white font-extrabold shadow-md"
                        : "bg-white border-stone-200 text-earth hover:border-amber-600"
                    }`}
                  >
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
function VerseActionSheet({ verseAction, highlighted, onHighlight, onRemoveHighlight, onCopy, onShare, onClose }: {
  verseAction: VerseAction; highlighted: Map<string, HighlightColor>;
  onHighlight: (k: string, c: HighlightColor) => void; onRemoveHighlight: (k: string) => void;
  onCopy: (t: string, r: string) => void; onShare: (t: string, r: string) => void; onClose: () => void;
}) {
  const { verse, book, chapter } = verseAction;
  const key = `${book}-${chapter}-${verse.number}`;
  const ref = `${book} ${chapter}:${verse.number}`;
  const currentHl = highlighted.get(key);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/40 z-[70]" />
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white rounded-t-[20px] z-[80] shadow-[0_-8px_32px_rgba(0,0,0,0.15)]">
        <div className="flex justify-center pt-2.5"><div className="w-9 h-1 bg-stone-200 rounded-full" /></div>
        <div className="px-5 py-3 border-b border-stone-200">
          <div className="text-[11px] font-bold text-amber-600 uppercase tracking-wider mb-1">{ref}</div>
          <div className="text-sm text-warm-brown leading-relaxed" style={{ fontFamily: "'Crimson Pro', Georgia, serif" }}>{verse.text}</div>
        </div>

        <div className="px-5 py-3.5 border-b border-stone-200">
          <div className="text-[11px] font-bold text-warm-brown uppercase tracking-wider mb-2.5">Highlight</div>
          <div className="flex gap-2.5 items-center">
            {(Object.entries(HIGHLIGHT_COLORS) as [HighlightColor, string][]).map(([color, hex]) => (
              <button
                key={color}
                onClick={() => currentHl === color ? onRemoveHighlight(key) : onHighlight(key, color)}
                className={`w-8 h-8 rounded-full border-[2.5px] cursor-pointer transition-all ${currentHl === color ? "border-amber-600 scale-125" : "border-transparent"}`}
                style={{ background: hex }}
              />
            ))}
            {currentHl && (
              <button onClick={() => onRemoveHighlight(key)} className="text-xs text-warm-brown bg-transparent border border-stone-200 rounded-full px-2.5 py-1 cursor-pointer font-semibold">Remove</button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 px-4 py-3.5 pb-8">
          <button onClick={() => { onCopy(verse.text, ref); onClose(); }} className="bg-stone-100 border-[1.5px] border-stone-200 rounded-xl py-3 cursor-pointer flex flex-col items-center gap-1.5 hover:border-amber-600 hover:bg-amber-50 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B7355" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            <span className="text-[11px] font-bold text-warm-brown">Copy</span>
          </button>
          <button onClick={() => { onShare(verse.text, ref); onClose(); }} className="bg-stone-100 border-[1.5px] border-stone-200 rounded-xl py-3 cursor-pointer flex flex-col items-center gap-1.5 hover:border-amber-600 hover:bg-amber-50 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B7355" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
            <span className="text-[11px] font-bold text-warm-brown">Share</span>
          </button>
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
  const [translation, setTranslation] = useState("web");
  const [book, setBook] = useState<BookMeta>(BOOKS.find((b) => b.id === "john")!);
  const [chapter, setChapter] = useState(3);
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showTranslations, setShowTranslations] = useState(false);
  const [highlighted, setHighlighted] = useState<Map<string, HighlightColor>>(new Map());
  const [activeVerse, setActiveVerse] = useState<VerseAction | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ ref: string; text: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(18);
  const [deskSearch, setDeskSearch] = useState(""); // desktop sidebar book filter (lg+ only)
  const [expandedBook, setExpandedBook] = useState<string | null>(book.id); // desktop sidebar accordion
  const [bookNavCollapsed, setBookNavCollapsed] = useState(false); // desktop book sidebar collapse

  useEffect(() => { setHighlighted(loadHighlights()); }, []);
  useEffect(() => { saveHighlights(highlighted); }, [highlighted]);

  const loadChapter = useCallback(async () => {
    setLoading(true); setError(null);
    try { setVerses(await fetchChapter(book.id, chapter, translation)); }
    catch (err: any) { setError(err.message || "Could not load chapter."); }
    finally { setLoading(false); }
  }, [book, chapter, translation]);
  useEffect(() => { loadChapter(); }, [loadChapter]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => { setSearching(true); setSearchResults(await fetchSearch(searchQuery, translation)); setSearching(false); }, 600);
    return () => clearTimeout(timer);
  }, [searchQuery, translation]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2000); };
  const handleHighlight = (k: string, c: HighlightColor) => setHighlighted((p) => new Map(p).set(k, c));
  const handleRemoveHighlight = (k: string) => setHighlighted((p) => { const n = new Map(p); n.delete(k); return n; });
  const handleCopy = (text: string, ref: string) => { navigator.clipboard?.writeText(`"${text}" — ${ref} (${getTranslationName(translation)})`); showToast("Verse copied"); };
  const handleShare = async (text: string, ref: string) => { if (navigator.share) { try { await navigator.share({ text: `"${text}" — ${ref} (${getTranslationName(translation)})` }); } catch (e: any) { if (e.name !== "AbortError") handleCopy(text, ref); } } else handleCopy(text, ref); };
  const goToChapter = (delta: number) => { const next = chapter + delta; if (next < 1 || next > book.chapters) return; setChapter(next); window.scrollTo(0, 0); };

  return (
    <div className="bg-[#FAF8F5] h-screen w-full max-w-[480px] mx-auto flex flex-col overflow-hidden relative lg:max-w-none lg:mx-0 lg:h-full lg:flex-row">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;1,400&display=swap');`}</style>

      {showPicker && <BookPicker currentBook={book} currentChapter={chapter} onSelect={(b, ch) => { setBook(b); setChapter(ch); }} onClose={() => setShowPicker(false)} />}
      {activeVerse && <VerseActionSheet verseAction={activeVerse} highlighted={highlighted} onHighlight={handleHighlight} onRemoveHighlight={handleRemoveHighlight} onCopy={handleCopy} onShare={handleShare} onClose={() => setActiveVerse(null)} />}
      {toast && <div className="fixed bottom-[100px] left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-full px-4 py-2 text-[13px] font-semibold z-[99] whitespace-nowrap animate-[fadeIn_0.25s_ease]">{toast}</div>}

      {/* ── DESKTOP BOOK SIDEBAR (lg+ only; hidden on mobile so mobile is unchanged) ── */}
      <aside className={`hidden lg:flex-col lg:w-[264px] lg:flex-shrink-0 lg:border-r lg:border-stone-200 lg:bg-white lg:min-h-0 ${bookNavCollapsed ? 'lg:hidden' : 'lg:flex'}`}>
        <div className="p-4 border-b border-stone-200 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-stone-100 rounded-lg border border-stone-200 px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A89A87" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input value={deskSearch} onChange={(e) => setDeskSearch(e.target.value)} placeholder="Search books…" className="flex-1 border-none bg-transparent text-[13px] outline-none text-earth" />
          </div>
          <button onClick={() => setBookNavCollapsed(true)} title="Collapse books" className="w-8 h-8 rounded-lg flex items-center justify-center text-[color:var(--text-faint)] hover:bg-stone-100 shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {([["Old Testament", "OT"], ["New Testament", "NT"]] as [string, "OT" | "NT"][]).map(([label, testament]) => {
            const list = BOOKS.filter((b) => b.testament === testament && b.name.toLowerCase().includes(deskSearch.toLowerCase()));
            if (list.length === 0) return null;
            return (
              <div key={testament}>
                <div className="px-3 pt-3 pb-1 text-[10px] font-bold text-[color:var(--text-faint)] tracking-widest uppercase">{label}</div>
                {list.map((b) => {
                  const active = b.id === book.id;
                  const isExpanded = expandedBook === b.id;
                  return (
                    <div key={b.id}>
                      <button onClick={() => setExpandedBook(isExpanded ? null : b.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${active ? "" : "hover:bg-stone-100"}`}
                        style={active ? { background: GOLD_LIGHT } : undefined}>
                        <span className="text-[13.5px]" style={active ? { color: GOLD, fontWeight: 600 } : { color: "#4A4038" }}>{b.name}</span>
                        <span className="text-[11px] text-[color:var(--text-faint)]">{b.chapters} ch</span>
                      </button>
                      {isExpanded && (
                        <div className="grid grid-cols-5 gap-1.5 px-2 py-2">
                          {Array.from({ length: b.chapters }, (_, i) => i + 1).map((ch) => {
                            const chActive = active && ch === chapter;
                            return (
                              <button key={ch} onClick={() => { setBook(b); setChapter(ch); setTab("read"); }}
                                className={`aspect-square rounded-md text-[12px] font-semibold transition-colors ${chActive ? "text-white" : "text-warm-brown hover:bg-stone-100"}`}
                                style={chActive ? { background: GOLD } : undefined}>
                                {ch}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── MAIN COLUMN (display:contents on mobile → children flow exactly as before; flex column on desktop) ── */}
      <div className="contents lg:flex lg:flex-1 lg:flex-col lg:min-h-0">

      {/* ── TOP BAR ── */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 lg:py-2 flex-shrink-0 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between mb-3 lg:mb-0">
          <div className="flex items-center gap-2">
          <button onClick={() => setShowPicker(true)} className="bg-transparent border-none cursor-pointer flex items-center gap-1 lg:hidden">
            <span className="font-extrabold text-[17px] text-earth font-display">{book.name} {chapter}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A89A87" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {/* Desktop: re-open the book sidebar after collapsing it */}
          {bookNavCollapsed && (
            <button onClick={() => setBookNavCollapsed(false)} title="Show books" className="hidden lg:flex w-7 h-7 rounded-md items-center justify-center text-warm-brown border border-stone-200 hover:bg-stone-100">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
          )}
          {/* Desktop-only reader font-size, next to the translation */}
          <div className="hidden lg:flex items-center gap-1.5">
            <button onClick={() => setFontSize((s) => Math.max(13, s - 2))} className="w-7 h-7 rounded-md bg-stone-100 border border-stone-200 text-xs font-bold text-warm-brown flex items-center justify-center hover:bg-stone-100">A-</button>
            <button onClick={() => setFontSize((s) => Math.min(26, s + 2))} className="w-7 h-7 rounded-md bg-stone-100 border border-stone-200 text-sm font-bold text-warm-brown flex items-center justify-center hover:bg-stone-100">A+</button>
          </div>
          </div>
          <div className="relative">
            <button onClick={() => setShowTranslations((v) => !v)} className="px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs font-bold text-amber-600 cursor-pointer">
              {getTranslationName(translation)} ▾
            </button>
            {showTranslations && (
              <>
                <div onClick={() => setShowTranslations(false)} className="fixed inset-0 z-30" />
                <div className="absolute top-9 right-0 bg-white rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-stone-200 z-40 overflow-y-auto max-h-[60vh] min-w-[160px]">
                  {(Object.entries(TRANSLATIONS_BY_LANGUAGE) as [Language, { id: string; name: string }[]][]).map(([lang, transList]) => (
                    <div key={lang}>
                      <div className="px-4 py-2 text-[10px] font-bold text-[color:var(--text-faint)] tracking-widest uppercase bg-stone-100">{lang}</div>
                      {transList.map((t) => (
                        <div key={t.id} onClick={() => { setTranslation(t.id); setShowTranslations(false); }}
                          className={`px-4 py-2.5 cursor-pointer text-sm border-b border-stone-200 transition-colors ${t.id === translation ? "font-extrabold text-amber-600 bg-amber-50" : "font-medium text-earth hover:bg-stone-100"}`}>
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
        <div className="flex border-b border-stone-200 -mx-4 px-4 lg:hidden">
          {(["read", "search"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 bg-transparent border-none border-b-[2.5px] font-semibold text-[13px] py-2.5 cursor-pointer flex items-center justify-center gap-1.5 transition-colors ${tab === t ? "text-amber-600 border-amber-600" : "text-[color:var(--text-faint)] border-transparent hover:text-warm-brown"}`}>
              {t === "read" ? (
                <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>Read</>
              ) : (
                <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>Search</>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── READ TAB ── */}
      {tab === "read" && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="flex justify-between items-center px-4 pt-3 lg:hidden">
            <div className="flex gap-1.5">
              <button onClick={() => setFontSize((s) => Math.max(13, s - 2))} className="w-[30px] h-[30px] rounded-lg bg-white border border-stone-200 cursor-pointer text-xs font-bold text-warm-brown flex items-center justify-center">A-</button>
              <button onClick={() => setFontSize((s) => Math.min(26, s + 2))} className="w-[30px] h-[30px] rounded-lg bg-white border border-stone-200 cursor-pointer text-base font-bold text-warm-brown flex items-center justify-center">A+</button>
            </div>
            <span className="text-[11px] text-[color:var(--text-faint)]">Tap a verse for options</span>
          </div>

          {loading && (
            <div className="flex-1 flex items-center justify-center p-10">
              <div className="w-8 h-8 border-4 border-amber-100 border-t-amber-600 rounded-full animate-spin" />
            </div>
          )}

          {error && !loading && (
            <div className="m-5 bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
              <svg className="mx-auto mb-2 text-red-400" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <div className="text-sm text-red-600 font-semibold mb-2.5">{error}</div>
              <button onClick={loadChapter} className="bg-amber-600 border-none text-white font-bold px-5 py-2 rounded-lg cursor-pointer text-sm">Try Again</button>
            </div>
          )}

          {!loading && !error && (
            <div className="px-4 pt-3 pb-2 flex-1 lg:max-w-[760px] lg:mx-auto lg:w-full lg:px-10">
              {/* Desktop reader heading — big book title + chapter label (mockup) */}
              <div className="hidden lg:block mb-6 mt-2">
                <h2 className="text-[30px] leading-tight text-earth" style={{ fontFamily: "var(--font-serif), Georgia, serif" }}>{book.name}</h2>
                <div className="text-[12px] font-bold mt-1.5 uppercase tracking-wider" style={{ color: GOLD }}>Chapter {chapter}</div>
              </div>
              {verses.map((verse) => {
                const key = `${book.name}-${chapter}-${verse.number}`;
                const hlColor = highlighted.get(key);
                return (
                  <div key={verse.number} onClick={() => setActiveVerse({ verse, book: book.name, chapter })}
                    className="flex gap-3 mb-4 cursor-pointer rounded-[10px] py-2 px-2.5 transition-colors hover:bg-black/[0.02]"
                    style={{ background: hlColor ? HIGHLIGHT_COLORS[hlColor] : "transparent" }}>
                    <span className="text-[11px] font-extrabold min-w-[24px] pt-1 flex-shrink-0" style={{ color: GOLD }}>{verse.number}</span>
                    <span style={{ fontSize: fontSize, fontFamily: "'Crimson Pro', Georgia, serif", lineHeight: 1.85 }} className="text-earth lg:![font-family:var(--font-serif),Georgia,serif]">{verse.text}</span>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && !error && (
            <div className="flex gap-2.5 px-4 py-3 pb-6 flex-shrink-0 lg:max-w-[760px] lg:mx-auto lg:w-full lg:px-10">
              <button onClick={() => goToChapter(-1)} disabled={chapter === 1}
                className={`flex-1 py-3 rounded-xl text-sm font-bold cursor-pointer flex items-center justify-center gap-1.5 transition-colors ${chapter > 1 ? "bg-white border-[1.5px] border-stone-200 text-warm-brown hover:border-gray-300" : "bg-stone-100 border border-stone-200 text-stone-300 cursor-not-allowed"}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
                Chapter {chapter - 1}
              </button>
              <button onClick={() => goToChapter(1)} disabled={chapter === book.chapters}
                className={`flex-1 py-3 rounded-xl text-sm font-bold cursor-pointer flex items-center justify-center gap-1.5 transition-colors ${chapter < book.chapters ? "bg-amber-600 border-none text-white hover:bg-amber-700" : "bg-stone-100 border border-stone-200 text-stone-300 cursor-not-allowed"}`}>
                Chapter {chapter + 1}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── SEARCH TAB ── */}
      {tab === "search" && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="px-4 py-3 flex-shrink-0">
            <div className="flex items-center gap-2 bg-white rounded-full border-[1.5px] border-stone-200 px-4 py-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A89A87" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder='Try "John 3:16" or "love"...' autoFocus className="flex-1 border-none bg-transparent text-sm outline-none text-earth" />
              {searchQuery && <button onClick={() => { setSearchQuery(""); setSearchResults([]); }} className="bg-transparent border-none text-[color:var(--text-faint)] cursor-pointer text-sm">✕</button>}
            </div>
            <div className="text-[11px] text-[color:var(--text-faint)] text-center mt-1.5">Powered by bible-api.com · {getTranslationName(translation)}</div>
          </div>

          <div className="flex-1 px-4 pb-8 flex flex-col gap-3">
            {!searchQuery && (
              <div className="text-center py-12 text-[color:var(--text-faint)]">
                <svg className="mx-auto mb-3 text-stone-300" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
                <p className="text-sm font-semibold">Search the Scriptures</p>
                <p className="text-[13px] mt-1">Type a verse reference or keyword</p>
              </div>
            )}

            {searching && <div className="flex justify-center p-5"><div className="w-6 h-6 border-[3px] border-amber-100 border-t-amber-600 rounded-full animate-spin" /></div>}

            {!searching && searchQuery && searchResults.length === 0 && (
              <div className="text-center py-8 text-[color:var(--text-faint)] text-sm">No results. Try a verse reference like &quot;Romans 8:28&quot;.</div>
            )}

            {searchResults.map((result, i) => (
              <div key={i} onClick={() => {
                const parts = result.ref.split(" ");
                const chVerse = parts[parts.length - 1].split(":");
                const ch = parseInt(chVerse[0]);
                const bookName = parts.slice(0, parts.length - 1).join(" ");
                const found = BOOKS.find((b) => b.name.toLowerCase() === bookName.toLowerCase());
                if (found) { setBook(found); setChapter(ch); setTab("read"); }
              }} className="bg-white rounded-xl p-3.5 border border-stone-200 cursor-pointer hover:shadow-md transition-shadow">
                <div className="text-xs font-extrabold mb-1.5 tracking-wide" style={{ color: GOLD }}>{result.ref} · {getTranslationName(translation)}</div>
                <div className="text-base leading-7 text-earth" style={{ fontFamily: "'Crimson Pro', Georgia, serif" }}>{result.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>{/* /main column */}
    </div>
  );
}
