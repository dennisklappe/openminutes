import { useState } from 'react';

const KEY = 'openminutes.showChat';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function useShowChat(): [boolean, (show: boolean) => void] {
  const [show, setShow] = useState(read);
  return [
    show,
    (next) => {
      setShow(next);
      try {
        localStorage.setItem(KEY, String(next));
      } catch {
        // The choice then only lasts for this visit.
      }
    },
  ];
}
