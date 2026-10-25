import { useEffect, useState } from 'react';
import type { ExporterDto } from '../src/dto.js';
import { api } from './api.js';

export function useDocumentExports(meetingId: string, refreshKey: unknown): ExporterDto[] {
  const [documents, setDocuments] = useState<ExporterDto[]>([]);

  useEffect(() => {
    void Promise.all([api.exporters(), api.meetingExports(meetingId)]).then(
      ([exporters, records]) => {
        setDocuments(
          exporters.filter(
            (exporter) =>
              exporter.id !== 'share-link' &&
              records.some((record) => record.exporterId === exporter.id),
          ),
        );
      },
      () => undefined,
    );
  }, [meetingId, refreshKey]);

  return documents;
}
