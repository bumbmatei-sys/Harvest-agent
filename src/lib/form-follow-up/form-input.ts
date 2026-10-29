/** Keep a form comfortably below Firestore's document limit, including UTF-8 text. */
export const MAX_FORM_BYTES = 256 * 1024;
const FIELD_TYPES = new Set(['short_text', 'long_text', 'email', 'phone', 'number', 'dropdown', 'radio', 'checkbox', 'date', 'rating', 'scale']);
const FIELD_KEYS = new Set(['id', 'type', 'label', 'placeholder', 'required', 'options', 'order', 'scaleMin', 'scaleMax', 'scaleMinLabel', 'scaleMaxLabel']);
const boundedText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const scaleBound = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10;

/** Reject malformed data rather than passing arbitrary nested maps to the Admin SDK. */
export function validFormContent(body: { title?: unknown; description?: unknown; fields?: unknown }): boolean {
  if (!boundedText(body.title, 200) || !body.title.trim() ||
      !boundedText(body.description, 10000) ||
      !Array.isArray(body.fields) || body.fields.length > 100) return false;
  const ids = new Set<string>();
  return body.fields.every((field: unknown) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return false;
    const f = field as Record<string, unknown>;
    if (Object.keys(f).some(key => !FIELD_KEYS.has(key)) ||
        !boundedText(f.id, 150) || !/^[A-Za-z0-9_-]+$/.test(f.id) || ids.has(f.id) ||
        typeof f.type !== 'string' || !FIELD_TYPES.has(f.type) ||
        !boundedText(f.label, 500) || !f.label.trim() ||
        typeof f.order !== 'number' || !Number.isInteger(f.order) || f.order < 0 || f.order >= 100) return false;
    ids.add(f.id);
    if (f.required !== undefined && typeof f.required !== 'boolean') return false;
    for (const key of ['placeholder', 'scaleMinLabel', 'scaleMaxLabel']) {
      if (f[key] !== undefined && !boundedText(f[key], 500)) return false;
    }
    if (f.options !== undefined && (!Array.isArray(f.options) || f.options.length > 100 || !f.options.every(option => boundedText(option, 500)))) return false;
    for (const key of ['scaleMin', 'scaleMax']) {
      if (f[key] !== undefined && !scaleBound(f[key])) return false;
    }
    if (f.type === 'scale' && (f.scaleMin === undefined ? 1 : f.scaleMin as number) >= (f.scaleMax === undefined ? 10 : f.scaleMax as number)) return false;
    return true;
  });
}
