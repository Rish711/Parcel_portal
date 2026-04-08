import { useState, useEffect } from 'react';

/**
 * Calculates how many table rows fit in the visible viewport.
 * @param rowHeight  - height of each row in px (default 44)
 * @param overhead   - pixels consumed by everything above/below the table (header, toolbar, pagination, etc.)
 */
export function useAutoPageSize(rowHeight = 44, overhead = 380): number {
  const calc = () => Math.max(5, Math.floor((window.innerHeight - overhead) / rowHeight));

  const [pageSize, setPageSize] = useState<number>(calc);

  useEffect(() => {
    const handler = () => setPageSize(calc());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return pageSize;
}
