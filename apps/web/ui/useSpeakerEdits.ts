import { useCallback, useEffect, useState } from 'react';
import type {
  SegmentDto,
  SpeakerChoiceDto,
  SpeakerEditInput,
  SpeakerEditResultDto,
} from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { isTyping } from './keyboard.js';
import { editMessage } from './speakerEdits.js';
import { popUndo, pushUndo } from './undoStack.js';

const TOAST_MS = 8000;

export interface Toast {
  id: number;
  text: string;
  undoable: boolean;
  failed: boolean;
}

interface Options {
  meetingId: string;
  segments: SegmentDto[];
  speakerChoices: SpeakerChoiceDto[];
  active: boolean;
  onChanged: () => void;
}

/**
 * Posts speaker edits, shows the segments the server returns until the next refresh and keeps the
 * undo stack that Ctrl/Cmd+Z and the toast draw from.
 */
export function useSpeakerEdits({
  meetingId,
  segments,
  speakerChoices,
  active,
  onChanged,
}: Options) {
  const [edited, setEdited] = useState<{ base: SegmentDto[]; result: SpeakerEditResultDto }>();
  const [undos, setUndos] = useState<SpeakerEditInput[]>([]);
  const [toast, setToast] = useState<Toast>();
  const [busy, setBusy] = useState(false);

  const show = useCallback((text: string, undoable: boolean, failed = false) => {
    setToast({ id: Date.now(), text, undoable, failed });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(undefined);
    }, TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const post = useCallback(
    async (input: SpeakerEditInput) => {
      setBusy(true);
      try {
        const result = await api.speakerEdit(meetingId, input);
        setEdited({ base: segments, result });
        onChanged();
        return result;
      } catch (failure) {
        show(errorMessage(failure), false, true);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [meetingId, segments, onChanged, show],
  );

  const apply = useCallback(
    async (input: SpeakerEditInput) => {
      const result = await post(input);
      if (!result) return;
      setUndos((stack) => pushUndo(stack, result.undo));
      show(editMessage(input), true);
    },
    [post, show],
  );

  const undo = useCallback(async () => {
    const { item, rest } = popUndo(undos);
    if (!item || busy) return;
    setUndos(rest);
    if (await post(item)) show('Change undone.', false);
  }, [undos, busy, post, show]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const combo = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
      if (!combo || event.key.toLowerCase() !== 'z' || isTyping(event.target)) return;
      if (undos.length === 0) return;
      event.preventDefault();
      void undo();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [active, undos.length, undo]);

  const shown = edited?.base === segments ? edited.result : undefined;
  return {
    segments: shown?.segments ?? segments,
    speakerChoices: shown?.speakerChoices ?? speakerChoices,
    busy,
    toast,
    apply,
    undo,
    dismiss: () => {
      setToast(undefined);
    },
  };
}
