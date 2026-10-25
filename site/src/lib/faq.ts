export interface Faq {
  q: string;
  a: string;
}

export function faqJsonLd(items: Faq[]): object {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
