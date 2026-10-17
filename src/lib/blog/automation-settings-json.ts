/**
 * Blog automation settings cross two readers. The admin SDK returns Timestamp
 * objects, and the Firestore REST fallback (used when that SDK cannot read on
 * a preview) returns `{ timestampValue }` fields. Either shape has to become
 * plain JSON before it reaches the panel. One odd field must not 500 the GET.
 */

export function automationSettingsJson(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) return value.map(automationSettingsJson);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const next = automationSettingsJson(item);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

export function decodeFirestoreRestFields(fields: unknown): Record<string, unknown> {
  if (!fields || typeof fields !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    out[key] = decodeFirestoreRestValue(value);
  }
  return out;
}

function decodeFirestoreRestValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if ('stringValue' in record) return record.stringValue ?? '';
  if ('booleanValue' in record) return record.booleanValue === true;
  if ('integerValue' in record) return Number(record.integerValue);
  if ('doubleValue' in record) return Number(record.doubleValue);
  if ('timestampValue' in record) {
    return typeof record.timestampValue === 'string' ? record.timestampValue : null;
  }
  if ('nullValue' in record) return null;
  if ('arrayValue' in record) {
    const values = (record.arrayValue as { values?: unknown[] } | null)?.values ?? [];
    return values.map(decodeFirestoreRestValue);
  }
  if ('mapValue' in record) {
    return decodeFirestoreRestFields((record.mapValue as { fields?: unknown } | null)?.fields);
  }
  return null;
}

/** Path segment for a tenant id. Rejects anything that could change the REST path. */
export function isAutomationTenantId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
