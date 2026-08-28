# My Study Guide — Backend API

REST API for the My Study Guide platform, built with **Node.js + Express + AWS DynamoDB**, JWT authentication, role-based authorization, and Cloudinary uploads.

## Tech Stack

- **Express 4** — HTTP server & routing
- **AWS DynamoDB** (`@aws-sdk/lib-dynamodb`) — database
- **Custom Mongoose-compatible ODM** (`src/db/`) — Schema/model API over DynamoDB
- **JWT (jsonwebtoken)** — stateless auth
- **bcryptjs** — password hashing
- **Cloudinary + Multer** — image/file uploads
- **helmet, cors, express-rate-limit, morgan** — security & logging

## Getting Started

```bash
cd backend
npm install
cp .env.example .env        # then fill in the values
npm run create-tables       # provision DynamoDB tables (idempotent; also runs on boot)
npm run seed                # optional: load sample data
npm run dev                 # starts on http://localhost:5000
```

> Requires AWS DynamoDB access (set `AWS_REGION` + credentials), **or** a local
> DynamoDB for offline dev. Tables are created automatically on startup.

#### Offline / no‑AWS: one‑command local database

If you have Docker installed you don't need an AWS account to try the app:

```bash
cd backend
docker compose up -d                          # starts DynamoDB Local on :8000
# in backend/.env set: DYNAMODB_ENDPOINT=http://localhost:8000
npm install
npm run seed                                  # creates tables + sample data
npm run dev                                    # http://localhost:5000
```

Throw‑away credentials are used automatically in local mode. Stop the database
later with `docker compose down`.

### Data layer notes

The app originally used MongoDB/Mongoose. It now runs on DynamoDB via a small
Mongoose-compatibility ODM in `src/db/` (`Schema`, `model`, documents with
`.save()`/hooks/methods, chainable `find/sort/limit/select/populate`, a focused
`aggregate` interpreter, and Mongo-style query/update operators). Storage is one
table per model, keyed by a uuid `_id`. Reads other than get-by-id use Scan +
in-memory filtering, which preserves Mongoose query semantics; for larger
datasets, add Global Secondary Indexes in `src/db/createTables.js` and teach the
ODM to Query instead of Scan. Full-text question search falls back to in-memory
word matching (see `searchController`).

Seeded credentials:
- Admin: `admin@mystudyguide.com` / `admin123`
- Student: `student@mystudyguide.com` / `student123`

## Project Structure

```
src/
├── config/        # dynamo client, cloudinary, mailer, etc.
├── db/            # DynamoDB ODM (odm.js, helpers.js, aggregate.js, createTables.js)
├── controllers/   # request handlers (business logic)
├── middleware/    # auth (protect/authorize) & error handling
├── models/        # schema definitions (Mongoose-compatible API over DynamoDB)
├── routes/        # Express routers
├── scripts/       # create-tables CLI & ODM verification harness
├── utils/         # token generation & seed script
├── app.js         # express app (middleware + routes)
└── server.js      # entry point (ensures tables, starts server)
```

## API Overview

### Auth — `/api/auth`
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/register` | Public | Register + issue email verification token |
| POST | `/login` | Public | Email/password login |
| POST | `/google` | Public | Google OAuth login |
| GET | `/verify-email/:token` | Public | Verify email |
| POST | `/forgot-password` | Public | Request reset link |
| POST | `/reset-password/:token` | Public | Set new password |
| GET | `/me` | Auth | Current user |

### Content — `/api`
| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/subjects` | Public |
| POST/PUT/DELETE | `/subjects/:id` | Admin |
| GET | `/subjects/:subjectId/sessions` | Public |
| POST/PUT/DELETE | `/sessions/:id` | Admin |
| GET | `/sessions/:sessionId/questions` | Public (answers hidden) |
| POST | `/questions` / `/questions/bulk` | Admin |
| PUT/DELETE | `/questions/:id` | Admin |

### Test Series — `/api/tests`
| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/` (`?category=`) | Public |
| GET | `/:id` | Auth |
| POST | `/:id/submit` | Auth |
| POST/PUT/DELETE | `/:id` | Admin |
| PATCH | `/:id/publish` | Admin |

### Users — `/api/users` (Admin)
`GET /` · `PATCH /:id/status` · `PATCH /:id/plan` · `POST /:id/reset-password`

### Analytics
`GET /api/admin/analytics` (Admin) · `GET /api/me/dashboard` (Auth) · `GET /api/leaderboard` (Public)

### Uploads
`POST /api/upload` (Admin) — multipart `file`, returns Cloudinary URL.

## Auth & Roles

Send the JWT as `Authorization: Bearer <token>`.
- `protect` middleware validates the token and blocks suspended accounts.
- `authorize("admin")` restricts admin-only routes.
