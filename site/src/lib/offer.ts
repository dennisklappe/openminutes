export interface Tier {
  id: 'solo' | 'team' | 'company';
  concurrent: number;
  monthly: number;
  who: string;
  common?: boolean;
}

export const tiers: Tier[] = [
  { id: 'solo', concurrent: 1, monthly: 9, who: 'Just you' },
  { id: 'team', concurrent: 3, monthly: 20, who: 'A small team', common: true },
  { id: 'company', concurrent: 10, monthly: 59, who: 'A whole company' },
];

export const lowestPrice = Math.min(...tiers.map((t) => t.monthly));
export const productName = 'OpenMinutes Hosted';
