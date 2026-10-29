export type FollowUp = { type: 'community' | 'product'; id: string; productKind?: 'digital' };
export function parseFollowUp(value: unknown): FollowUp | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid follow-up');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).filter(key => key !== 'productKind').sort().join(',') !== 'id,type' || !['community', 'product'].includes(String(item.type)) ||
      (item.productKind !== undefined && (item.type !== 'product' || item.productKind !== 'digital')) ||
      typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(item.id)) throw new Error('Invalid follow-up');
  return item as FollowUp;
}
