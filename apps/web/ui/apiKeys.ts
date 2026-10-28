import type { ApiKeyDto } from '../src/dto.js';
import { formatDate } from './format.js';

export const EXPIRY_CHOICES = [
  { value: 'never', label: 'Never', days: null },
  { value: '30', label: '30 days', days: 30 },
  { value: '90', label: '90 days', days: 90 },
  { value: '365', label: '1 year', days: 365 },
] as const;

export const scopeLabel = (scope: ApiKeyDto['scope']) => (scope === 'read' ? 'Read only' : 'Full');

export function expiryText(key: ApiKeyDto, now = Date.now()): string {
  if (!key.expiresAt) return 'Never expires';
  const expired = new Date(key.expiresAt).getTime() <= now;
  return `${expired ? 'Expired' : 'Expires'} ${formatDate(key.expiresAt)}`;
}

export const lastUsedText = (key: ApiKeyDto) =>
  key.lastUsedAt ? `Last used ${formatDate(key.lastUsedAt)}` : 'Never used';
