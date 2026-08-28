# My Study Guide

A modern, responsive, **full-stack** educational platform for **quizzes and test-series preparation**.
Blue/white/orange theme, dark + light mode, smooth animations, charts, dashboards and a full admin panel.

```
.
├── frontend/      # React + Vite + Tailwind CSS (UI for all modules)
├── backend/       # Node.js + Express + DynamoDB REST API (JWT auth, Cloudinary)
└── DEPLOYMENT.md  # Step-by-step guide to publish the full app online
```

> **Real mode is wired up:** the frontend talks to the backend API for real login/registration
> (JWT), database-backed subjects, sessions, questions, quiz attempts, test grading, dashboard
> analytics, leaderboard, and the admin panel. Set `VITE_API_URL` in the frontend and run the
> backend with a DynamoDB connection (AWS or DynamoDB Local). See **[DEPLOYMENT.md](DEPLOYMENT.md)** to go live.

## 🚀 Run locally (real mode)

```bash
# 1) Backend  (needs AWS DynamoDB, or DynamoDB Local for offline dev)
cd backend
npm install
cp .env.example .env          # set AWS_REGION + credentials (or DYNAMODB_ENDPOINT), JWT_SECRET
npm run create-tables         # provision DynamoDB tables (idempotent)
npm run seed                  # sample data + admin/student logins
npm run dev                   # http://localhost:5000

# 2) Frontend  (in a second terminal)
cd frontend
npm install
cp .env.example .env          # VITE_API_URL=http://localhost:5000/api
npm run dev                   # http://localhost:5173
```

Seeded logins: **admin@mystudyguide.com / admin123** · **student@mystudyguide.com / student123**

## ✨ Features

**Public site**
- Landing page — hero ("Prepare Smart, Achieve More."), features, stats, footer with social links
- Quiz module — 12 subjects → chapter sessions → interactive quiz player
  - One question at a time, correct option turns **green**, wrong turns **red** (correct auto-revealed)
  - Timer, question palette, bookmark, explanation, progress bar, auto-save, submit
  - Result page — score, %, time, rank, performance charts, weak-topic analysis, answer review
- About & Contact pages

**Auth**
- Login, Register (with email-verification step), Forgot Password, Google login button

**Student Dashboard** (auth required)
- Profile, enrolled series, upcoming/completed tests, recent scores, analytics charts, leaderboard, notifications

**Test Series** (login to start)
- Full-length / subject-wise / chapter-wise / previous-year tabs
- Full-screen test interface — countdown with auto-submit, palette with statuses, mark-for-review, save & next

**Admin Panel** (role-based)
- Dashboard analytics (revenue, attempts, subscriptions)
- Content management (subjects, sessions, questions) with CRUD, bulk CSV upload, image upload
- Test-series management (create, schedule, publish/unpublish)
- User management (view, block/unblock, plans, reset password)
- Customization (logo, theme colours, banners, notifications, announcements)

## 🚀 Run the frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The frontend runs fully standalone using local sample data, so you can explore every screen immediately.

**Try it:**
- Student: log in at `/login` with any email/password → redirected to the dashboard
- Admin: go to `/admin/login` (any password) → full admin panel

## 🔌 Run the backend (optional, for real data)

```bash
cd backend
npm install
cp .env.example .env     # fill AWS/DynamoDB config, JWT_SECRET, Cloudinary keys
npm run seed             # sample data + admin@mystudyguide.com / admin123
npm run dev              # http://localhost:5000
```

See [`backend/README.md`](backend/README.md) for the full API reference.

## 🛠 Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React, Vite, Tailwind CSS, React Router, Chart.js, lucide-react |
| Backend | Node.js, Express, AWS DynamoDB (custom Mongoose-compatible ODM), JWT, bcrypt, Cloudinary, Multer |
| Cross-cutting | Dark/light mode, responsive design, SEO meta tags, role-based auth |

## 🔗 Connecting frontend to backend

The frontend currently uses local sample data (`src/data/*`) and a demo auth context so it works without a server. To go live, replace those reads with `fetch`/axios calls to the API base URL (e.g. `VITE_API_URL=http://localhost:5000/api`) and store the returned JWT — the endpoints already exist in the backend.
