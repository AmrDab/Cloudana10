import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

const NODE_COUNT = 60;
const CONNECTION_DIST = 180;
const SPEED = 0.35;

export default function NetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      canvas!.width = canvas!.offsetWidth * window.devicePixelRatio;
      canvas!.height = canvas!.offsetHeight * window.devicePixelRatio;
      ctx!.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    resize();
    window.addEventListener("resize", resize);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    nodesRef.current = Array.from({ length: NODE_COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * SPEED * 2,
      vy: (Math.random() - 0.5) * SPEED * 2,
      radius: 2 + Math.random() * 2.5,
    }));

    function draw() {
      const cw = canvas!.offsetWidth;
      const ch = canvas!.offsetHeight;
      ctx!.clearRect(0, 0, cw, ch);

      const nodes = nodesRef.current;

      // Update positions
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > cw) n.vx *= -1;
        if (n.y < 0 || n.y > ch) n.vy *= -1;
        n.x = Math.max(0, Math.min(cw, n.x));
        n.y = Math.max(0, Math.min(ch, n.y));
      }

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const opacity = (1 - dist / CONNECTION_DIST) * 0.3;
            ctx!.beginPath();
            ctx!.moveTo(nodes[i].x, nodes[i].y);
            ctx!.lineTo(nodes[j].x, nodes[j].y);
            ctx!.strokeStyle = `rgba(8,145,178,${opacity})`;
            ctx!.lineWidth = 1;
            ctx!.stroke();
          }
        }
      }

      // Draw nodes
      for (const n of nodes) {
        // Glow
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.radius + 3, 0, Math.PI * 2);
        ctx!.fillStyle = "rgba(8,145,178,0.08)";
        ctx!.fill();
        // Core
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx!.fillStyle = "rgba(8,145,178,0.45)";
        ctx!.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}
