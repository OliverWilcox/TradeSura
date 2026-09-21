"use client";

import { useEffect, useRef } from "react";

// Fullscreen-triangle-strip WebGL background: a soft cursor-following light
// plus a slow ambient drift, over black. Plain WebGL rather than a 3D lib —
// it's one fragment shader, no scene/geometry to justify the dependency.

const VERTEX_SRC = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SRC = `
precision highp float;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uTime;

void main() {
  vec3 blue = vec3(0.373, 0.639, 0.941);
  vec3 green = vec3(0.239, 0.839, 0.549);

  float aspect = uResolution.x / uResolution.y;
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = uv;
  p.x *= aspect;

  vec2 mouse = uMouse;
  mouse.x *= aspect;
  float dMouse = distance(p, mouse);
  float cursorGlow = exp(-dMouse * dMouse * 10.0) * 0.9;

  vec2 drift = vec2(0.5 + 0.18 * sin(uTime * 0.09), 0.6 + 0.12 * cos(uTime * 0.07));
  drift.x *= aspect;
  float dDrift = distance(p, drift);
  float ambientGlow = exp(-dDrift * dDrift * 6.0) * 0.35;

  vec3 col = blue * cursorGlow + mix(blue, green, 0.35) * ambientGlow;

  float vignette = smoothstep(1.1, 0.2, distance(uv, vec2(0.5)));
  col *= mix(0.85, 1.0, vignette);

  gl_FragColor = vec4(col, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export default function CursorGlow() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // No WebGL support / blocked: canvas stays empty, page's own black
    // background still renders underneath. Graceful, not a dead end.
    const gl = (canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uTime = gl.getUniformLocation(program, "uTime");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const target = { x: 0.5, y: 0.6 };
    const smoothed = { x: 0.5, y: 0.6 };

    function handlePointerMove(e: PointerEvent) {
      target.x = e.clientX / window.innerWidth;
      target.y = 1 - e.clientY / window.innerHeight;
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    function resize() {
      if (!canvas || !gl) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();
    let raf = 0;

    function draw(now: number) {
      if (!gl || !canvas) return;
      smoothed.x += (target.x - smoothed.x) * 0.06;
      smoothed.y += (target.y - smoothed.y) * 0.06;
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform2f(uMouse, smoothed.x, smoothed.y);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function frame(now: number) {
      if (document.visibilityState === "visible") draw(now);
      raf = requestAnimationFrame(frame);
    }

    if (reduceMotion) {
      draw(0);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
