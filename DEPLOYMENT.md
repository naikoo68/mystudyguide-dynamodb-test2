# Deploying My Study Guide (Real Mode)

This guide publishes the **full application**: a live backend API + AWS DynamoDB database, and the frontend connected to it. You'll deploy three things:

1. **Database** → AWS DynamoDB (pay-per-request; generous free tier)
2. **Backend API** → Render (free)
3. **Frontend** → Vercel (free)

Do them in this order.

---

## 1. Database — AWS DynamoDB

DynamoDB is serverless — there is no cluster to provision. You only need AWS
credentials the backend can use; the app creates its tables automatically on
first boot (on-demand / pay-per-request billing).

1. Sign in to the [AWS Console](https://console.aws.amazon.com/) and pick a region (e.g. `us-east-1`).
2. **IAM → Users → Create user** (programmatic access). Attach a policy that
   allows DynamoDB access — `AmazonDynamoDBFullAccess` is simplest, or scope it
   to `CreateTable`, `DescribeTable`, and the item ops (`GetItem`, `PutItem`,
   `DeleteItem`, `Scan`, `BatchWriteItem`) on `msg_*` tables.
3. Create an **access key** for that user and save the **Access key ID** and
   **Secret access key**.
4. That's it — tables (`msg_User`, `msg_Question`, …) are created on the first
   backend start, or you can run `npm run create-tables` manually.

> **Local development:** instead of AWS, run
> [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html)
> and set `DYNAMODB_ENDPOINT=http://localhost:8000` — no real AWS keys needed.

---

## 2. Backend API — Render

1. Sign up at [render.com](https://render.com) with GitHub.
2. **New → Web Service** → connect the **My-Study-Guide** repo.
3. Configure:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add **Environment Variables** (Advanced → Add Environment Variable):

   | Key | Value |
   |-----|-------|
   | `AWS_REGION` | your DynamoDB region, e.g. `us-east-1` |
   | `AWS_ACCESS_KEY_ID` | the IAM user's access key ID |
   | `AWS_SECRET_ACCESS_KEY` | the IAM user's secret access key |
   | `DYNAMODB_TABLE_PREFIX` | `msg_` (optional; namespaces the tables) |
   | `JWT_SECRET` | any long random text |
   | `JWT_EXPIRES_IN` | `7d` |
   | `CLIENT_URL` | your Vercel URL (add after step 3, e.g. `https://mystudyguideme.vercel.app`) |
   | `NODE_ENV` | `production` |

5. Click **Create Web Service**. When it's live you'll get a URL like
   `https://my-prep-mart-api-39nk.onrender.com`.
6. Test it: open `https://my-prep-mart-api-39nk.onrender.com/api/health` → should show `{"status":"ok"}`.

### Seed the database (one time)
In Render → your service → **Shell** tab, run:
```bash
npm run seed
```
This creates sample data + the accounts:
- Admin: `admin@mystudyguide.com` / `admin123`
- Student: `student@mystudyguide.com` / `student123`

> ⚠️ Change the admin password after first login in production.

---

## 3. Frontend — Vercel

1. Sign up at [vercel.com](https://vercel.com) with GitHub.
2. **Add New → Project** → import **My-Study-Guide**.
3. Configure:
   - **Root Directory:** `frontend`
   - Framework Preset: **Vite** (auto-detected)
4. Add an **Environment Variable**:

   | Key | Value |
   |-----|-------|
   | `VITE_API_URL` | `https://my-prep-mart-api-39nk.onrender.com/api` |

5. Click **Deploy**. You'll get a URL like `https://mystudyguideme.vercel.app`.

### Final step — connect CORS
Go back to **Render → Environment** and set `CLIENT_URL` to your exact Vercel URL, then save (the service redeploys). This allows the browser to call the API.

---

## You're live! 🎉

- Visit your Vercel URL.
- Log in as the seeded student or admin, or register a new account.
- Quizzes, test series, dashboard analytics, leaderboard and the admin panel now read/write the real database.

## Notes & tips

- **Free Render services sleep** after inactivity; the first request may take ~30s to wake. That's normal on the free tier.
- **Image uploads (Cloudinary)** and **Google login** are optional. To enable them, add the matching keys from `backend/.env.example` to Render and configure Google OAuth.
- **Local development:** run the backend (`npm run dev` in `backend`) and frontend (`npm run dev` in `frontend`) with `VITE_API_URL=http://localhost:5000/api`. See `backend/README.md` for the API reference.


---

## Automatic deployments (every push goes live)

Both hosts are connected to this GitHub repo, so **every push to the `main` branch redeploys automatically** — no manual step. This is native Git integration; you don't need any deploy tokens or scripts in the repo.

### How it flows
```
git push  ->  GitHub (main)  ->  CI build check (.github/workflows/ci.yml)
                                   |
                                   +--> Vercel  rebuilds & deploys the frontend
                                   +--> Render  rebuilds & deploys the backend
```

### Verify it's enabled
- **Vercel** → Project → **Settings → Git**: the repo is connected and **Production Branch** is `main`. Every push to `main` publishes to production; pushes to other branches / PRs get a **Preview** URL automatically.
- **Render** → Web Service → **Settings**: **Auto-Deploy** is `Yes` and the branch is `main`. Each push triggers a new deploy.

### Safety net (CI)
`.github/workflows/ci.yml` runs on every push and PR to `main`:
- **Frontend:** `npm ci` → `npm run lint` → `npm run build`
- **Backend:** `npm ci` → syntax-check all source files

If the build fails, you'll see a red check on the commit/PR before (or alongside) the deploy — so you catch breakage early instead of shipping it.

### Optional: only rebuild what changed
By default both services rebuild on *any* push, even a docs-only change.
- **Vercel** → Settings → Git → **Ignored Build Step**: `git diff --quiet HEAD^ HEAD -- frontend` (skips the build when nothing under `frontend/` changed).
- **Render** → Settings → **Build Filters**: set included path to `backend/**`.

### Notes
- The existing `npm-publish-github-packages.yml` workflow only runs on GitHub *releases* (publishing an npm package) and is unrelated to the Vercel/Render deploys above.
- `keep-alive.yml` pings the backend every 10 minutes so the free Render instance doesn't sleep — it does **not** deploy anything.
