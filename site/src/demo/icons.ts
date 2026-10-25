const svg = (body: string, size = 16) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  meetings: svg(
    '<rect x="2" y="3" width="12" height="10.5" rx="2"/><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4"/>',
  ),
  minutes: svg(
    '<path d="M4 1.8h5.2L12.5 5v8.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1zM9 1.8V5h3.5M5.5 8h5M5.5 10.6h5"/>',
  ),
  record: `<svg class="icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="6.5" y="1.8" width="5" height="9" rx="2.5" fill="currentColor"/><path d="M3.8 8.6a5.2 5.2 0 0 0 10.4 0M9 13.8v2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>`,
  settings: svg(
    '<path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/>',
  ),
  check: svg('<path d="m3 8.5 3.2 3.2L13 4.5"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  pencil: svg('<path d="m10.8 2.7 2.5 2.5L5.4 13.1l-3.2.7.7-3.2zM9.4 4.1l2.5 2.5"/>'),
  link: svg(
    '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.7.7"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.7-.7"/>',
  ),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
  chevron: svg('<path d="m6 3.5 4.5 4.5L6 12.5"/>'),
  clock: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/>'),
  users: svg(
    '<circle cx="6" cy="5.6" r="2.4"/><path d="M1.8 13c.3-2.3 2-3.6 4.2-3.6s3.9 1.3 4.2 3.6M10.6 3.5a2.3 2.3 0 0 1 0 4.4M12.2 9.7c1.2.5 2 1.6 2.2 3.3"/>',
  ),
  building: svg(
    '<path d="M3.5 14V2.8a.8.8 0 0 1 .8-.8h5.4a.8.8 0 0 1 .8.8V14M10.5 6.5h1.7a.8.8 0 0 1 .8.8V14M2 14h12M6 5h2M6 7.6h2M6 10.2h2"/>',
  ),
  folder: svg(
    '<path d="M2 4.2a1 1 0 0 1 1-1h3l1.4 1.6H13a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  ),
  external: svg('<path d="M6.5 3H3v10h10V9.5M9.5 2.5h4v4M13.5 2.5 7.5 8.5"/>', 12),
  download: svg('<path d="M8 2v8.2M4.8 7.2 8 10.4l3.2-3.2M2.5 13.5h11"/>'),
  more: svg(
    '<circle cx="3.5" cy="8" r="0.9" fill="currentColor"/><circle cx="8" cy="8" r="0.9" fill="currentColor"/><circle cx="12.5" cy="8" r="0.9" fill="currentColor"/>',
  ),
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.8v12.4a.6.6 0 0 0 .9.5l10-6.2a.6.6 0 0 0 0-1L4.4 1.3a.6.6 0 0 0-.9.5z"/></svg>',
  pause:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h3.5v12H3zM9.5 2H13v12H9.5z"/></svg>',
  meet: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" class="icon"><rect x="1.5" y="4" width="10" height="10" rx="2.2" fill="#1a9f6b"/><path d="M12.5 7.6 16 5.4a.4.4 0 0 1 .6.35v6.5a.4.4 0 0 1-.6.35l-3.5-2.2z" fill="#2fbf84"/></svg>',
  teams:
    '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" class="icon"><rect x="1.5" y="2.5" width="15" height="13" rx="3.2" fill="#5b5fc7"/><path d="M5.6 6.6h6.8M9 6.6v5.4" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>',
  brand:
    '<svg width="24" height="24" viewBox="0 0 54 54" aria-hidden="true"><rect width="54" height="54" rx="13" class="brand-tile"/><rect x="10" y="12.5" width="19" height="7" rx="3.5" fill="#fff"/><rect x="20" y="23.5" width="24" height="7" rx="3.5" fill="#74a8ef"/><rect x="12" y="34.5" width="13" height="7" rx="3.5" fill="#fff"/></svg>',
};
