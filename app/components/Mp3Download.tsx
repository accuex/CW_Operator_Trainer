'use client';
import { useEffect, useRef, useState } from 'react';
import type { AudioSettings } from '@/lib/types';
import type { AudioExportSegment } from '@/lib/audioExport/timeline';

export function Mp3Download({ segments, settings, filename, label = 'MP3保存' }: {
  segments: () => AudioExportSegment[]; settings: AudioSettings; filename: string; label?: string;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const download = async () => {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true); setProgress(null); setError('');
    try {
      const input = segments();
      const config = { ...settings };
      const { createMp3 } = await import('@/lib/audioExport/download');
      const blob = await createMp3(input, config, setProgress, current.signal);
      current.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${filename.replace(/[^\p{L}\p{N}._-]/gu, '-')}.mp3`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : 'MP3を保存できませんでした');
    } finally {
      if (!current.signal.aborted) { controller.current = null; setBusy(false); }
    }
  };
  return <span className="mp3-download"><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void download()}>{busy ? progress === null ? '音声を作成中…' : `MP3変換 ${Math.round(progress * 100)}%` : label}</button><span role="status" className="sr-only">{busy ? progress === null ? '音声を作成しています' : `MP3変換 ${Math.round(progress * 100)}%` : ''}</span>{error && <span role="alert" className="mp3-download-error">{error}</span>}</span>;
}
