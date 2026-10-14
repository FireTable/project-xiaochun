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

/**
 * Horizontal bleed of the warp canvas on each side, as a fraction of the image width. The skirt flare pushes the
 * hem outward (up to ~skirt+flare px of the 991 px source at the canvas edge), and the hem's lower-left/right corners
 * sit within ~35 px of the image edge, so a canvas exactly the image's size cut the flared hem off with a vertical
 * straight edge. The canvas extends WARP_PAD beyond the img on both sides; the image itself still lands on the same
 * device pixels as the <img> (whole-pixel bleed), so the swap does not jump. Must cover the max outward flare.
 */
export const WARP_PAD = 0.1;

/**
 * Canvas backing-store size for the warp canvas over `host`: untransformed layout size × min(DPR, 3), plus `pad`
 * whole device pixels of bleed on the left and right (the image occupies [pad, w - pad]).
 */
export function canvasSizeFor(host: HTMLElement): [number, number, number] {
  const d = Math.min(window.devicePixelRatio || 1, 3);
  const cs = getComputedStyle(host);
  const iw = Math.max(1, Math.round(parseFloat(cs.width) * d)), h = Math.max(1, Math.round(parseFloat(cs.height) * d));
  const pad = Math.round(iw * WARP_PAD);
  return [iw + 2 * pad, h, pad];
}

/** Place the canvas so its middle `w - 2*pad` device pixels coincide with the host (= img) box. */
export function placeCanvas(canvas: HTMLCanvasElement, w: number, pad: number): void {
  const d = Math.min(window.devicePixelRatio || 1, 3);
  const left = `${-pad / d}px`, width = `${w / d}px`;
  if (canvas.style.left !== left) canvas.style.left = left;
  if (canvas.style.width !== width) canvas.style.width = width;
}
