"use client";
import React, { useState } from "react";
import { GOLD, GOLD_LIGHT } from "../../utils/course.constants";
import { authFetch } from "../../utils/auth-fetch";

interface CertificateDownloadProps {
  courseId: string;
  courseTitle: string;
}

/**
 * "Download certificate" action shown on a completed course. It only calls the
 * server route with the courseId — the authenticated learner is taken from the
 * token there, and the server independently re-verifies completion before
 * issuing. On success it opens the short-lived signed URL to the private PDF;
 * it never receives (or trusts) a public path.
 */
export function CertificateDownload({ courseId, courseTitle }: CertificateDownloadProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/certificate", {
        method: "POST",
        body: JSON.stringify({ courseId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setError(data.error || "Could not generate your certificate.");
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Could not generate your certificate.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="rounded-xl border p-4 mb-5 flex items-center gap-3"
      style={{ background: GOLD_LIGHT, borderColor: GOLD }}
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
        style={{ background: "#fff", color: GOLD, border: `1.5px solid ${GOLD}` }}
      >
        ✦
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-earth">Course complete</div>
        <div className="text-xs text-warm-brown mt-0.5">
          Download your certificate of completion.
        </div>
        {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
      </div>
      <button
        onClick={download}
        disabled={loading}
        className="px-4 py-2 rounded-lg text-white text-[13px] font-bold cursor-pointer disabled:opacity-60 flex-shrink-0"
        style={{ background: GOLD }}
        aria-label={`Download certificate for ${courseTitle}`}
      >
        {loading ? "Preparing…" : "Download"}
      </button>
    </div>
  );
}
