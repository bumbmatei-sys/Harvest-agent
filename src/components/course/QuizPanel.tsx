"use client";
import React, { useState } from "react";
import { QuizQuestion, QuizAttempt } from "../../types/course.types";
import { GOLD } from "../../utils/course.constants";
import { isQuizPassing } from "../../utils/course.utils";

interface QuizPanelProps {
  quiz: QuizQuestion[];
  attempt?: QuizAttempt;
  onSubmit: (attempt: QuizAttempt) => void;
}

// Presentational only — scoring happens here, but persistence is owned by
// the parent (mirrors LessonView's onComplete pattern). A submitted attempt
// only ever stores { score, total, passed, answeredAt }, not per-question
// answers, so a reloaded page can show the last score but not re-highlight
// which options were picked — that's why "result" here has two flavors:
// freshly answered this session (full highlighting) vs. loaded from a past
// attempt (score summary + Retake).
export function QuizPanel({ quiz, attempt, onSubmit }: QuizPanelProps) {
  const [mode, setMode] = useState<"answering" | "result">(attempt ? "result" : "answering");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [hasLocalAnswers, setHasLocalAnswers] = useState(false);

  const allAnswered = quiz.every((q) => selected[q.id]);

  const handleSelect = (questionId: string, optionId: string) => {
    if (mode !== "answering") return;
    setSelected((prev) => ({ ...prev, [questionId]: optionId }));
  };

  const score = quiz.reduce((n, q) => {
    const chosen = q.options.find((o) => o.id === selected[q.id]);
    return chosen?.correct ? n + 1 : n;
  }, 0);

  const handleSubmit = () => {
    if (!allAnswered) return;
    const result: QuizAttempt = {
      score,
      total: quiz.length,
      passed: isQuizPassing(score, quiz.length),
      answeredAt: new Date().toISOString(),
    };
    setHasLocalAnswers(true);
    setMode("result");
    onSubmit(result);
  };

  const handleRetry = () => {
    setSelected({});
    setHasLocalAnswers(false);
    setMode("answering");
  };

  // Loaded from a past attempt, nothing answered yet this session — show a
  // compact summary rather than blank/unselected questions.
  if (mode === "result" && !hasLocalAnswers && attempt) {
    return (
      <div className="py-5">
        <div className={`rounded-lg border p-4 mb-4 ${attempt.passed ? "bg-green-50 border-green-500" : "bg-stone-50 border-stone-200"}`}>
          <div className={`text-sm font-bold ${attempt.passed ? "text-green-600" : "text-earth"}`}>
            {attempt.passed ? "Passed ✓" : "Not passed yet"}
          </div>
          <div className="text-xs text-[color:var(--text-faint)] mt-0.5">
            Last attempt: {attempt.score} / {attempt.total} correct
          </div>
        </div>
        <button
          onClick={handleRetry}
          className="w-full py-3 rounded-lg bg-stone-100 border border-stone-200 text-warm-brown text-[13px] font-semibold cursor-pointer hover:bg-stone-200 transition-colors"
        >
          Retake Quiz
        </button>
      </div>
    );
  }

  return (
    <div className="py-5">
      {mode === "result" && (
        <div className={`rounded-lg border p-4 mb-4 ${isQuizPassing(score, quiz.length) ? "bg-green-50 border-green-500" : "bg-stone-50 border-stone-200"}`}>
          <div className={`text-sm font-bold ${isQuizPassing(score, quiz.length) ? "text-green-600" : "text-earth"}`}>
            {score} / {quiz.length} correct
          </div>
          <div className="text-xs text-[color:var(--text-faint)] mt-0.5">
            {isQuizPassing(score, quiz.length) ? "Nice work!" : "Give it another try — you've got this."}
          </div>
        </div>
      )}

      <div className="space-y-5">
        {quiz.map((question, qi) => (
          <div key={question.id}>
            <div className="text-sm font-bold text-earth mb-2.5">{qi + 1}. {question.q}</div>
            <div className="space-y-2">
              {question.options.map((option) => {
                const isSelected = selected[question.id] === option.id;
                let optionClass = "border-stone-200 hover:bg-stone-50";
                if (mode === "result") {
                  if (option.correct) {
                    optionClass = "border-green-500 bg-green-50 text-green-600";
                  } else if (isSelected) {
                    optionClass = "border-red-500 bg-red-50 text-red-600";
                  } else {
                    optionClass = "border-stone-200 opacity-60";
                  }
                } else if (isSelected) {
                  optionClass = "border-amber-600 bg-[#FBF3E4]";
                }
                return (
                  <button
                    key={option.id}
                    disabled={mode === "result"}
                    onClick={() => handleSelect(question.id, option.id)}
                    className={`w-full text-left px-3.5 py-3 rounded-lg border text-sm font-medium flex items-center justify-between gap-2 transition-colors ${
                      mode === "result" ? "" : "cursor-pointer"
                    } ${optionClass}`}
                  >
                    <span>{option.text}</span>
                    {mode === "result" && option.correct && <span className="text-green-600 flex-shrink-0">✓</span>}
                    {mode === "result" && isSelected && !option.correct && <span className="text-red-600 flex-shrink-0">✕</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        {mode === "answering" ? (
          <>
            <button
              onClick={handleSubmit}
              disabled={!allAnswered}
              className={`w-full py-3.5 rounded-lg text-sm font-bold transition-all ${
                allAnswered ? "text-white cursor-pointer" : "bg-stone-100 text-[color:var(--text-faint)] cursor-not-allowed"
              }`}
              style={allAnswered ? { background: GOLD } : undefined}
            >
              Submit Quiz
            </button>
            {!allAnswered && (
              <div className="text-xs text-center text-[color:var(--text-faint)] mt-2">
                Answer all {quiz.length} questions to submit
              </div>
            )}
          </>
        ) : (
          <button
            onClick={handleRetry}
            className="w-full py-3 rounded-lg bg-stone-100 border border-stone-200 text-warm-brown text-[13px] font-semibold cursor-pointer hover:bg-stone-200 transition-colors"
          >
            Retry Quiz
          </button>
        )}
      </div>
    </div>
  );
}
