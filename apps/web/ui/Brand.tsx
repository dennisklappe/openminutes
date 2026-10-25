export function Brand({ href = '#/' }: { href?: string }) {
  return (
    <a className="brand" href={href}>
      <svg width="24" height="24" viewBox="0 0 54 54" aria-hidden="true">
        <rect width="54" height="54" rx="13" className="brand-tile" />
        <rect x="10" y="12.5" width="19" height="7" rx="3.5" fill="#fff" />
        <rect x="20" y="23.5" width="24" height="7" rx="3.5" fill="#74a8ef" />
        <rect x="12" y="34.5" width="13" height="7" rx="3.5" fill="#fff" />
      </svg>
      OpenMinutes
    </a>
  );
}
