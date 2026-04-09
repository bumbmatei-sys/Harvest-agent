import { useState, useRef, useEffect, KeyboardEvent } from "react";
import Image from "next/image";
import ReactMarkdown from 'react-markdown';
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, deleteDoc, onSnapshot } from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";


enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });

// ─────────────────────────────────────────────
// HARVEST — AI Chat Interface (TypeScript)
// Mobile-first, matches Harvest design system
// ─────────────────────────────────────────────

const GOLD = "#C9963A";
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
function TypingIndicator() {
 return (
 <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "4px 0" }}>
 <div style={{ width: 32, height: 32, borderRadius: "50%", background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, overflow: "hidden" }}>
 <Image src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png" alt="Harvest Logo" width={20} height={20} className="object-contain" />
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
}

function MessageBubble({ message }: MessageBubbleProps) {
 const isUser = message.role === "user";
 return (
 <div style={{ display: "flex", flexDirection: isUser ? "row-reverse" : "row", alignItems: "flex-end", gap: 8, marginBottom: 4 }}>
 {!isUser && (
 <div style={{ width: 32, height: 32, borderRadius: "50%", background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, overflow: "hidden" }}>
 <Image src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png" alt="Harvest Logo" width={20} height={20} className="object-contain" />
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
 <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: 17, color: TEXT }}>Chat History</div>
 <div style={{ fontSize: 11, color: TEXT2, marginTop: 2 }}>{history.length} conversation{history.length !== 1 ? "s" : ""}</div>
 </div>
 <button onClick={onClose} style={{ background: BG, border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
 </div>

 {/* New Chat Button */}
 <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}` }}>
 <button onClick={onNewChat}
 style={{ width: "100%", background: GOLD_BTN, border: "none", color: "#fff", fontWeight: 700, padding: "11px", borderRadius: 12, cursor: "pointer", fontSize: 14, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 2px 8px rgba(201,150,58,0.35)" }}>
 <span style={{ fontSize: 18 }}>✦</span> New Chat
 </button>
 </div>

 {/* List */}
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
 <div onClick={() => { onSelect(chat); onClose(); }} style={{ flex: 1, cursor: "pointer", minWidth: 0 }}>
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
 </div>
 </>
 );
}

// ═══════════════════════════════════════════════
// MAIN AI CHAT
// ═══════════════════════════════════════════════
export default function AIChat({ onBack }: { onBack?: () => void }) {
 const [history, setHistory] = useState<Chat[]>([]);
 const [activeChat, setActiveChat] = useState<Chat | null>(null);
 const [messages, setMessages] = useState<Message[]>([]);
 const [input, setInput] = useState<string>("");
 const [typing, setTyping] = useState<boolean>(false);
 const [showHistory, setShowHistory] = useState<boolean>(false);
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
 // 1. Embed the query
 const result = await ai.models.embedContent({
 model: 'gemini-embedding-2-preview',
 contents: [queryText],
 });
 
 const queryVector = result.embeddings?.[0]?.values;
 if (!queryVector) return [];

 // 2. Fetch all chunks (for a small knowledge base this is fine)
 // For larger DBs, we'd need a proper vector search extension or backend
 const chunksSnap = await getDocs(collection(db, "rag_chunks"));
 
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
 handleFirestoreError(error, OperationType.GET, `rag_chunks`);
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

 const systemInstruction = `You are Harvest AI, a helpful, knowledgeable, and faithful assistant for a church app. 
You answer questions about Scripture, theology, prayer, and the church's specific teachings.
Answer ONLY using the provided context if it is relevant. If the context doesn't contain the answer, you can use your general knowledge but keep it biblically sound and encouraging.
If the user asks something completely unrelated to faith, politely guide them back to spiritual topics.`;

 // 3. Call Gemini API
 const chatHistory = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
 
 const prompt = `${contextStr}\n\nChat History:\n${chatHistory}\n\nUser: ${text}`;

 const response = await ai.models.generateContent({
 model: "gemini-3-flash-preview",
 contents: prompt,
 config: {
 systemInstruction,
 }
 });

 const aiText = response.text || "I'm sorry, I couldn't generate a response.";
 
 const aiMsg: Message = { id: uid(), role: "ai", text: aiText, time: now() };
 const finalMessages = [...newMessages, aiMsg];
 setMessages(finalMessages);

 // Save / update chat history
 const title = text.length > 40 ? text.slice(0, 40) + "…" : text;
 if (activeChat) {
 const updated = { ...activeChat, messages: finalMessages, preview: text };
 setActiveChat(updated);
 setHistory((h) => h.map((c) => c.id === updated.id ? updated : c));
 } else {
 const newChat: Chat = { id: uid(), title, preview: text, date: new Date().toISOString(), messages: finalMessages };
 setActiveChat(newChat);
 setHistory((h) => [newChat, ...h]);
 }
 } catch (error) {
 console.error("Error generating response:", error);
 const errorMsg: Message = { id: uid(), role: "ai", text: "I'm sorry, I encountered an error while trying to answer your question. Please try again later.", time: now() };
 setMessages([...newMessages, errorMsg]);
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
 <div style={{ fontFamily: "'Nunito', sans-serif", background: BG, height: "100%", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
 <style>{`
 @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');
 :root {
 --chat-bg: #F2F4F7;
 --chat-card: #FFFFFF;
 --chat-text: #111111;
 --chat-text2: #6B7280;
 --chat-border: #E8E8E8;
 --chat-gold-light: #FBF3E4;
 --chat-gold-btn: linear-gradient(135deg, #C9963A, #D4A843);
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
 color: #C9963A;
 text-decoration: underline;
 }
 `}</style>

 {/* History Panel */}
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

 {/* ── TOP BAR ── */}
 <div style={{ background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", flexShrink: 0, zIndex: 10 }}>
 {/* Back */}
 <button onClick={onBack} style={{ background: "none", border: "none", color: GOLD, cursor: "pointer", fontSize: 22, padding: 0, display: "flex", alignItems: "center", lineHeight: 1 }}>
 ←
 </button>

 {/* Center title */}
 <div style={{ textAlign: "center", flex: 1 }}>
 <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: 16, color: TEXT }}>
 Harvest AI
 </div>
 </div>

 {/* History icon button */}
 <button onClick={() => setShowHistory(true)}
 style={{ background: "none", border: "none", cursor: "pointer", padding: 6, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
 <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
 <path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" />
 </svg>
 </button>
 </div>

 {/* ── MESSAGES ── */}
 <div style={{ flex: 1, overflowY: "auto", padding: isEmpty ? 0 : "16px 16px 8px", display: "flex", flexDirection: "column" }}>
 {/* Empty state */}
 {isEmpty && (
 <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", animation: "fadeSlideUp 0.4s ease" }}>
 <div style={{ width: 72, height: 72, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, marginBottom: 16 }}>
 <Image src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png" alt="Harvest Logo" width={60} height={60} className="object-contain drop-shadow-md" />
 </div>
 <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: 22, color: TEXT, marginBottom: 6, textAlign: "center" }}>Ask me anything</div>
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
 <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
 {messages.map((msg) => (
 <div key={msg.id} style={{ animation: "fadeSlideUp 0.3s ease" }}>
 <MessageBubble message={msg} />
 </div>
 ))}
 {typing && <TypingIndicator />}
 <div ref={messagesEndRef} />
 </div>
 )}
 </div>

 {/* ── INPUT BAR ── */}
 <div style={{ background: CARD, borderTop: `1px solid ${BORDER}`, padding: "8px 12px 20px", flexShrink: 0 }}>
 <div style={{ display: "flex", alignItems: "center", gap: 8, background: BG, borderRadius: 99, border: `1.5px solid ${BORDER}`, padding: "0 6px 0 16px", minHeight: 44 }}>
 <textarea
 ref={inputRef}
 value={input}
 onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"; }}
 onKeyDown={handleKeyDown}
 placeholder="Ask about Scripture, theology, prayer..."
 rows={1}
 style={{ flex: 1, border: "none", background: "transparent", color: TEXT, fontSize: 14, fontFamily: "inherit", lineHeight: 1.5, maxHeight: 100, overflowY: "auto", padding: "10px 0", verticalAlign: "middle" }}
 />
 <button onClick={() => sendMessage(input)} disabled={!input.trim() || typing}
 style={{ width: 34, height: 34, borderRadius: 99, background: input.trim() && !typing ? GOLD_BTN : BORDER, border: "none", cursor: input.trim() && !typing ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.2s", boxShadow: input.trim() && !typing ? "0 2px 8px rgba(201,150,58,0.35)" : "none" }}>
 <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
 <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
 </svg>
 </button>
 </div>
 </div>
 </div>
 );
}
