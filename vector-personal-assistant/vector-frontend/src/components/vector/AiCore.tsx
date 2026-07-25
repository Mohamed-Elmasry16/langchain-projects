import { useEffect, useRef } from "react";

export function AiCore({ thinking }: { thinking: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 320;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const cx = size / 2;
    const cy = size / 2;

    const points: { x: number; y: number; z: number; phase: number }[] = [];
    const N = 110;
    for (let i = 0; i < N; i++) {
      const phi = Math.acos(-1 + (2 * i) / N);
      const theta = Math.sqrt(N * Math.PI) * phi;
      points.push({
        x: Math.cos(theta) * Math.sin(phi),
        y: Math.sin(theta) * Math.sin(phi),
        z: Math.cos(phi),
        phase: Math.random() * Math.PI * 2,
      });
    }

    let raf = 0;
    let t = 0;
    const render = () => {
      t += thinking ? 0.014 : 0.004;
      ctx.clearRect(0, 0, size, size);
      const pulse = thinking ? 1 + Math.sin(t * 3.2) * 0.06 : 1 + Math.sin(t * 1.2) * 0.025;
      const R = 110 * pulse;
      const cosA = Math.cos(t);
      const sinA = Math.sin(t);
      const cosB = Math.cos(t * 0.55);
      const sinB = Math.sin(t * 0.55);
      const proj = points.map((p) => {
        let x = p.x * cosA + p.z * sinA;
        let z = -p.x * sinA + p.z * cosA;
        const y = p.y * cosB - z * sinB;
        z = p.y * sinB + z * cosB;
        const scale = 1 / (1.8 - z);
        return { x: cx + x * R * scale, y: cy + y * R * scale, z, scale, phase: p.phase };
      });
      for (let i = 0; i < proj.length; i++) {
        for (let j = i + 1; j < proj.length; j++) {
          const a = proj[i]; const b = proj[j];
          const dx = a.x - b.x; const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < 46) {
            const base = ((46 - d) / 46) * ((a.z + b.z) / 2 + 1) / 2;
            const flow = thinking ? 0.55 + Math.sin(t * 3 + a.phase) * 0.25 : 0.35;
            const alpha = base * flow;
            const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
            grad.addColorStop(0, `rgba(0,229,255,${alpha})`);
            grad.addColorStop(1, `rgba(124,58,237,${alpha})`);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 0.55;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const p of proj) {
        const alpha = (p.z + 1) / 2;
        const nodePulse = thinking ? 0.7 + Math.sin(t * 4 + p.phase) * 0.3 : 0.85;
        ctx.fillStyle = `rgba(245,245,255,${(0.35 + alpha * 0.55) * nodePulse})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.9 + alpha * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 90);
      glow.addColorStop(0, thinking ? "rgba(124,58,237,0.45)" : "rgba(59,130,246,0.28)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);
      raf = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(raf);
  }, [thinking]);

  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="absolute h-[300px] w-[300px] rounded-full border border-[#3B82F6]/15" style={{ animation: "v-spin-slow 36s linear infinite" }} />
        <div className="absolute h-[230px] w-[230px] rounded-full border border-[#7C3AED]/12" style={{ animation: "v-spin-rev 48s linear infinite" }} />
        <svg className="absolute h-[300px] w-[300px]" viewBox="0 0 100 100" style={{ animation: "v-spin-slow 60s linear infinite" }}>
          <circle cx="50" cy="50" r="44" fill="none" stroke="#00E5FF" strokeOpacity="0.25" strokeWidth="0.25" strokeDasharray="1 4" style={{ animation: thinking ? "v-orbit-dash 12s linear infinite" : "v-orbit-dash 40s linear infinite" }} />
        </svg>
        {thinking && (
          <>
            <span className="absolute h-[180px] w-[180px] rounded-full border border-[#00E5FF]/30" style={{ animation: "v-ring 2.4s ease-out infinite" }} />
            <span className="absolute h-[180px] w-[180px] rounded-full border border-[#7C3AED]/25" style={{ animation: "v-ring 2.4s ease-out 1.2s infinite" }} />
          </>
        )}
      </div>
      <canvas ref={canvasRef} style={{ width: 320, height: 320 }} className="relative" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className={`h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_24px_#00E5FF,0_0_48px_#7C3AED] ${thinking ? "animate-[v-pulse-core_1.4s_ease-in-out_infinite]" : "animate-[v-pulse-core_4s_ease-in-out_infinite]"}`} />
      </div>
    </div>
  );
}