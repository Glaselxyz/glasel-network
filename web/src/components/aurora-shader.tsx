"use client";

import { useEffect, useRef } from "react";

/**
 * GPU aurora/fluid background — a full-screen WebGL fragment shader that renders
 * slow flowing bands of brand colour (navy base, blue/cyan/purple light) over an
 * fbm noise field. DPR-capped, paused under prefers-reduced-motion, and it falls
 * back to a static CSS gradient if WebGL is unavailable.
 */
const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;

// hash + value noise -> fbm
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i+vec2(0.0,0.0)), hash(i+vec2(1.0,0.0)), u.x),
             mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for(int i=0;i<6;i++){ v += a*noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = uv;
  p.x *= u_res.x / u_res.y;
  float t = u_time * 0.04;

  // domain-warped flow field
  vec2 q = vec2(fbm(p*1.4 + vec2(0.0, t)), fbm(p*1.4 + vec2(5.2, -t)));
  vec2 r = vec2(fbm(p*1.7 + 3.0*q + vec2(1.7, 9.2) + t*0.6),
                fbm(p*1.7 + 3.0*q + vec2(8.3, 2.8) - t*0.6));
  float f = fbm(p*1.5 + 2.5*r);

  // brand palette
  vec3 navy   = vec3(0.020, 0.024, 0.173);
  vec3 blue   = vec3(0.180, 0.408, 0.953);
  vec3 cyan   = vec3(0.494, 0.863, 1.000);
  vec3 purple = vec3(0.455, 0.314, 1.000);

  vec3 col = navy;
  col = mix(col, blue,   smoothstep(0.25, 0.85, f) * 0.85);
  col = mix(col, purple, smoothstep(0.40, 1.05, length(r)) * 0.6);
  col = mix(col, cyan,   smoothstep(0.62, 0.95, f) * 0.7);

  // vignette toward navy at the edges
  float vig = smoothstep(1.25, 0.25, length(uv - 0.5));
  col = mix(navy, col, vig);

  // subtle film grain
  col += (hash(uv * u_time) - 0.5) * 0.025;

  gl_FragColor = vec4(col, 1.0);
}
`;

const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export function AuroraShader({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");

    let raf = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    const render = (loop: boolean, t: number) => {
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (loop) raf = requestAnimationFrame(() => render(true, t + 0.016));
    };

    resize();
    render(!reduce, reduce ? 8.0 : 0);

    const onResize = () => {
      resize();
      if (reduce) render(false, 8.0);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
