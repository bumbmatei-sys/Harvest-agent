"use client";
import React, { useState, useEffect } from 'react';

interface OnboardingQuestion {
  id: string;
  label: string;
  type: 'text' | 'select' | 'radio' | 'textarea';
  options?: string[];
  required: boolean;
  order: number;
}

const DEFAULT_ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  { id: 'default_name', label: 'Full Name', type: 'text', required: true, order: 0 },
  { id: 'default_country', label: 'Country', type: 'select', required: true, order: 1, options: [] },
  { id: 'default_city', label: 'City', type: 'text', required: true, order: 2 },
  { id: 'default_phone', label: 'Phone Number', type: 'text', required: true, order: 3 },
  { id: 'default_accepted_jesus', label: 'Have you accepted Jesus?', type: 'radio', required: true, order: 4, options: ['Yes', 'No'] },
];

const questionTypeOptions: { value: 'text' | 'select' | 'radio' | 'textarea'; label: string }[] = [
  { value: 'text', label: 'Text Input' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Radio Buttons' },
];

const OnboardingSection: React.FC = () => {
  const [onboardingQuestions, setOnboardingQuestions] = useState<OnboardingQuestion[]>([]);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingSaved, setOnboardingSaved] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<OnboardingQuestion | null>(null);
  const [showQuestionModal, setShowQuestionModal] = useState(false);

  // Load onboarding questions from tenant doc
  useEffect(() => {
    const loadOnboardingQuestions = async () => {
      if (onboardingLoaded) return;
      try {
        const { auth, db } = await import('../../firebase');
        const { doc, getDoc } = await import('firebase/firestore');
        if (auth.currentUser) {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists()) {
            const tenantId = userDoc.data().tenantId;
            if (tenantId) {
              const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
              if (tenantDoc.exists()) {
                const config = tenantDoc.data().config || {};
                if (config.onboardingInitialized) {
                  if (config.onboardingQuestions && Array.isArray(config.onboardingQuestions) && config.onboardingQuestions.length > 0) {
                    setOnboardingQuestions(config.onboardingQuestions.sort((a: any, b: any) => a.order - b.order));
                  } else {
                    setOnboardingQuestions([]);
                  }
                } else {
                  setOnboardingQuestions(DEFAULT_ONBOARDING_QUESTIONS);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to load onboarding questions:', e);
      }
      setOnboardingLoaded(true);
    };
    loadOnboardingQuestions();
  }, []);

  const addQuestion = () => {
    const newQ: OnboardingQuestion = {
      id: `custom_${Date.now()}`,
      label: '',
      type: 'text',
      options: [],
      required: false,
      order: onboardingQuestions.length,
    };
    setEditingQuestion(newQ);
    setShowQuestionModal(true);
  };

  const editQuestion = (q: OnboardingQuestion) => {
    setEditingQuestion({ ...q });
    setShowQuestionModal(true);
  };

  const deleteQuestion = (id: string) => {
    setOnboardingQuestions(prev => prev.filter(q => q.id !== id).map((q, i) => ({ ...q, order: i })));
  };

  const moveQuestion = (index: number, direction: 'up' | 'down') => {
    const newQuestions = [...onboardingQuestions];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newQuestions.length) return;
    [newQuestions[index], newQuestions[targetIndex]] = [newQuestions[targetIndex], newQuestions[index]];
    setOnboardingQuestions(newQuestions.map((q, i) => ({ ...q, order: i })));
  };

  const saveQuestion = () => {
    if (!editingQuestion || !editingQuestion.label.trim()) return;
    const exists = onboardingQuestions.find(q => q.id === editingQuestion.id);
    if (exists) {
      setOnboardingQuestions(prev => prev.map(q => q.id === editingQuestion.id ? editingQuestion : q));
    } else {
      setOnboardingQuestions(prev => [...prev, editingQuestion]);
    }
    setShowQuestionModal(false);
    setEditingQuestion(null);
  };

  const saveAllQuestions = async () => {
    setOnboardingSaving(true);
    setOnboardingSaved(false);
    try {
      const { auth, db } = await import('../../firebase');
      const { doc, getDoc, updateDoc } = await import('firebase/firestore');
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const tenantId = userDoc.data().tenantId;
          if (tenantId) {
            await updateDoc(doc(db, 'tenants', tenantId), {
              'config.onboardingQuestions': onboardingQuestions,
              'config.onboardingInitialized': true,
              updatedAt: new Date().toISOString(),
            });
            setOnboardingSaved(true);
            setTimeout(() => setOnboardingSaved(false), 3000);
          }
        }
      }
    } catch (e) {
      console.error('Failed to save onboarding questions:', e);
      alert('Failed to save onboarding questions. Please try again.');
    } finally {
      setOnboardingSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-gray-600">
        These are the questions new members see when signing up. Edit, reorder, or delete any question. Add your own custom questions below.
      </p>

      {/* Add Question Button */}
      <button
        onClick={addQuestion}
        className="px-4 py-2 bg-gold text-white rounded-xl text-sm font-semibold hover:bg-gold transition-colors"
      >
        + Add Question
      </button>

      {/* Questions List */}
      {onboardingQuestions.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <p className="text-gray-400 text-sm">No custom questions yet. Click &quot;Add Question&quot; to create one.</p>
        </div>
      )}

      {onboardingQuestions.map((q, index) => (
        <div key={q.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-4">
          <div className="flex flex-col gap-1 pt-1">
            <button onClick={() => moveQuestion(index, 'up')} disabled={index === 0} className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs">▲</button>
            <button onClick={() => moveQuestion(index, 'down')} disabled={index === onboardingQuestions.length - 1} className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs">▼</button>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-bold text-gray-900">{q.label || '(Untitled)'}</span>
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{q.type}</span>
              {q.required && <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">Required</span>}
            </div>
            {(q.type === 'select' || q.type === 'radio') && q.options && q.options.length > 0 && (
              <p className="text-xs text-gray-400">Options: {q.options.join(', ')}</p>
            )}
            {q.id === 'default_country' && (
              <p className="text-xs text-blue-500 mt-1">🔍 Renders as searchable country picker in signup form</p>
            )}
            {q.id === 'default_accepted_jesus' && (
              <p className="text-xs text-gray-400 mt-1">Options: Yes, No (fixed)</p>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => editQuestion(q)} className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">Edit</button>
            <button onClick={() => deleteQuestion(q.id)} className="px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">Delete</button>
          </div>
        </div>
      ))}

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={saveAllQuestions}
          disabled={onboardingSaving}
          className="px-6 py-2.5 bg-gold text-white rounded-xl text-sm font-semibold hover:bg-gold transition-colors disabled:opacity-50"
        >
          {onboardingSaving ? 'Saving...' : 'Save Questions'}
        </button>
        {onboardingSaved && (
          <span className="text-sm text-green-600 font-medium">✓ Questions saved successfully</span>
        )}
      </div>

      {/* Question Editor Modal */}
      {showQuestionModal && editingQuestion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              {onboardingQuestions.find(q => q.id === editingQuestion.id) ? 'Edit Question' : 'Add Question'}
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
              <input
                type="text"
                value={editingQuestion.label}
                onChange={(e) => setEditingQuestion({ ...editingQuestion, label: e.target.value })}
                placeholder="e.g. What is your favorite verse?"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={editingQuestion.type}
                onChange={(e) => setEditingQuestion({ ...editingQuestion, type: e.target.value as any })}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              >
                {questionTypeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {(editingQuestion.type === 'select' || editingQuestion.type === 'radio') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Options (comma-separated)</label>
                <input
                  type="text"
                  value={(editingQuestion.options || []).join(', ')}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  placeholder="e.g. Option A, Option B, Option C"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                />
              </div>
            )}

            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Required</label>
              <button
                onClick={() => setEditingQuestion({ ...editingQuestion, required: !editingQuestion.required })}
                className={`w-10 h-6 rounded-full relative transition-colors ${editingQuestion.required ? 'bg-gold' : 'bg-gray-200'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${editingQuestion.required ? 'left-5' : 'left-1'}`} />
              </button>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => { setShowQuestionModal(false); setEditingQuestion(null); }}
                className="px-4 py-2 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveQuestion}
                disabled={!editingQuestion.label.trim()}
                className="px-4 py-2 bg-gold text-white rounded-xl text-sm font-semibold hover:bg-gold transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnboardingSection;
