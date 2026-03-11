import { useEffect, useRef } from 'react';
import type { OpenSheetMusicDisplay as OSMDType } from 'opensheetmusicdisplay';
import './SheetMusicView.css';

interface Props {
  xmlString: string;
  transpose: number;
  currentTime: number;
  isPlaying: boolean;
}

export function SheetMusicView({ xmlString, transpose, currentTime, isPlaying }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OSMDType | null>(null);
  const cursorIntervalRef = useRef<number | null>(null);

  // Initialise OSMD once on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
      if (cancelled || !containerRef.current) return;

      const osmd = new OpenSheetMusicDisplay(containerRef.current, {
        autoResize: true,
        drawingParameters: 'default',
        renderSingleHorizontalStaffline: false,
        followCursor: true,
      });
      osmdRef.current = osmd;

      await loadAndRender(osmd, xmlString, transpose);
    }

    init();
    return () => {
      cancelled = true;
      clearCursorInterval();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload whenever xmlString or transpose changes
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    loadAndRender(osmd, xmlString, transpose);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transpose, xmlString]);

  // Cursor control
  useEffect(() => {
    clearCursorInterval();
    const osmd = osmdRef.current;
    if (!osmd || !osmd.cursor) return;

    if (isPlaying) {
      osmd.cursor.show();
      osmd.cursor.reset();
      // advance cursor as time progresses — lightweight polling
      cursorIntervalRef.current = window.setInterval(() => {
        try {
          const cursor = osmd.cursor;
          if (!cursor) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const noteTimestamp = (cursor.iterator?.currentTimeStamp as any)?.realValue ?? 0;
          const beatDuration = 60 / 120; // approximate, good enough for now
          const cursorTimeSec = noteTimestamp * beatDuration;
          if (currentTime >= cursorTimeSec) {
            cursor.next();
          }
        } catch { /* ignore */ }
      }, 200);
    } else {
      osmd.cursor.hide();
    }

    return clearCursorInterval;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  function clearCursorInterval() {
    if (cursorIntervalRef.current !== null) {
      clearInterval(cursorIntervalRef.current);
      cursorIntervalRef.current = null;
    }
  }

  async function loadAndRender(osmd: OSMDType, xml: string, tp: number) {
    try {
      await osmd.load(xml);
      if (osmd.Sheet && tp !== 0) {
        (osmd.Sheet as unknown as { Transpose: number }).Transpose = tp;
      }
      osmd.render();
      osmd.cursor?.reset();
      osmd.cursor?.hide();
    } catch (e) {
      console.error('OSMD render error', e);
    }
  }

  return (
    <div className="sheet-music-view">
      <div ref={containerRef} className="osmd-container" />
    </div>
  );
}
