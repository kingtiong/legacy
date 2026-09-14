import { useEffect, useRef, useState } from 'react';

// Width of an element, kept current as it resizes. Charts use it to draw at
// their real size, so text stays legible instead of shrinking with the SVG.
export function useWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
