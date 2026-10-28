import { useCallback, useState } from 'react';
import type { ImportConfigDto, ImportPreviewDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { uuid } from '../uuid.js';
import { archiveProblem, uploadChunks } from './upload.js';

export type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; name: string; sent: number; total: number }
  | { kind: 'reading'; name: string };

export function useUpload(
  config: ImportConfigDto | undefined,
  onReady: (p: ImportPreviewDto) => void,
) {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [error, setError] = useState<string>();

  const upload = useCallback(
    async (file: File) => {
      if (!config) return;
      const problem = archiveProblem(file, config.maxBytes);
      setError(problem);
      if (problem) return;
      const id = uuid();
      setState({ kind: 'uploading', name: file.name, sent: 0, total: file.size });
      try {
        const chunks = await uploadChunks(file, config.chunkBytes, {
          send: (index, body) => api.importChunk(id, index, body).then(() => undefined),
          onProgress: (sent) => {
            setState({ kind: 'uploading', name: file.name, sent, total: file.size });
          },
        });
        setState({ kind: 'reading', name: file.name });
        onReady(await api.importFinish(id, chunks));
      } catch (failure) {
        setError(errorMessage(failure));
        void api.importDiscard(id).catch(() => undefined);
      }
      setState({ kind: 'idle' });
    },
    [config, onReady],
  );

  return { state, error, upload };
}
