import React from "react";
import { sanitizeHtml } from "../../utils/sanitize";
import Image from "next/image";
import { ArrowLeft, User, Globe, Camera, Twitter, Mic, Youtube, ArrowRight } from "lucide-react";
import { Author } from "../../types/course.types";
import { BG, BORDER, GOLD, TEXT, CARD, TEXT2 } from "../../utils/course.constants";

interface AuthorProfileViewProps {
  author: Author;
  onBack: () => void;
}

export function AuthorProfile({ author, onBack }: AuthorProfileViewProps) {
  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Nunito', sans-serif" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "linear-gradient(to bottom, #FDF7EC, #F9F0DF)", borderBottom: `1px solid ${BORDER}`, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: TEXT, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700 }}>
          <ArrowLeft size={20} color={GOLD} /> Author Profile
        </button>
      </div>

      <div style={{ background: "linear-gradient(to bottom, #F9F0DF, #F5F6F8)", padding: "40px 16px 32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 100, height: 100, borderRadius: "50%", border: `4px solid ${GOLD}`, overflow: "hidden", position: "relative", marginBottom: 16, background: CARD, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(201,150,58,0.2)" }}>
          {author.picture ? (
            <Image src={author.picture} alt={author.name} fill sizes="100px" style={{ objectFit: "cover" }} referrerPolicy="no-referrer" />
          ) : (
            <User size={40} color={GOLD} />
          )}
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: TEXT, marginBottom: 4, textAlign: "center" }}>{author.name}</h1>
        {author.title && (
          <div style={{ fontSize: 15, fontWeight: 700, color: GOLD, textAlign: "center" }}>{author.title}</div>
        )}
      </div>

      <div style={{ padding: "0 16px 40px", background: "#F5F6F8", minHeight: "calc(100vh - 250px)" }}>
        {author.bio && (
          <div style={{ background: CARD, borderRadius: 16, overflow: "hidden", marginBottom: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, fontSize: 12, fontWeight: 800, color: TEXT2, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              About
            </div>
            <div style={{ padding: "20px", fontSize: 15, color: TEXT2, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(author.bio) }} />
          </div>
        )}

        {author.links && author.links.length > 0 && (
          <div style={{ background: CARD, borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, fontSize: 12, fontWeight: 800, color: TEXT2, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Online Presence
            </div>
            <div>
              {author.links.map((link, i) => {
                const isLast = i === author.links!.length - 1;
                
                // Determine icon based on platform
                let IconComponent = Globe;
                let iconColor = "#0EA5E9";
                let iconBg = "#E0F2FE";
                
                const platformLower = link.platform.toLowerCase();
                if (platformLower.includes("instagram")) {
                  IconComponent = Camera;
                  iconColor = "#4B5563";
                  iconBg = "#F3F4F6";
                } else if (platformLower.includes("twitter") || platformLower.includes("x")) {
                  IconComponent = Twitter;
                  iconColor = "#0EA5E9";
                  iconBg = "#E0F2FE";
                } else if (platformLower.includes("podcast")) {
                  IconComponent = Mic;
                  iconColor = "#0EA5E9";
                  iconBg = "#E0F2FE";
                } else if (platformLower.includes("youtube")) {
                  IconComponent = Youtube;
                  iconColor = "#EF4444";
                  iconBg = "#FEE2E2";
                }

                return (
                  <a key={link.id || i} href={link.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: isLast ? "none" : `1px solid ${BORDER}`, textDecoration: "none" }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 16, border: `1px solid ${GOLD}20` }}>
                      <IconComponent size={20} color={iconColor} />
                    </div>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: TEXT2, marginBottom: 2, textTransform: "uppercase" }}>{link.platform}</div>
                      <div style={{ fontSize: 14, color: GOLD, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{link.url}</div>
                    </div>
                    <ArrowRight size={16} color={BORDER} />
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
