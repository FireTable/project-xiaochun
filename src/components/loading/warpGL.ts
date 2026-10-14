// Shared, DOM-free WebGL1 core of the key-visual warp: used by the main-thread warp (keyvisualWarp.ts) and the
// OffscreenCanvas worker (keyvisualWarp.worker.ts), so both draw exactly the same frame.

import type { LoadingWarpConfig } from '../../types/config';
export type { LoadingWarpConfig };

export const C = {
  hairL: [337, 301, 234, 432], hairR: [584, 291, 266, 416], // rootX, rootY, width, length
  neck: [476, 496], bust: [430, 770, 190, 95], jiggle: [430, 770, 190, 95], abdomen: [425, 915, 205, 78],
  elbow: [785, 1125], armL: [210, 520],
  // Raised hand (viewer-left, fingers in the hair): centre x/y + radii (px). Inside it every term is made rigid
  // (hair sway off, head tilt at one constant angle, breath scale as a pure shift, forearm rotation at full weight).
  hand: [250, 490, 78, 82],
  // Lowered hand (viewer-right, beside the skirt): centre x/y + radii (px). k.g fades out across its outer edge, which
  // let the skirt flare leak in and bulge the hand; inside it the forearm rotation is forced to full weight (rigid).
  hand2: [888, 1480, 75, 125], skirtTop: 1000, mouth: [455, 423, 505, 412],
  // Tunable amplitudes (bust, hair, flare, lip period, …) live in APP_CONFIG.loading.warp and are passed in.
  amp: { lipIn: 0.03, jig: 9, jelStretch: 0.005, jelNarrow: 0.0025, jelLag: 0.26 },
} as const;

// Master breath: every motion (skirt included) follows one breath cycle (period 2π/breathW, breathW from APP_CONFIG.loading.warp),
// asymmetric like real breathing (inhale 40 %, exhale 60 %), C1-smooth. br() in both shaders matches breath() here.
// Lags behind the chest (s): head tilt 0.15, left forearm 0.15, right forearm 0.20, bust follow jelLag 0.26 (s),
// hair L 0.35 / R 0.50, skirt 0.35 (sides up to 0.45; inhale draws in, exhale flares out).
// breathW comes from APP_CONFIG.loading.warp; the shader constant is derived from it so they can't drift.
function breath(t: number, w: number): number {
  const x = (((t * w) / (2 * Math.PI)) % 1 + 1) % 1;
  return x < 0.4 ? 0.5 - 0.5 * Math.cos((Math.PI * x) / 0.4) : 0.5 + 0.5 * Math.cos((Math.PI * (x - 0.4)) / 0.6);
}
export const breathS = (t: number, w: number) => 2 * breath(t, w) - 1;
const brGLSL = (w: number) => 'float br(float t){float x=fract(t*' + (w / (2 * Math.PI)).toFixed(6) + ');return x<.4?.5-.5*cos(7.854*x):.5+.5*cos(5.236*(x-.4));}';

export const makeVS = (w: number) =>
  'attribute vec2 p;uniform float t,ka;uniform vec2 nk,xf;uniform vec2 am;uniform vec4 hd;varying vec2 v;' +
  brGLSL(w) + 'void main(){v=p;vec2 q=p;float wh=1.-smoothstep(.9,1.3,length((p*vec2(991.,1600.)-hd.xy)/hd.zw)),hy=hd.y/1600.;' +
  // hand: tilt angle frozen at the hand centre's falloff, so the tilt is a rigid rotation there (no shear)
  'float a=(2.*br(t-.15)-1.)*am.y*ka*(1.-smoothstep(nk.y-.06,nk.y+.05,mix(p.y,hy,wh)));vec2 o=q-nk;' +
  'q=nk+vec2(o.x*cos(a)-o.y*sin(a)*1.6145,o.x*sin(a)/1.6145+o.y*cos(a));' +
  'q.y-=mix(1.-q.y,1.-hy,wh)*am.x*ka*br(t);gl_Position=vec4((q.x*xf.x+xf.y)*2.-1.,1.-q.y*2.,0,1);}';

export const makeFS = (w: number) =>
  'precision highp float;uniform sampler2D s,m;uniform float t,ka;uniform vec4 hl,hr,bu,A;uniform vec3 el;uniform vec2 sk;uniform vec4 mo,J,JB,AB;uniform vec3 lp;uniform vec4 LA;uniform vec2 JG;uniform vec3 fd;uniform vec4 hd,h2;varying vec2 v;' +
  'const vec2 R=vec2(991.,1600.);' +
  'vec2 rot(vec2 p,vec2 c,float a){vec2 o=p-c;return c+vec2(o.x*cos(a)-o.y*sin(a),o.x*sin(a)+o.y*cos(a));}' +
  'float sw(vec4 h,float sg,vec2 p){float d=clamp((p.y-h.y)/h.w,0.,1.);float cx=h.x+sg*h.z*.5;' +
  'return (1.-smoothstep(h.z*.35,h.z*.65,abs(p.x-cx)))*d*d*smoothstep(0.,30.,p.y-h.y)*(1.-smoothstep(h.w*.95,h.w*1.15,p.y-h.y));}' +
  brGLSL(w) + 'void main(){vec2 p=v*R;vec4 k=texture2D(m,v);float wh=1.-smoothstep(.9,1.3,length((p-hd.xy)/hd.zw));' +
  // hair sway (hair channel already fades out near skin/other parts)
  'float l=sw(hl,-1.,p)*k.r*(1.-wh),r=sw(hr,1.,p)*k.r*(1.-wh),s1=2.*br(t-.35)-1.,s2=2.*br(t-.5)-1.;p.x-=A.x*(l*s1+r*s2);p.y+=A.x*.2*(l*abs(s1)+r*abs(s2));' +
  // slow lip press, never opens
  'float ga=(1.-k.a)*2.;vec2 mc=(mo.xy+mo.zw)*.5;float mw=length(mo.zw-mo.xy)*.5,mx=dot(p-mc,normalize(mo.zw-mo.xy))/mw,my=p.y-mc.y-(p.x-mc.x)*(mo.w-mo.y)/(mo.z-mo.x);' +
  'float wm=ga*step(p.y,470.)*exp(-my*my/90.)*smoothstep(1.45,.9,abs(mx)),pr=.5-.5*cos(6.2832*t/lp.y);pr=pr*pr*pr*lp.x;p.y+=wm*my*pr;p.x+=wm*(p.x-mc.x)*pr*lp.z;' +
  // bust swell + lagged follow, abdomen draw-in
  'float bb=br(t),g=exp(-pow((p.x-bu.x)/bu.z,2.)-pow((p.y-bu.y)/bu.w,2.))*smoothstep(655.,700.,p.y)*ga;p.y+=A.y*(1.25*bb-.25)*g;p-=(p-bu.xy)*.018*bb*g;' +
  'float gj=exp(-pow((p.x-JB.x)/JB.z,2.)-pow((p.y-JB.y)/JB.w,2.))*smoothstep(655.,700.,p.y)*ga;p.y+=J.x*JG.x*gj;p.y-=(p.y-JB.y)*J.y*JG.y*gj;p.x+=(p.x-JB.x)*J.z*JG.y*gj;' +
  // Abdomen draw-in. x uses a side-tapered weight: above the waist centre the vertical falloff stretches toward the
  // flanks (centre-front |dx|<.3 unchanged) and fades out at y 780-850, so the bodice side outline moves in as one
  // curve up to the armpit. On the viewer-right flank the mask (k.a) already zeroes ga a few px inside the bodice
  // edge, which held the outline + its light fringe while the bodice moved (step + exposed halo); there ga is
  // replaced by a fade toward the arm's inner outline (x≈650+(y-793)*.19), so only the background gap compresses
  // and the arm stays put (faded out below the waist so the bow/skirt keep their mask).
  'float ax=abs(p.x-AB.x)/AB.z,sd=smoothstep(.3,1.,ax),ay=(p.y-AB.y)/(AB.w*(1.+1.4*sd*step(p.y,AB.y))),xa=650.+(p.y-793.)*.19,' +
  'gs=p.x>AB.x?max(ga,.94*(1.-smoothstep(xa-40.,xa,p.x))*(1.-smoothstep(930.,990.,p.y))):ga,gw=exp(-ax*ax-pow((p.y-AB.y)/AB.w,2.))*ga,' +
  'gx=exp(-ax*ax-ay*ay)*gs*mix(1.,smoothstep(780.,850.,p.y),sd),ih=br(t-.15);p.x+=(p.x-AB.x)*J.w*bb*gx;p.y+=1.6*bb*gw;' +
  // skirt flutter (mirror-symmetric hem flare) + viewer-right forearm, blended as one field
  // Skirt follows the master breath (lag 0.35 s, +up to ~0.1 s towards the sides): inhale (sb>0) samples outward =>
  // skirt draws in; exhale (sb<0) => hem flares out and lifts slightly. br() is C1, so no jitter; ws keeps the hem seamless.
  'float ws=pow(smoothstep(sk.x,R.y,p.y),1.4)*k.b,dx=(p.x-470.)/470.,sb=2.*br(t-.35)-1.,sc=2.*br(t-.35-abs(dx)*.1)-1.,wr=k.g*step(400.,p.x),wl=mix(k.g-wr,1.,wh);' +
  // lowered hand: rigid with the forearm (full rotation weight), blended out over 1-2 radii into the background/skirt
  'wr=max(wr,1.-smoothstep(1.,2.,length((p-h2.xy)/h2.zw)));' +
  'vec2 dS=vec2((A.w*sb+A.z*sc)*dx,-A.w*.25*sc)*ws;' +
  'vec2 dA=rot(p,el.xy,-el.z*(2.*br(t-.2)-1.))-p;p+=mix(dS,dA,wr);' +
  // viewer-left raised forearm: rotation about the wrist (hand stays on the hair) + small lift
  'p=mix(p,rot(p,LA.xy,LA.z*(ih-.5)),wl);p.y+=LA.w*ih*wl*smoothstep(560.,860.,p.y);' +
  // light despill of green-screen fringe
  // ka eases the whole deformation in from 0, so the first frame matches the static <img> exactly
  'p=mix(v*R,p,ka);vec4 c=texture2D(s,p/R)*clamp(min(p.x,R.x-p.x)+.5,0.,1.);c.g=mix(c.g,min(c.g,max(c.r,c.b)),ka);'+
  // Bottom fade baked in (same linear ramp as the img's CSS mask): a CSS mask on the GL canvas or its wrapper makes
  // Chrome paint a white box (user-confirmed). c is premultiplied (texture uploaded with UNPACK_PREMULTIPLY_ALPHA,
  // context premultipliedAlpha:true, clear 0,0,0,0), so scaling all four channels keeps vec4(rgb*a,a).
  'float y=1.-gl_FragCoord.y/fd.z;gl_FragColor=c*clamp((fd.y-y)/(fd.y-fd.x),0.,1.);}';


export interface WarpGL {
  /** Upload the (pre-downscaled, premultiplied) key visual for the current buffer size. */
  upload(src: TexImageSource): void;
  /** Buffer size w×h; the image spans [pad, w - pad] horizontally (pad = bleed for the outward skirt flare). */
  viewport(w: number, h: number, pad?: number): void;
  /** Bottom fade: opaque down to f0, transparent at f1 (fractions of the buffer height h). */
  setFade(f0: number, f1: number, h: number): void;
  /** Draw at time s (seconds) with deformation ease k in [0, 1]. */
  draw(s: number, k: number): void;
}

/**
 * Build the program, mesh and textures. `img`/`mask` are the initial sources. For an ImageBitmap the UNPACK_* flags
 * are ignored, so the worker creates the bitmaps with premultiplyAlpha 'premultiply' (img) / 'none' (mask) instead.
 */
export function createWarpGL(gl: WebGLRenderingContext, img: TexImageSource, mask: TexImageSource, cfg: LoadingWarpConfig): WarpGL {
  const sh = (type: number, src: string) => {
    const o = gl.createShader(type)!;
    gl.shaderSource(o, src);
    gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader');
    return o;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, makeVS(cfg.breathW)));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, makeFS(cfg.breathW)));
  gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  gl.useProgram(prog);
  const U = (n: string) => gl.getUniformLocation(prog, n);

  // The mesh reaches MX beyond the image on both sides (>= WARP_PAD in pixelSnap.ts) so flared hem pixels displaced
  // past the image edge are still rasterized into the canvas bleed; outside the image the sample is masked to 0.
  const MX = 0.12, X = 60, Y = 80, vs: number[] = [], ix: number[] = [];
  for (let j = 0; j <= Y; j++) for (let i = 0; i <= X; i++) vs.push(-MX + ((1 + 2 * MX) * i) / X, j / Y);
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
  const imgTex = tex(0, img, true);
  tex(1, mask, false);
  const a = { ...C.amp, ...cfg.amp }, bw = cfg.breathW;
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
  gl.uniform4fv(U('hd'), C.hand);
  gl.uniform4fv(U('h2'), C.hand2);
  gl.uniform4fv(U('JB'), C.jiggle);
  gl.uniform4fv(U('AB'), C.abdomen);
  const uT = U('t'), uJG = U('JG'), uKa = U('ka'), uFd = U('fd'), uXf = U('xf');
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  const N = ix.length;

  return {
    upload(src) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, imgTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    },
    viewport(w, h, pad = 0) { gl.viewport(0, 0, w, h); gl.uniform2f(uXf, (w - 2 * pad) / w, pad / w); },
    setFade(f0, f1, h) { gl.uniform3f(uFd, f0, f1, h); },
    draw(s, k) {
      gl.uniform1f(uKa, k * k * (3 - 2 * k));
      // The bust follows the master breath with a small lag and no rebound. JG = residual vs breath, then velocity.
      const lag = a.jelLag, bl = breathS(s - lag, bw);
      gl.uniform2f(uJG, bl - breathS(s, bw), (bl - breathS(s - lag - 1 / 120, bw)) * 120);
      gl.uniform1f(uT, s);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, N, gl.UNSIGNED_SHORT, 0);
    },
  };
}
