import { useEffect, useState } from 'react';
import { api } from './api.js';

/** Number of meetings in the bin, refreshed when the route changes. */
function useBinCount(route: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    api.meetings({ scope: 'bin' }).then(
      (items) => {
        if (live) setCount(items.length);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [route]);
  return count;
}

/** Quiet links to the archive and the bin, which are not part of the main navigation. */
export function StoredLinks(props: { route: string; where: 'sidebar' | 'page' }) {
  const { route, where } = props;
  const count = useBinCount(route);
  return (
    <nav className={`stored-links in-${where}`} aria-label="Archive and bin">
      <a href="#/archive" aria-current={route === '/archive' ? 'page' : undefined}>
        Archive
      </a>
      <a href="#/bin" aria-current={route === '/bin' ? 'page' : undefined}>
        Bin
        {count > 0 && (
          <span className="stored-count" aria-label={`${String(count)} in the bin`}>
            {count}
          </span>
        )}
      </a>
    </nav>
  );
}
