/**
 * Pixel-snap `host` inside its (possibly transformed) parent by writing the separate CSS `translate` property.
 * A centred hero sits at a fractional x (e.g. 740.43 px); Chrome rasterizes an <img> at that sub-pixel phase but
 * places a canvas texture on whole pixels, so their edges would differ. Snapping the shared wrapper before first paint
 * moves img and canvas together and avoids a later re-raster shift. Kept tiny and static so LoadingOverlay can run it
 * in a layout effect before the lazy warp chunk loads.
 */
export function snapToPixel(host: HTMLElement): void {
  const par = host.parentElement;
  if (!par) return;
  host.style.translate = '';
  const P = par.getBoundingClientRect(), H = host.getBoundingClientRect();
  const pw = parseFloat(getComputedStyle(par).width) || P.width;
  const sc = P.width / pw || 1, dpr = window.devicePixelRatio || 1;
  const fr = (v: number) => { const x = v * dpr; return (x - Math.round(x)) / dpr; };
  const fx = fr((H.left - P.left) / sc), fy = fr((H.top - P.top) / sc);
  host.style.translate = Math.abs(fx) + Math.abs(fy) > 0.01 ? `${-fx}px ${-fy}px` : '';
}

/** Canvas backing-store size for a canvas that fills `host`: untransformed layout size × min(DPR, 3). */
export function canvasSizeFor(host: HTMLElement): [number, number] {
  const d = Math.min(window.devicePixelRatio || 1, 3);
  const cs = getComputedStyle(host);
  return [Math.max(1, Math.round(parseFloat(cs.width) * d)), Math.max(1, Math.round(parseFloat(cs.height) * d))];
}
