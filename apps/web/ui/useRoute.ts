import { useEffect, useState } from 'react';

const current = () => window.location.hash.replace(/^#/, '') || '/';

export function useRoute(): string {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const update = () => {
      setRoute(current());
    };
    window.addEventListener('hashchange', update);
    return () => {
      window.removeEventListener('hashchange', update);
    };
  }, []);
  return route;
}
