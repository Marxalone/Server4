# MarxBot Analytics Dashboard

Real-time analytics system for WhatsApp bots built with Baileys.

## Features

- Track user activity via simple HTTP POST
- Real-time dashboard with animated counters
- Neon blue futuristic UI
- Responsive design for all devices
- Automatic calculations for:
  - Total unique users
  - Concurrent users (active in last 30 mins)
  - Disconnected users (inactive for 12 hours)

## Deployment

1. **Render.com** (recommended):
   - Push this repo to GitHub
   - Create new Web Service on Render
   - Connect your GitHub repo
   - Render will automatically detect the `.render.yaml` file

2. **Manual deployment**:
   ```bash
   npm install express morgan
   node server.js