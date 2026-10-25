import { useCallback, useState } from 'react';

export interface Selection {
  active: boolean;
  ids: ReadonlySet<string>;
  start: () => void;
  stop: () => void;
  toggle: (id: string) => void;
  setAll: (ids: readonly string[]) => void;
}

export function useSelection(): Selection {
  const [active, setActive] = useState(false);
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());

  const start = useCallback(() => {
    setActive(true);
  }, []);
  const stop = useCallback(() => {
    setActive(false);
    setIds(new Set());
  }, []);
  const toggle = useCallback((id: string) => {
    setIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const setAll = useCallback((all: readonly string[]) => {
    setIds(new Set(all));
  }, []);

  return { active, ids, start, stop, toggle, setAll };
}
