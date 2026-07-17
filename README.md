# Mari 好房

Mobile-first mini app for a Melaka property agent. v17 keeps an offline browser copy and syncs leads, listings and cases to the included server API. The server stores shared listings in `shares.json` and workspace state in `agent-state.json`.

Run locally:

```bash
cd property-agent-mini
python3 server.py
```

Open `http://localhost:8080`.

For production, run this server behind HTTPS with authentication and persistent storage. A `trycloudflare.com` quick tunnel is for temporary previews only and does not provide a fixed hostname or uptime guarantee.
