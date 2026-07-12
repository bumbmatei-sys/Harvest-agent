"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactPlayer from "react-player/youtube";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize } from "lucide-react";
import { GOLD } from "../../utils/course.constants";

interface LessonVideoPlayerProps {
  url: string;
}

const CONTROLS_HIDE_DELAY = 2500;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function LessonVideoPlayer({ url }: LessonVideoPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const playerRef = useRef<ReactPlayer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHideControls = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_DELAY);
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (playing) scheduleHideControls();
  }, [playing, scheduleHideControls]);

  useEffect(() => {
    if (playing) {
      scheduleHideControls();
    } else if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [playing, scheduleHideControls]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p);
    showControls();
  }, [showControls]);

  const handleSurfaceTap = useCallback(() => {
    setControlsVisible((v) => {
      const next = !v;
      if (next && playing) scheduleHideControls();
      return next;
    });
  }, [playing, scheduleHideControls]);

  const handleProgress = useCallback((state: { played: number; playedSeconds: number }) => {
    if (!seeking) setPlayed(state.played);
  }, [seeking]);

  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPlayed(parseFloat(e.target.value));
  }, []);

  const commitSeek = useCallback((e: React.SyntheticEvent<HTMLInputElement>) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    setSeeking(false);
    playerRef.current?.seekTo(value, "fraction");
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setVolume(value);
    setMuted(value === 0);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  if (!url) {
    return (
      <div className="relative w-full bg-black lg:rounded-[var(--ds-radius-card)] lg:overflow-hidden lg:mt-4" style={{ aspectRatio: "16/9" }}>
        <div className="w-full h-full flex flex-col items-center justify-center text-warm-brown">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2 text-warm-brown">
            <rect x="2" y="3" width="20" height="14" rx="2" /><path d="m8 21 4-4 4 4" />
          </svg>
          <span className="text-sm font-medium">No video content</span>
        </div>
      </div>
    );
  }

  const playedPct = played * 100;
  const volumePct = (muted ? 0 : volume) * 100;

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-black lg:rounded-[var(--ds-radius-card)] lg:overflow-hidden lg:mt-4 select-none"
      style={{ aspectRatio: "16/9" }}
      onMouseMove={showControls}
      onClick={handleSurfaceTap}
    >
      <ReactPlayer
        ref={playerRef}
        url={url}
        width="100%"
        height="100%"
        controls={false}
        playing={playing}
        volume={muted ? 0 : volume}
        muted={muted}
        progressInterval={200}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onProgress={handleProgress}
        onDuration={setDuration}
        onEnded={() => setPlaying(false)}
        config={{
          playerVars: {
            modestbranding: 1,
            rel: 0,
          },
        }}
      />

      {/* Center play/pause toggle */}
      {!playing && (
        <button
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          aria-label="Play"
          className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-black/50 ring-2 flex items-center justify-center pointer-events-auto"
          style={{ ["--tw-ring-color" as string]: GOLD, color: GOLD }}
        >
          <Play size={28} fill="currentColor" className="ml-1" />
        </button>
      )}

      {/* Bottom control bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-0 left-0 right-0 px-3 pb-2 pt-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-200 ${
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.0005}
          value={played}
          onChange={handleSeekChange}
          onMouseDown={() => setSeeking(true)}
          onTouchStart={() => setSeeking(true)}
          onMouseUp={commitSeek}
          onTouchEnd={commitSeek}
          aria-label="Seek"
          className="lvp-range lvp-range-seek w-full mb-1"
          style={{
            background: `linear-gradient(to right, ${GOLD} 0%, ${GOLD} ${playedPct}%, rgba(255,255,255,0.3) ${playedPct}%, rgba(255,255,255,0.3) 100%)`,
          }}
        />

        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10"
          >
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
          </button>

          <div className="text-[11px] text-white/90 font-medium tabular-nums flex-shrink-0">
            {formatTime(played * duration)} / {formatTime(duration)}
          </div>

          <div className="flex-1" />

          <button
            onClick={toggleMute}
            aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10"
          >
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={handleVolumeChange}
            aria-label="Volume"
            className="lvp-range lvp-range-volume hidden sm:block w-16 mr-1"
            style={{
              background: `linear-gradient(to right, ${GOLD} 0%, ${GOLD} ${volumePct}%, rgba(255,255,255,0.3) ${volumePct}%, rgba(255,255,255,0.3) 100%)`,
            }}
          />

          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10"
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>

      <style jsx>{`
        .lvp-range {
          -webkit-appearance: none;
          appearance: none;
          background-color: transparent;
          outline: none;
          cursor: pointer;
        }
        /* Touch target is the full input height (>=40px); the visible bar is
           a thin centered track drawn via the pseudo-track/thumb below. */
        .lvp-range-seek {
          height: 40px;
        }
        .lvp-range-volume {
          height: 40px;
        }
        .lvp-range::-webkit-slider-runnable-track {
          height: 4px;
          border-radius: 9999px;
          background: inherit;
        }
        .lvp-range::-moz-range-track {
          height: 4px;
          border-radius: 9999px;
          background: inherit;
        }
        .lvp-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          margin-top: -6px;
          border-radius: 9999px;
          background: #fff;
          box-shadow: 0 0 0 2px ${GOLD};
          cursor: pointer;
        }
        .lvp-range::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border: none;
          border-radius: 9999px;
          background: #fff;
          box-shadow: 0 0 0 2px ${GOLD};
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
