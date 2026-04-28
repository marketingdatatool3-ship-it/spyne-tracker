# Spyne Content & Design Tracker

Internal platform for the Spyne SEO & content team to manage content items and assign them to designers. Built with Node.js, Express, and SQLite (sql.js — zero native dependencies, deploys anywhere).

---

## Features

- **Role-based login** — Admin, Content team, Design team
- **Add content items** with keyword, type, category, cluster, writer, content status
- **Assign to designers** directly from the form — designer sees only their queue
- **Track full pipeline** — Assigned → Writing → Review → Design → Published
- **Table + Kanban board** view
- **Stats dashboard** — by type, by writer
- **Activity log** per item
- **Team management** — admin can add/remove users and set roles
- **Profile page** — update name, password, avatar color

---

## Default Login

```
Email:    admin@spyne.ai
Password: spyne2024
```

**Change this immediately after first login via Profile.**

---

## Deploy to Railway

### Step 1 — Push to GitHub

```bash
cd spyne-platform
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/spyne-tracker.git
git push -u origin main
```

### Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) → **New Project**
2. Click **Deploy from GitHub repo** → select `spyne-tracker`
3. Railway auto-detects Node.js and runs `npm install && node server.js`

### Step 3 — Set environment variables in Railway

In your Railway project → **Variables** tab, add:

| Variable | Value | Notes |
|---|---|---|
| `JWT_SECRET` | `some-long-random-string` | Use a strong random value |
| `DB_PATH` | `/data/tracker.sqlite` | Path for persistent storage |

### Step 4 — Add a Volume (persistent database)

Railway's filesystem resets on redeploy unless you use a Volume:

1. In your Railway service → **Volumes** tab → **Add Volume**
2. Mount path: `/data`
3. This ensures your SQLite database persists across deploys

### Step 5 — Generate domain

In Railway → **Settings** → **Networking** → **Generate Domain**

Your app will be live at `https://your-app.up.railway.app`

---

## Add users

Log in as admin → **Team Members** → **Add User**

Set role to:
- `admin` — full access + user management
- `content` — can add and edit all content items
- `design` — sees only their assigned tasks, can update design status/dates

---

## Local development

```bash
npm install
node server.js
# Open http://localhost:3000
```

---

## Tech stack

- **Backend**: Node.js + Express
- **Database**: SQLite via sql.js (pure JS, no native build needed)
- **Auth**: JWT in HTTP-only cookies + bcrypt passwords
- **Frontend**: Vanilla JS SPA (no build step)
- **Deploy**: Railway (Nixpacks auto-detected)
