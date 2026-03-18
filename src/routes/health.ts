import { CORS_HEADERS } from "../cors.js";
const BASE_URL = "https://h49mycoe4e.execute-api.ap-southeast-2.amazonaws.com/Prod";

export async function getHealth(_event: any) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>GoosePatrol Health</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: #e2e8f0;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      padding: 3rem 4rem;
      text-align: center;
      backdrop-filter: blur(12px);
      box-shadow: 0 25px 50px rgba(0,0,0,0.4);
      max-width: 480px;
      width: 90%;
    }
    .status-dot {
      display: inline-block;
      width: 12px; height: 12px;
      background: #22c55e;
      border-radius: 50%;
      margin-right: 8px;
      animation: pulse 2s infinite;
      vertical-align: middle;
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
      50%       { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
    }
    .status-label {
      font-size: 0.85rem; font-weight: 600;
      color: #22c55e; text-transform: uppercase; letter-spacing: 0.1em;
    }
    h1 {
      font-size: 2.8rem; font-weight: 700;
      margin: 1.2rem 0 0.4rem;
      background: linear-gradient(90deg, #f8fafc, #94a3b8);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle { font-size: 0.9rem; color: #64748b; margin-bottom: 2rem; }
    .divider { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 1.5rem 0; }
    .time-label { font-size: 0.75rem; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.4rem; }
    #server-time { font-size: 1.3rem; font-weight: 600; font-variant-numeric: tabular-nums; color: #cbd5e1; }
    .btn {
      display: inline-block; margin-top: 2rem;
      padding: 0.85rem 2.2rem;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      color: #fff; font-size: 0.95rem; font-weight: 600;
      border: none; border-radius: 12px; cursor: pointer;
      text-decoration: none;
      transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
      box-shadow: 0 4px 15px rgba(99,102,241,0.35);
    }
    .btn:hover { opacity: 0.92; transform: translateY(-2px); box-shadow: 0 8px 25px rgba(99,102,241,0.5); }
    .btn:active { transform: translateY(0); }
  </style>
</head>
<body>
  <div class="card">
    <div>
      <span class="status-dot"></span>
      <span class="status-label">Operational</span>
    </div>
    <h1>GoosePatrol 🪿</h1>
    <p class="subtitle">Despatch &amp; Order Management API</p>
    <hr class="divider" />
    <div class="time-label">Server Time</div>
    <div id="server-time">--:--:--</div>
    <br />
    <a class="btn" href="${BASE_URL}/docs">View API Documentation</a>
  </div>
  <script>
    function tick() {
      document.getElementById('server-time').textContent =
        new Date().toLocaleString('en-AU', {
          timeZone: 'UTC', year: 'numeric', month: 'short',
          day: '2-digit', hour: '2-digit', minute: '2-digit',
          second: '2-digit', hour12: false,
        }) + ' UTC';
    }
    tick();
    setInterval(tick, 1000);
  </script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: html,
  };
}