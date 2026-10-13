// Key-visual "Live2D-lite" warp for the loading overlay.
// Raw WebGL1 (no three.js): a 48x80 grid draws the hero image with one draw call, and the fragment shader applies
// small inverse-UV offsets that a UV-space mask texture gates (warp-mask.webp, 248x400: R hair, G arms, B skirt,
// A = 255 - torso/mouth gate*127). The coordinates below are key-visual pixels in the 991x1600 master. The 619w
// source has the same aspect ratio, so the mask and coordinates fit both srcset candidates.
// The caller keeps the <img> as the static fallback. The canvas fades in only after the first frame has drawn.

const C = {
  hairL: [337, 301, 234, 432], hairR: [584, 291, 266, 416], // rootX, rootY, width, length
  neck: [476, 496], bust: [430, 770, 190, 95], jiggle: [430, 770, 190, 95], abdomen: [425, 915, 205, 78],
  elbow: [785, 1125], armL: [210, 520], skirtTop: 1150, mouth: [455, 423, 505, 412],
  amp: {
    breath: 0.0035, tilt: 0.012, hair: 5.5, bust: 9, skirt: 5, flare: 12, arm: 0.021,
    lipPress: 0.3, lipPeriod: 7.5, lipIn: 0.03, jig: 9, jelStretch: 0.005, jelNarrow: 0.0025, jelLag: 0.35,
    waist: 0.03, armLRot: 0.013, armLLift: 1.2,
  },
} as const;

const VS =
  'attribute vec2 p;uniform float t,ka;uniform vec2 nk;uniform vec2 am;varying vec2 v;' +
  'void main(){v=p;vec2 q=p;float a=sin(t*1.37)*am.y*ka*(1.-smoothstep(nk.y-.06,nk.y+.05,p.y));vec2 o=q-nk;' +
  'q=nk+vec2(o.x*cos(a)-o.y*sin(a)*1.6145,o.x*sin(a)/1.6145+o.y*cos(a));' +
  'q.y=1.-(1.-q.y)*(1.+am.x*ka*(.5+.5*sin(t*1.36)));gl_Position=vec4(q.x*2.-1.,1.-q.y*2.,0,1);}';

const FS =
  'precision highp float;uniform sampler2D s,m;uniform float t,ka;uniform vec4 hl,hr,bu,A;uniform vec3 el;uniform vec2 sk;uniform vec4 mo,J,JB,AB;uniform vec3 lp;uniform vec4 LA;uniform vec2 JG;uniform vec3 fd;varying vec2 v;' +
  'const vec2 R=vec2(991.,1600.);' +
  'vec2 rot(vec2 p,vec2 c,float a){vec2 o=p-c;return c+vec2(o.x*cos(a)-o.y*sin(a),o.x*sin(a)+o.y*cos(a));}' +
  'float sw(vec4 h,float sg,vec2 p){float d=clamp((p.y-h.y)/h.w,0.,1.);float cx=h.x+sg*h.z*.5;' +
  'return (1.-smoothstep(h.z*.35,h.z*.65,abs(p.x-cx)))*d*d*smoothstep(0.,30.,p.y-h.y)*(1.-smoothstep(h.w*.95,h.w*1.15,p.y-h.y));}' +
  'void main(){vec2 p=v*R;vec4 k=texture2D(m,v);' +
  // hair sway (hair channel already fades out near skin/other parts)
  'float l=sw(hl,-1.,p)*k.r,r=sw(hr,1.,p)*k.r,s1=sin(t*1.1),s2=sin(t*.91+1.3);p.x-=A.x*(l*s1+r*s2);p.y+=A.x*.2*(l*abs(s1)+r*abs(s2));' +
  // slow lip press, never opens
  'float ga=(1.-k.a)*2.;vec2 mc=(mo.xy+mo.zw)*.5;float mw=length(mo.zw-mo.xy)*.5,mx=dot(p-mc,normalize(mo.zw-mo.xy))/mw,my=p.y-mc.y-(p.x-mc.x)*(mo.w-mo.y)/(mo.z-mo.x);' +
  'float wm=ga*step(p.y,470.)*exp(-my*my/90.)*smoothstep(1.45,.9,abs(mx)),pr=.5-.5*cos(6.2832*t/lp.y);pr=pr*pr*pr*lp.x;p.y+=wm*my*pr;p.x+=wm*(p.x-mc.x)*pr*lp.z;' +
  // bust swell + lagged follow, abdomen draw-in
  'float bb=.5+.5*sin(t*1.36-.45),g=exp(-pow((p.x-bu.x)/bu.z,2.)-pow((p.y-bu.y)/bu.w,2.))*smoothstep(655.,700.,p.y)*ga;p.y+=A.y*bb*g;p-=(p-bu.xy)*.018*bb*g;' +
  'float gj=exp(-pow((p.x-JB.x)/JB.z,2.)-pow((p.y-JB.y)/JB.w,2.))*smoothstep(655.,700.,p.y)*ga;p.y+=J.x*JG.x*gj;p.y-=(p.y-JB.y)*J.y*JG.y*gj;p.x+=(p.x-JB.x)*J.z*JG.y*gj;' +
  'float gw=exp(-pow((p.x-AB.x)/AB.z,2.)-pow((p.y-AB.y)/AB.w,2.))*ga,ih=.5+.5*sin(t*1.36-.3);p.x+=(p.x-AB.x)*J.w*ih*gw;p.y+=1.6*ih*gw;' +
  // skirt flutter (mirror-symmetric hem flare) + viewer-right forearm, blended as one field
  'float ws=pow(smoothstep(sk.x,R.y,p.y),1.4)*k.b,ph=t*1.3,pf=t*1.95,wr=k.g*step(400.,p.x),wl=k.g-wr;' +
  'vec2 dS=vec2(-(A.z*(.5*sin(t+p.x*.004)+.35*sin(t*2.1+p.x*.011+1.))+A.w*(p.x-470.)/470.*sin(pf+.6)),-A.w*.25*sin(pf+.6+p.x*.004))*ws;' +
  'vec2 dA=rot(p,el.xy,-el.z*sin(ph-.8))-p;p+=mix(dS,dA,wr);' +
  // viewer-left raised forearm: rotation about the wrist (hand stays on the hair) + small lift
  'p=mix(p,rot(p,LA.xy,LA.z*(ih-.5)),wl);p.y+=LA.w*ih*wl*smoothstep(560.,860.,p.y);' +
  // light despill of green-screen fringe
  // ka eases the whole deformation in from 0, so the first frame matches the static <img> exactly
  'p=mix(v*R,p,ka);vec4 c=texture2D(s,p/R);c.g=mix(c.g,min(c.g,max(c.r,c.b)),ka);'+
  // Bottom fade baked in (same linear ramp as the img's CSS mask): a CSS mask on the GL canvas or its wrapper makes
  // Chrome paint a white box (user-confirmed). c is premultiplied (texture uploaded with UNPACK_PREMULTIPLY_ALPHA,
  // context premultipliedAlpha:true, clear 0,0,0,0), so scaling all four channels keeps vec4(rgb*a,a).
  'float y=1.-gl_FragCoord.y/fd.z;gl_FragColor=c*clamp((fd.y-y)/(fd.y-fd.x),0.,1.);}';

export interface KeyvisualWarp {
  /** Stop or restart animation. A paused warp keeps its last frame. */
  setPaused(paused: boolean): void;
  /** Free GL resources and observers, remove the canvas, and show the <img> again. */
  dispose(): void;
}

const NOOP: KeyvisualWarp = { setPaused() {}, dispose() {} };

// The overlay can be remounted during boot (router pending component -> App overlay, StrictMode, HMR). Time
// therefore uses a module-level origin so the motion stays continuous, and a remount within WARM_MS of a live
// warp skips the fade-in. A remount then looks seamless instead of snapping back to t=0 and fading in again.
let timeOrigin = 0;
let lastAliveAt = -Infinity;
const WARM_MS = 3000;
/** True while a warp was alive within WARM_MS, i.e. a remount should take over without showing the static img. */
export function isWarpWarm(): boolean {
  return performance.now() - lastAliveAt < WARM_MS;
}
const maskCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const hit = maskCache.get(src);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
  maskCache.set(src, p);
  p.catch(() => maskCache.delete(src));
  return p;
}

/**
 * Mounts the warp canvas over `img`, filling `host`, which should be a positioned box with the same size as the img.
 * Resolves to a no-op handle when WebGL is unavailable or reduced motion is on, so the static img stays.
 */
export async function startKeyvisualWarp(
  img: HTMLImageElement,
  host: HTMLElement,
  maskSrc: string,
  canvasClassName = '',
  hostMaskClass = '',
): Promise<KeyvisualWarp> {
  if (typeof window === 'undefined') return NOOP;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return NOOP;

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return NOOP;

  let disposed = false;
  let paused = false;
  let visible = true;
  let raf = 0;
  let swapRaf = 0;
  const cleanups: Array<() => void> = [];
  let kick = () => {};
  const lose = () => gl.getExtension('WEBGL_lose_context')?.loseContext();

  try {
    // Reuse the srcset candidate the browser already chose (currentSrc), which is a cache hit and not a second download.
    if (!img.complete || !img.naturalWidth) await img.decode();
    const mask = await loadImage(maskSrc);
    if (disposed) return NOOP;

    const sh = (type: number, src: string) => {
      const o = gl.createShader(type)!;
      gl.shaderSource(o, src);
      gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader');
      return o;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'p');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    gl.useProgram(prog);
    const U = (n: string) => gl.getUniformLocation(prog, n);

    const X = 48, Y = 80, vs: number[] = [], ix: number[] = [];
    for (let j = 0; j <= Y; j++) for (let i = 0; i <= X; i++) vs.push(i / X, j / Y);
    for (let j = 0; j < Y; j++) for (let i = 0; i < X; i++) {
      const a = j * (X + 1) + i;
      ix.push(a, a + 1, a + X + 1, a + 1, a + X + 2, a + X + 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vs), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ix), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const tex = (unit: number, src: TexImageSource, premul: boolean) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    // The key visual is pre-downscaled to the exact drawing-buffer size with the browser's high-quality resampler,
    // so the ka=0 frame matches the browser-scaled <img> (plain bilinear minification of the 991 w source is visibly
    // sharper/aliased, and WebGL1 cannot mipmap the NPOT texture). Re-uploaded whenever the buffer size changes.
    const scratch = document.createElement('canvas');
    const sctx = scratch.getContext('2d');
    const imgTex = tex(0, img, true);
    tex(1, mask, false);
    const uploadImg = (w: number, h: number) => {
      let src: TexImageSource = img;
      if (sctx && w < img.naturalWidth) {
        scratch.width = w;
        scratch.height = h;
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.clearRect(0, 0, w, h);
        sctx.drawImage(img, 0, 0, w, h);
        src = scratch;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, imgTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    };
    const a = C.amp;
    gl.uniform1i(U('s'), 0);
    gl.uniform1i(U('m'), 1);
    gl.uniform4fv(U('hl'), C.hairL);
    gl.uniform4fv(U('hr'), C.hairR);
    gl.uniform4fv(U('bu'), C.bust);
    gl.uniform2f(U('nk'), C.neck[0] / 991, C.neck[1] / 1600);
    gl.uniform2f(U('am'), a.breath, a.tilt);
    gl.uniform4f(U('A'), a.hair, a.bust, a.skirt, a.flare);
    gl.uniform3f(U('el'), C.elbow[0], C.elbow[1], a.arm);
    gl.uniform2f(U('sk'), C.skirtTop, 0);
    gl.uniform4fv(U('mo'), C.mouth);
    gl.uniform3f(U('lp'), a.lipPress, a.lipPeriod, a.lipIn);
    gl.uniform4f(U('LA'), C.armL[0], C.armL[1], a.armLRot, a.armLLift);
    gl.uniform4f(U('J'), a.jig, a.jelStretch, a.jelNarrow, a.waist);
    gl.uniform4fv(U('JB'), C.jiggle);
    gl.uniform4fv(U('AB'), C.abdomen);
    const uT = U('t'), uJG = U('JG'), uKa = U('ka'), uFd = U('fd');
    // Must match the .xc-hero-img mask in main.css: opaque to 52% then transparent at 64% (mobile), 80% to 99% (md+).
    const mq = window.matchMedia('(min-width: 768px)');
    const setFade = () => {
      const [f0, f1] = mq.matches ? [0.8, 0.99] : [0.52, 0.64];
      gl.uniform3f(uFd, f0, f1, canvas.height);
    };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    const N = ix.length;

    if (!timeOrigin) timeOrigin = performance.now();
    const start = timeOrigin;
    const warm = performance.now() - lastAliveAt < WARM_MS;
    let shownAt = -1; // performance.now() when the canvas replaced the img; -1 = not shown yet
    const RAMP_MS = 1200;
    const draw = (s: number) => {
      const k = warm ? 1 : shownAt < 0 ? 0 : Math.min(1, (performance.now() - shownAt) / RAMP_MS);
      gl.uniform1f(uKa, k * k * (3 - 2 * k));
      // The bust follows breath with a small lag and no rebound. JG holds the residual vs breath, then velocity.
      const b0 = s * 1.36 - 0.45, b1 = b0 - a.jelLag;
      gl.uniform2f(uJG, Math.sin(b1) - Math.sin(b0), 1.36 * Math.cos(b1));
      gl.uniform1f(uT, s);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, N, gl.UNSIGNED_SHORT, 0);
    };
    // Size from the untransformed layout box, never getBoundingClientRect: the ancestor .xc-breathe scale animation
    // would otherwise bake a random breathing phase (up to 1.2 %) into the buffer and resample the frame at the swap.
    // Pixel-snap the host inside its (transformed) parent. A centred hero sits at a fractional x (e.g. 740.43 px);
    // Chrome rasterizes the <img> at that sub-pixel phase but places the canvas texture on whole pixels, so every
    // edge differed at the swap (mean |diff| 1.6 vs 0.6 when snapped). Translating the host by -frac aligns both.
    const snap = () => {
      const par = host.parentElement;
      if (!par) return;
      host.style.translate = '';
      const P = par.getBoundingClientRect(), H = host.getBoundingClientRect();
      const pw = parseFloat(getComputedStyle(par).width) || P.width;
      const sc = P.width / pw || 1, dpr = window.devicePixelRatio || 1;
      const fr = (v: number) => { const x = v * dpr; return (x - Math.round(x)) / dpr; };
      const fx = fr((H.left - P.left) / sc), fy = fr((H.top - P.top) / sc);
      host.style.translate = Math.abs(fx) + Math.abs(fy) > 0.01 ? `${-fx}px ${-fy}px` : '';
    };
    const resize = () => {
      snap();
      const d = Math.min(window.devicePixelRatio || 1, 3);
      const cs = getComputedStyle(host); // canvas fills host 100% and may still be detached
      const w = Math.max(1, Math.round(parseFloat(cs.width) * d)), h = Math.max(1, Math.round(parseFloat(cs.height) * d));
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; // clears the drawing buffer, so the caller redraws in the same task
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      uploadImg(w, h);
      setFade();
      return true;
    };
    const now = () => (performance.now() - start) / 1000;
    const frame = () => {
      raf = 0;
      if (disposed || paused || !visible || document.hidden || shownAt < 0) return;
      draw((performance.now() - start) / 1000);
      lastAliveAt = performance.now();
      raf = requestAnimationFrame(frame);
    };
    kick = () => {
      if (!raf && !disposed && !paused && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    canvas.setAttribute('aria-hidden', 'true');
    if (canvasClassName) canvas.className = canvasClassName;
    Object.assign(canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      background: 'transparent', pointerEvents: 'none',
    });
    // The canvas is rendered while DETACHED and only inserted (already visible) in the same rAF that hides the img,
    // so the page never composites a GL canvas without content. A detached canvas has no compositor surface yet, so
    // the frame is drawn again right after insertion, in the same task, to be safe.
    // The bottom fade starts on the img (single masked layer, known-good). Only once the canvas is live and the img
    // is hidden does it move to the wrapper (hostMaskClass; CSS drops the img mask under it). Same stops, so the
    // fade looks identical. dispose() removes the class, so the img carries its own mask again.
    resize();
    setFade();
    draw(now());
    const moveMask = () => { if (hostMaskClass && !disposed) host.classList.add(hostMaskClass); };
    const goLive = () => {
      host.appendChild(canvas);
      resize();
      draw(now());
      img.style.visibility = 'hidden';
      shownAt = performance.now();
    };
    if (warm) {
      // Warm remount: everything is cached, so this runs in the same task as the React commit, before paint.
      goLive();
      swapRaf = requestAnimationFrame(() => { swapRaf = 0; moveMask(); });
    } else {
      swapRaf = requestAnimationFrame(() => {
        if (disposed) return;
        goLive();
        kick();
        swapRaf = requestAnimationFrame(() => {
          swapRaf = requestAnimationFrame(() => { swapRaf = 0; moveMask(); });
        });
      });
    }
    const onMq = () => { setFade(); draw(now()); };
    mq.addEventListener('change', onMq);
    cleanups.push(() => mq.removeEventListener('change', onMq));

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => { if (resize()) draw(now()); });
      ro.observe(host);
      cleanups.push(() => ro.disconnect());
    } else {
      const onResize = () => { if (resize()) draw(now()); };
      window.addEventListener('resize', onResize);
      cleanups.push(() => window.removeEventListener('resize', onResize));
    }
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((en) => { visible = en[0]?.isIntersecting ?? true; kick(); });
      io.observe(host);
      cleanups.push(() => io.disconnect());
    }
    document.addEventListener('visibilitychange', kick);
    cleanups.push(() => document.removeEventListener('visibilitychange', kick));
    const onLost = (e: Event) => { e.preventDefault(); handle.dispose(); };
    canvas.addEventListener('webglcontextlost', onLost);
    cleanups.push(() => canvas.removeEventListener('webglcontextlost', onLost));
    kick();
  } catch (err) {
    if (import.meta.env?.DEV) console.warn('[keyvisualWarp] fallback to static image:', err);
    lose();
    canvas.remove();
    if (hostMaskClass) host.classList.remove(hostMaskClass);
    img.style.visibility = '';
    return NOOP;
  }

  const handle: KeyvisualWarp = {
    setPaused(p) {
      paused = p;
      if (!p) kick();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (canvas.isConnected) lastAliveAt = performance.now();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      cancelAnimationFrame(swapRaf);
      cleanups.forEach((f) => f());
      if (hostMaskClass) host.classList.remove(hostMaskClass);
      img.style.visibility = '';
      canvas.remove();
      lose();
    },
  };
  return handle;
}
