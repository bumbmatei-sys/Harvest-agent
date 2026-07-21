import { useState, useRef, useEffect, KeyboardEvent } from "react";
import Image from "next/image";
import ReactMarkdown from 'react-markdown';
import { db, auth } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope, PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useTenant } from '../contexts/TenantContext';

// AI API calls are proxied through /api/gemini to keep API keys server-side
// Embeddings: Gemini | Chat: Xiaomi MiMo

// ─────────────────────────────────────────────
// HARVEST — AI Chat Interface (TypeScript)
// Mobile-first, matches Harvest design system
// ─────────────────────────────────────────────

const DEFAULT_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

const GOLD = "var(--brand-color, #C9963A)";
const GOLD_LIGHT = "var(--chat-gold-light)";
const GOLD_BTN = "var(--chat-gold-btn)";
const BG = "var(--chat-bg)";
const CARD = "var(--chat-card)";
const TEXT = "var(--chat-text)";
const TEXT2 = "var(--chat-text2)";
const BORDER = "var(--chat-border)";

// ── Types ──────────────────────────────────────
type Role = "user" | "ai";

interface Message {
 id: string;
 role: Role;
 text: string;
 time: string;
}

interface Chat {
 id: string;
 title: string;
 preview: string;
 date: string;
 messages: Message[];
}

// ── Helpers ────────────────────────────────────
const uid = (): string => Math.random().toString(36).slice(2, 9);
const now = (): string => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const formatDate = (d: string): string => {
 const date = new Date(d);
 const today = new Date();
 const diff = Math.floor((today.getTime() - date.getTime()) / 86400000);
 if (diff === 0) return "Today";
 if (diff === 1) return "Yesterday";
 return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const SUGGESTIONS = [
 "What does the Bible say about anxiety?",
 "Explain John 3:16 in depth",
 "How do I pray effectively?",
 "What is the Holy Trinity?",
 "Summarize the book of Romans",
 "How did Jesus fulfill the Old Testament?",
];

// ═══════════════════════════════════════════════
// TYPING INDICATOR
// ═══════════════════════════════════════════════
interface TypingIndicatorProps {
 logoSrc: string;
 logoAlt: string;
}

function TypingIndicator({ logoSrc, logoAlt }: TypingIndicatorProps) {
 return (
 <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "4px 0" }}>
 <div style={{ width: 32, height: 32, borderRadius: "50%", background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, overflow: "hidden" }}>
 <Image src={logoSrc} alt={logoAlt} width={20} height={20} className="object-contain" />
 </div>
 <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: "18px 18px 18px 4px", padding: "12px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", display: "flex", gap: 5, alignItems: "center" }}>
 {[0, 1, 2].map((i) => (
 <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: GOLD, opacity: 0.7, animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
 ))}
 </div>
 </div>
 );
}

// ═══════════════════════════════════════════════
// MESSAGE BUBBLE
// ═══════════════════════════════════════════════
interface MessageBubbleProps {
 message: Message;
 logoSrc: string;
 logoAlt: string;
}

function MessageBubble({ message, logoSrc, logoAlt }: MessageBubbleProps) {
 const isUser = message.role === "user";
 return (
 <div style={{ display: "flex", flexDirection: isUser ? "row-reverse" : "row", alignItems: "flex-end", gap: 8, marginBottom: 4 }}>
 {!isUser && (
 <div style={{ width: 32, height: 32, borderRadius: "50%", background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, overflow: "hidden" }}>
 <Image src={logoSrc} alt={logoAlt} width={20} height={20} className="object-contain" />
 </div>
 )}
 <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", gap: 3 }}>
 <div style={{
 background: isUser ? GOLD_BTN : CARD,
 color: isUser ? "#fff" : TEXT,
 borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
 padding: "11px 15px",
 fontSize: 14,
 lineHeight: 1.65,
 boxShadow: isUser ? "0 2px 8px rgba(201,150,58,0.3)" : "0 1px 4px rgba(0,0,0,0.07)",
 border: isUser ? "none" : `1px solid ${BORDER}`,
 }}>
 {isUser ? (
 message.text
 ) : (
 <div className="ai-markdown-content" style={{ color: TEXT }}>
 <ReactMarkdown>{message.text}</ReactMarkdown>
 </div>
 )}
 </div>
 <span style={{ fontSize: 10, color: TEXT2, paddingInline: 4 }}>{message.time}</span>
 </div>
 </div>
 );
}

// ═══════════════════════════════════════════════
// CHAT LIST — the scrollable conversation list, shared by the mobile
// history drawer and the desktop persistent rail so both render from the
// same real `history` array with identical item markup / delete behavior.
// ═══════════════════════════════════════════════
interface ChatListProps {
 history: Chat[];
 activeId: string | null;
 onSelect: (chat: Chat) => void;
 onDelete: (id: string) => void;
}

function ChatList({ history, activeId, onSelect, onDelete }: ChatListProps) {
 return (
 <div style={{ overflowY: "auto", flex: 1 }}>
 {history.length === 0 && (
 <div style={{ padding: "32px 16px", textAlign: "center", color: TEXT2, fontSize: 13 }}>No conversations yet.</div>
 )}
 {history.map((chat) => {
 const active = chat.id === activeId;
 return (
 <div key={chat.id}
 style={{ padding: "13px 16px", borderBottom: `1px solid ${BORDER}`, background: active ? GOLD_LIGHT : "transparent", borderLeft: `3px solid ${active ? GOLD : "transparent"}`, transition: "background 0.15s", display: "flex", alignItems: "center", gap: 8 }}
 onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = BG; }}
 onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = active ? GOLD_LIGHT : "transparent"; }}>
 {/* Chat info — tappable */}
 <div onClick={() => onSelect(chat)} style={{ flex: 1, cursor: "pointer", minWidth: 0 }}>
 <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
 <div style={{ fontWeight: 700, fontSize: 13, color: active ? GOLD : TEXT, lineHeight: 1.3, flex: 1, paddingRight: 6 }}>{chat.title}</div>
 <span style={{ fontSize: 10, color: TEXT2, flexShrink: 0, marginTop: 1 }}>{formatDate(chat.date)}</span>
 </div>
 <div style={{ fontSize: 12, color: TEXT2, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chat.preview}</div>
 </div>
 {/* Delete button */}
 <button
 onClick={(e) => { e.stopPropagation(); onDelete(chat.id); }}
 style={{ background: "none", border: "none", cursor: "pointer", color: "#CCC", fontSize: 15, padding: "4px", lineHeight: 1, flexShrink: 0, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}
 onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#E74C3C"; (e.currentTarget as HTMLButtonElement).style.background = "#FDECEA"; }}
 onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#CCC"; (e.currentTarget as HTMLButtonElement).style.background = "none"; }}>
 🗑
 </button>
 </div>
 );
 })}
 </div>
 );
}

// ═══════════════════════════════════════════════
// HISTORY PANEL
// ═══════════════════════════════════════════════
interface HistoryPanelProps {
 history: Chat[];
 activeId: string | null;
 onSelect: (chat: Chat) => void;
 onNewChat: () => void;
 onClose: () => void;
 onDelete: (id: string) => void;
}

function HistoryPanel({ history, activeId, onSelect, onNewChat, onClose, onDelete }: HistoryPanelProps) {
 return (
 <>
 {/* Backdrop */}
 <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 40, backdropFilter: "blur(2px)" }} />
 {/* Drawer */}
 <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 300, background: CARD, zIndex: 50, display: "flex", flexDirection: "column", boxShadow: "-8px 0 32px rgba(0,0,0,0.12)" }}>
 {/* Header */}
 <div style={{ padding: "20px 16px 14px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
 <div>
 <div style={{ fontFamily: "var(--font-display), Georgia, serif", fontWeight: 700, fontSize: 17, color: TEXT }}>Chat History</div>
 <div style={{ fontSize: 11, color: TEXT2, marginTop: 2 }}>{history.length} conversation{history.length !== 1 ? "s" : ""}</div>
 </div>
 <button onClick={onClose} style={{ background: BG, border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
 </div>

 {/* New Chat Button */}
 <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}` }}>
 <button onClick={onNewChat}
 style={{ width: "100%", background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 700, padding: "11px", borderRadius: 12, cursor: "pointer", fontSize: 14, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 2px 8px color-mix(in srgb, var(--brand-color, #C9963A) 35%, transparent)" }}>
 <span style={{ fontSize: 18 }}>✦</span> New Chat
 </button>
 </div>

 {/* List — shared with the desktop rail via <ChatList>. The drawer wraps
 onSelect to also close itself after picking a conversation. */}
 <ChatList
 history={history}
 activeId={activeId}
 onSelect={(chat) => { onSelect(chat); onClose(); }}
 onDelete={onDelete}
 />
 </div>
 </>
 );
}

// ═══════════════════════════════════════════════
// MAIN AI CHAT
// ═══════════════════════════════════════════════
export default function AIChat({ onBack }: { onBack?: () => void }) {
  // White-label tenants (any real tenant other than the platform) show their own
  // name + logo; the platform / super-admin view keeps the "Harvest" brand.
  const { tenantId, tenantName, branding } = useTenant();
  const isWhiteLabel = !!tenantId && tenantId !== PLATFORM_TENANT_ID;
  const displayName = isWhiteLabel && tenantName ? tenantName : 'Harvest';
  const displayLogo = isWhiteLabel && branding?.logo ? branding.logo : DEFAULT_LOGO;
  // "Ask {ministry}" hero title — the assistant is branded with the ministry's
  // short name (strips a leading "The"); falls back to "Ask Harvest".
  const askBrandName = (() => {
    const words = displayName.trim().split(/\s+/).filter(Boolean);
    if (words.length > 1 && words[0].toLowerCase() === 'the') return words[1];
    return words[0] || 'Harvest';
  })();
  const [railCollapsed, setRailCollapsed] = useState(false); // desktop history rail
  const [history, setHistory] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>("");
  const [typing, setTyping] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  // When the server-side usage limit kicks in, it returns `limited: true` and a
  // canned "resting" reply. We surface a small note; the input stays usable so
  // the user is never hard-locked out (the server is the real gate).
  const [resting, setResting] = useState<boolean>(false);
  // When the block is the monthly query-token CAP (not the per-user cooldown),
  // the server returns capReached:'query' so we can show a tailored upgrade note.
  const [capReached, setCapReached] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load chat history from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('harvest_ai_chats');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse chat history", e);
      }
    }
  }, []);

  // Save chat history to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('harvest_ai_chats', JSON.stringify(history));
  }, [history]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

const startNewChat = (): void => {
    setActiveChat(null);
 setMessages([]);
 setInput("");
 setShowHistory(false);
 };

 const loadChat = (chat: Chat): void => {
 setActiveChat(chat);
 setMessages(chat.messages);
 };

 const deleteChat = (id: string): void => {
 setHistory((h) => h.filter((c) => c.id !== id));
 if (activeChat?.id === id) {
 setActiveChat(null);
 setMessages([]);
 }
 };

 // Cosine similarity function
 const cosineSimilarity = (a: number[], b: number[]) => {
 let dotProduct = 0;
 let normA = 0;
 let normB = 0;
 for (let i = 0; i < a.length; i++) {
 dotProduct += a[i] * b[i];
 normA += a[i] * a[i];
 normB += b[i] * b[i];
 }
 if (normA === 0 || normB === 0) return 0;
 return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
 };

 const searchVectorDB = async (queryText: string) => {
   try {
     // 1. Embed the query via API route
     const res = await fetch('/api/gemini', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${await auth.currentUser?.getIdToken()}`,
       },
       body: JSON.stringify({ action: 'embed', text: queryText }),
     });
     const embedData = await res.json();
     if (!res.ok) throw new Error(embedData.error || 'Embed request failed');

     const queryVector = embedData.vector;
     if (!queryVector) return [];

     // 2. Fetch all chunks (for a small knowledge base this is fine)
     // For larger DBs, we'd need a proper vector search extension or backend
     const tenantId = await getTenantScope();
    const chunksSnap = await getDocs(
      tenantId
        ? query(collection(db, "rag_chunks"), where("tenantId", "==", tenantId))
        : collection(db, "rag_chunks")
    );
      
     const scoredChunks = chunksSnap.docs.map(doc => {
       const data = doc.data() as { title: string; chunk: string; vector: number[] };
       const similarity = cosineSimilarity(queryVector, data.vector || []);
       return {
         ...data,
         similarity
       };
     });

     // 3. Sort by similarity and take top 5
     scoredChunks.sort((a, b) => b.similarity - a.similarity);
     return scoredChunks.slice(0, 5).filter(c => c.similarity > 0.5); // Only return relevant chunks
   } catch (error) {
     const errInfo = handleFirestoreError(error, OperationType.GET, 'rag_chunks');
     console.warn('Knowledge base search failed, falling back to general chat:', errInfo.error);
     return [];
   }
 };

 const sendMessage = async (text: string): Promise<void> => {
 if (!text.trim()) return;
 const userMsg: Message = { id: uid(), role: "user", text: text.trim(), time: now() };
 const newMessages = [...messages, userMsg];
 setMessages(newMessages);
 setInput("");
 setTyping(true);

 // Persist the conversation immediately (create on the first message, else
 // update) so it survives an API error or a "New Chat" click before the reply
 // arrives. Previously the save happened only after a successful response, so a
 // failed request left nothing in history.
 const title = text.length > 40 ? text.slice(0, 40) + "…" : text;
 let chatId: string | null = activeChat?.id ?? null;
 if (activeChat) {
 const updatedChat = { ...activeChat, messages: newMessages, preview: text };
 setActiveChat(updatedChat);
 setHistory((h) => h.map((c) => (c.id === updatedChat.id ? updatedChat : c)));
 } else {
 const createdChat: Chat = { id: uid(), title, preview: text, date: new Date().toISOString(), messages: newMessages };
 chatId = createdChat.id;
 setActiveChat(createdChat);
 setHistory((h) => [createdChat, ...h]);
 }

 try {
 // 1. Search knowledge base
 const relevantChunks = await searchVectorDB(text);
 
 // 2. Construct prompt with context
 let contextStr = "";
 if (relevantChunks.length > 0) {
 contextStr = "Here is some relevant context from the knowledge base to help answer the user's question:\n\n";
 relevantChunks.forEach((chunk, i) => {
 contextStr += `[Source ${i+1}: ${chunk.title}]\n${chunk.chunk}\n\n`;
 });
 }

 const systemInstruction = `You are Harvest Assistant, a helpful AI for church and ministry communities.

RULES:
- Answer in 1-3 sentences maximum unless a list is genuinely needed
- Never repeat the question back
- Never say "Great question!" or any filler
- If you don't know, say so in one sentence
- Be warm, kind, and direct

KNOWLEDGE:
You have access to this ministry's specific content via retrieval. Always prioritize retrieved content over general knowledge. If retrieved content doesn't answer the question, say "I don't have that information for your church — contact your admin."

TONE:
Friendly neighbor, not a corporate chatbot. Short. Helpful. Human.`;

 // 3. Call Gemini API via server-side route
 const chatHistory = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
    
 const prompt = `${contextStr}\n\nChat History:\n${chatHistory}\n\nUser: ${text}`;

 const response = await fetch('/api/gemini', {
   method: 'POST',
   headers: {
     'Content-Type': 'application/json',
     'Authorization': `Bearer ${await auth.currentUser?.getIdToken()}`,
   },
   body: JSON.stringify({
     action: 'generate',
     prompt,
     systemInstruction,
     purpose: 'chat',
   }),
 });
 const genData = await response.json();
 if (!response.ok) throw new Error(genData.error || 'Generate request failed');

 // The server returns `limited: true` with a canned reply once a usage limit is
 // reached — either the per-user cooldown (Holy-Spirit redirect → rest) or the
 // tenant monthly query-token CAP (capReached: 'query').
 setResting(genData.limited === true);
 setCapReached(genData.capReached ?? null);

 const aiText = genData.text || "I'm sorry, I couldn't generate a response.";
 
 const aiMsg: Message = { id: uid(), role: "ai", text: aiText, time: now() };
 const finalMessages = [...newMessages, aiMsg];
 setMessages(finalMessages);

 // Update the already-persisted conversation with the assistant's reply.
 if (chatId) {
 const cid = chatId;
 setActiveChat((c) => (c && c.id === cid ? { ...c, messages: finalMessages, preview: text } : c));
 setHistory((h) => h.map((c) => (c.id === cid ? { ...c, messages: finalMessages, preview: text } : c)));
 }
 } catch (error) {
 console.error("Error generating response:", error);
 const errorMsg: Message = { id: uid(), role: "ai", text: "I'm sorry, I encountered an error while trying to answer your question. Please try again later.", time: now() };
 const finalMessages = [...newMessages, errorMsg];
 setMessages(finalMessages);
 // Keep the persisted conversation in sync even when the AI errors.
 if (chatId) {
 const cid = chatId;
 setActiveChat((c) => (c && c.id === cid ? { ...c, messages: finalMessages } : c));
 setHistory((h) => h.map((c) => (c.id === cid ? { ...c, messages: finalMessages } : c)));
 }
 } finally {
 setTyping(false);
 }
 };

 const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
 if (e.key === "Enter" && !e.shiftKey) { 
 e.preventDefault(); 
 sendMessage(input); 
 }
 };

 const isEmpty = messages.length === 0;

 return (
 // Root is a flex ROW so the desktop history rail can sit to the left of the
 // chat column. On mobile the rail is `hidden`, leaving a single full-width
 // child (the chat column) — visually identical to the previous single-column
 // layout. The old maxWidth:1024 / margin:auto only had any effect at >=1024px
 // (i.e. lg), where we now redesign, so dropping them leaves mobile untouched.
 <div style={{ fontFamily: "var(--font-sans), system-ui, sans-serif", background: BG, height: "100%", width: "100%", display: "flex", position: "relative", overflow: "hidden" }}>
 <style>{`
 :root {
 --chat-bg: #FAF8F5;
 --chat-card: #FFFFFF;
 --chat-text: #2D2519;
 --chat-text2: #8B7355;
 --chat-border: #E8E2D9;
 --chat-gold-light: color-mix(in srgb, var(--brand-color, #C9963A) 12%, white);
 --chat-gold-btn: linear-gradient(135deg, var(--brand-color, #C9963A), color-mix(in srgb, var(--brand-color, #C9963A) 82%, #ffffff));
 }
 * { box-sizing: border-box; margin: 0; padding: 0; }
 ::-webkit-scrollbar { width: 0; }
 textarea { outline: none; resize: none; }
 @keyframes bounce {
 0%, 60%, 100% { transform: translateY(0); }
 30% { transform: translateY(-6px); }
 }
 @keyframes fadeSlideUp {
 from { opacity: 0; transform: translateY(10px); }
 to { opacity: 1; transform: translateY(0); }
 }
 .ai-markdown-content p {
 margin-bottom: 0.75em;
 }
 .ai-markdown-content p:last-child {
 margin-bottom: 0;
 }
 .ai-markdown-content strong {
 font-weight: 700;
 color: inherit;
 }
 .ai-markdown-content ul {
 list-style-type: disc;
 padding-left: 1.25em;
 margin-bottom: 0.75em;
 }
 .ai-markdown-content ol {
 list-style-type: decimal;
 padding-left: 1.25em;
 margin-bottom: 0.75em;
 }
 .ai-markdown-content li {
 margin-bottom: 0.25em;
 }
 .ai-markdown-content h1, .ai-markdown-content h2, .ai-markdown-content h3 {
 font-weight: 700;
 margin-top: 1em;
 margin-bottom: 0.5em;
 line-height: 1.3;
 }
 .ai-markdown-content h1 { font-size: 1.25em; }
 .ai-markdown-content h2 { font-size: 1.15em; }
 .ai-markdown-content h3 { font-size: 1.05em; }
 .ai-markdown-content a {
 color: var(--brand-color, #C9963A);
 text-decoration: underline;
 }
 `}</style>

 {/* History Panel — mobile (< lg) slide-in drawer, opened by the top-bar icon. */}
 {showHistory && (
 <HistoryPanel
 history={history}
 activeId={activeChat?.id ?? null}
 onSelect={loadChat}
 onNewChat={startNewChat}
 onClose={() => setShowHistory(false)}
 onDelete={deleteChat}
 />
 )}

 {/* Desktop (lg:+) persistent history rail — always visible, so the top-bar
 history icon is hidden at lg. Same real `history` + handlers as the drawer. */}
 <aside className={`hidden lg:flex-col lg:shrink-0 ${railCollapsed ? 'lg:hidden' : 'lg:flex'}`} style={{ width: 280, background: CARD, borderRight: `1px solid ${BORDER}`, height: "100%" }}>
 <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
 <div>
 <div style={{ fontFamily: "var(--font-display), Georgia, serif", fontWeight: 700, fontSize: 16, color: TEXT }}>Chat History</div>
 <div style={{ fontSize: 11, color: TEXT2, marginTop: 2 }}>{history.length} conversation{history.length !== 1 ? "s" : ""}</div>
 </div>
 <button onClick={() => setRailCollapsed(true)} title="Collapse history" style={{ background: "none", border: "none", cursor: "pointer", color: TEXT2, padding: 4, display: "flex", alignItems: "center", borderRadius: 8 }}>
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
 </button>
 </div>
 <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}` }}>
 <button onClick={startNewChat}
 style={{ width: "100%", background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 700, padding: "11px", borderRadius: 12, cursor: "pointer", fontSize: 14, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 2px 8px color-mix(in srgb, var(--brand-color, #C9963A) 35%, transparent)" }}>
 <span style={{ fontSize: 18 }}>✦</span> New Chat
 </button>
 </div>
 <ChatList history={history} activeId={activeChat?.id ?? null} onSelect={loadChat} onDelete={deleteChat} />
 </aside>

 {/* Chat column — top bar + messages + input. `flex:1` fills the space beside
 the rail on desktop and the whole width on mobile (rail hidden). */}
 <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
 {/* Desktop-only: re-open the history rail after it's been collapsed. */}
 {railCollapsed && (
 <button onClick={() => setRailCollapsed(false)} title="Show history" className="hidden lg:flex" style={{ position: "absolute", left: 12, top: 12, zIndex: 20, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 6, cursor: "pointer", color: TEXT2, alignItems: "center" }}>
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h13M3 18h18" /></svg>
 </button>
 )}
 {/* ── TOP BAR (mobile only; removed on desktop per feedback) ── */}
 <div className="lg:!hidden" style={{ background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", flexShrink: 0, zIndex: 10 }}>
 {/* Back */}
 <button onClick={onBack} style={{ background: "none", border: "none", color: GOLD, cursor: "pointer", fontSize: 22, padding: 0, display: "flex", alignItems: "center", lineHeight: 1 }}>
 ←
 </button>

 {/* Center title */}
 <div style={{ textAlign: "center", flex: 1 }}>
 <div style={{ fontFamily: "var(--font-display), Georgia, serif", fontWeight: 700, fontSize: 16, color: TEXT }}>
 {displayName} AI
 </div>
 </div>

 {/* History icon button — mobile only; the desktop rail is always visible. */}
 <button onClick={() => setShowHistory(true)} className="lg:hidden"
 style={{ background: "none", border: "none", cursor: "pointer", padding: 6, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
 <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gold" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
 <path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" />
 </svg>
 </button>
 </div>

 {/* ── MESSAGES ── */}
 <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isEmpty ? 0 : "16px 16px 8px", display: "flex", flexDirection: "column" }}>
 {/* Empty state */}
 {isEmpty && (
 <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", animation: "fadeSlideUp 0.4s ease" }}>
 <div style={{ width: 108, height: 108, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, marginBottom: 16 }}>
 {/* Plain <img> (not next/image) so tenant logos on arbitrary domains render without remotePatterns config, matching MainApp/AuthPage. */}
 <img src={displayLogo} alt={displayName} width={96} height={96} className="object-contain drop-shadow-md" />
 </div>
 <div style={{ fontFamily: "var(--font-display), Georgia, serif", fontWeight: 700, fontSize: 22, color: TEXT, marginBottom: 6, textAlign: "center" }}>{`Ask ${askBrandName}`}</div>
 <div style={{ fontSize: 13, color: TEXT2, textAlign: "center", lineHeight: 1.6, marginBottom: 28, maxWidth: 280 }}>
 I&apos;m trained on Scripture, theology, and your course content. Ask me anything about faith.
 </div>
 {/* Suggestion chips */}
 <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
 {SUGGESTIONS.map((s) => (
 <button key={s} onClick={() => sendMessage(s)}
 style={{ background: CARD, border: `1.5px solid ${BORDER}`, borderRadius: 99, padding: "8px 14px", fontSize: 12, fontWeight: 600, color: TEXT2, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s", lineHeight: 1.3, textAlign: "center" }}
 onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = GOLD; (e.currentTarget as HTMLButtonElement).style.color = GOLD; (e.currentTarget as HTMLButtonElement).style.background = GOLD_LIGHT; }}
 onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER; (e.currentTarget as HTMLButtonElement).style.color = TEXT2; (e.currentTarget as HTMLButtonElement).style.background = CARD; }}>
 {s}
 </button>
 ))}
 </div>
 </div>
 )}

 {/* Messages */}
 {!isEmpty && (
 <div className="lg:w-full lg:max-w-3xl lg:self-center" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
 {messages.map((msg) => (
 <div key={msg.id} style={{ animation: "fadeSlideUp 0.3s ease" }}>
 <MessageBubble message={msg} logoSrc={displayLogo} logoAlt={displayName} />
 </div>
 ))}
 {typing && <TypingIndicator logoSrc={displayLogo} logoAlt={displayName} />}
 <div ref={messagesEndRef} />
 </div>
 )}
 </div>

 {/* ── INPUT BAR ── */}
 <div style={{ background: CARD, borderTop: `1px solid ${BORDER}`, padding: "8px 12px 20px", flexShrink: 0 }}>
 {resting && (
 <div style={{ textAlign: "center", fontSize: 11, color: TEXT2, padding: "0 8px 8px", lineHeight: 1.5 }}>
 {capReached === 'query'
 ? "You've reached this month's AI question limit for your ministry. It resets on the 1st — or ask your admin to upgrade for a higher limit."
 : "Resting for a little while — spend some time with God directly. The chat will be ready again soon."}
 </div>
 )}
 <div className="lg:max-w-3xl lg:mx-auto lg:w-full" style={{ display: "flex", alignItems: "center", gap: 8, background: BG, borderRadius: 99, border: `1.5px solid ${BORDER}`, padding: "0 6px 0 16px", minHeight: 44 }}>
 <textarea
 ref={inputRef}
 value={input}
 onChange={(e) => { setInput(e.target.value); if (resting) { setResting(false); setCapReached(null); } e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"; }}
 onKeyDown={handleKeyDown}
 placeholder="Ask about Scripture, theology, prayer..."
 rows={1}
 style={{ flex: 1, border: "none", background: "transparent", color: TEXT, fontSize: 14, fontFamily: "inherit", lineHeight: 1.5, maxHeight: 100, overflowY: "auto", padding: "10px 0", verticalAlign: "middle" }}
 />
 <button onClick={() => sendMessage(input)} disabled={!input.trim() || typing || resting}
 style={{ width: 34, height: 34, borderRadius: 99, background: input.trim() && !typing && !resting ? GOLD_BTN : BORDER, border: "none", cursor: input.trim() && !typing && !resting ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.2s", boxShadow: input.trim() && !typing && !resting ? "0 2px 8px color-mix(in srgb, var(--brand-color, #C9963A) 35%, transparent)" : "none" }}>
 <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
 <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
 </svg>
 </button>
 </div>
 {/* Desktop-only disclaimer line, per the Harvest Member App design. */}
 <p className="hidden lg:block" style={{ textAlign: "center", fontSize: 11, color: TEXT2, margin: "8px auto 0", maxWidth: "48rem", lineHeight: 1.5 }}>
 {`Ask ${askBrandName} can make mistakes. Verify important details with Scripture.`}
 </p>
 </div>
 </div>
 </div>
 );
}
