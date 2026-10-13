import { MessageSquare } from 'lucide-react';
import type { Annotation } from '../../electron/session-types';
import type { PageSize } from '../types';
import { mergeHighlightRegions } from '../pdf/highlightGeometry';
import { useLanguage } from '../i18n/LanguageProvider';

export function AnnotationLayer({ annotations, page, size, activeId, onSelect }: {
  annotations: Annotation[]; page: number; size: PageSize; activeId: string | null; onSelect: (id: string) => void;
}) {
  const { t } = useLanguage();
  const entries = annotations.filter(a => a.regions.some(r => r.page === page));
  // Margin markers remain clickable; the rectangles never intercept text drags.
  const occupied: number[] = [];
  return <>
    <div className="annotation-highlights" aria-hidden="true">{entries.flatMap(a => mergeHighlightRegions(a.regions.filter(r => r.page === page), size).map((r, i) =>
      <span key={`${a.id}-${i}`} className={`annotation-highlight ${a.color} ${a.id === activeId ? 'active' : ''}`}
        data-annotation-id={a.id} data-region-index={i}
        style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }} />))}</div>
    <div className="annotation-markers">{entries.map(a => {
      const first = a.regions.find(r => r.page === page)!;
      const lane = occupied.filter(y => Math.abs(y - first.y) < .035).length;
      occupied.push(first.y);
      return <button key={a.id} type="button" className={`annotation-marker ${a.color} ${a.id === activeId ? 'active' : ''}`}
        data-annotation-id={a.id} style={{ top: `min(calc(${first.y * 100}% + ${lane * 24}px), calc(100% - 24px))`, left: 3 }}
        aria-label={t('viewAnnotation', { quote: a.quote.text.slice(0, 40) })} title={a.note || a.quote.text}
        onClick={() => onSelect(a.id)}><MessageSquare size={14} /></button>;
    })}</div>
  </>;
}
