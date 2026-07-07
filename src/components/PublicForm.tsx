"use client";
import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

export interface PublicFormField {
  id: string;
  type: 'short_text' | 'long_text' | 'email' | 'phone' | 'number' | 'dropdown' | 'radio' | 'checkbox' | 'date';
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

interface PublicFormProps {
  tenantId: string;
  tenantName: string;
  logo: string | null;
  primaryColor: string;
  formId: string;
  title: string;
  description: string;
  successMessage: string;
  fields: PublicFormField[];
}

const PublicForm: React.FC<PublicFormProps> = ({
  tenantId, tenantName, logo, primaryColor, formId, title, description, successMessage, fields,
}) => {
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAnswer = (id: string, value: any) => setAnswers((a) => ({ ...a, [id]: value }));

  const toggleCheckbox = (id: string, option: string) => {
    setAnswers((a) => {
      const current: string[] = Array.isArray(a[id]) ? a[id] : [];
      return { ...a, [id]: current.includes(option) ? current.filter((o) => o !== option) : [...current, option] };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate required fields
    for (const f of fields) {
      if (f.required) {
        const v = answers[f.id];
        const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
        if (empty) {
          setError(`Please fill in "${f.label}".`);
          return;
        }
      }
    }
    setError(null);
    setSubmitting(true);
    try {
      const resp = await fetch('/api/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, formId, answers }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Submission failed');
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent';
  const ring = { '--tw-ring-color': primaryColor } as React.CSSProperties;

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F6F3] p-6">
        <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-8 max-w-md text-center">
          <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: primaryColor }} />
          <h1 className="font-display text-xl font-bold text-gray-900 mb-2">{successMessage}</h1>
          <p className="text-sm text-gray-400 mt-4">{tenantName}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F6F3] py-10 px-4">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-6">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={tenantName} className="h-12 mx-auto mb-3 object-contain" />
          ) : (
            <div className="font-display text-lg font-extrabold mb-3" style={{ color: primaryColor }}>{tenantName}</div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-6" style={{ paddingBottom: 120 }}>
          <h1 className="font-display text-2xl font-bold text-gray-900 mb-1">{title}</h1>
          {description && <p className="text-sm text-gray-500 mb-6">{description}</p>}

          <div className="space-y-5 mt-4">
            {fields.map((f) => (
              <div key={f.id}>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>

                {f.type === 'long_text' ? (
                  <textarea rows={4} className={inputCls} style={ring} placeholder={f.placeholder}
                    value={answers[f.id] || ''} onChange={(e) => setAnswer(f.id, e.target.value)} />
                ) : f.type === 'dropdown' ? (
                  <select className={inputCls} style={ring} value={answers[f.id] || ''} onChange={(e) => setAnswer(f.id, e.target.value)}>
                    <option value="">Select…</option>
                    {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.type === 'radio' ? (
                  <div className="space-y-2">
                    {(f.options || []).map((o) => (
                      <label key={o} className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="radio" name={f.id} value={o} checked={answers[f.id] === o} onChange={() => setAnswer(f.id, o)} />
                        {o}
                      </label>
                    ))}
                  </div>
                ) : f.type === 'checkbox' ? (
                  <div className="space-y-2">
                    {(f.options || []).map((o) => (
                      <label key={o} className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={Array.isArray(answers[f.id]) && answers[f.id].includes(o)} onChange={() => toggleCheckbox(f.id, o)} />
                        {o}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    className={inputCls}
                    style={ring}
                    placeholder={f.placeholder}
                    value={answers[f.id] || ''}
                    onChange={(e) => setAnswer(f.id, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full py-3 rounded-xl text-white font-semibold disabled:opacity-50"
            style={{ backgroundColor: primaryColor }}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PublicForm;
