# Turn On the DynamoDB Version — Simple Guide (no coding needed)

Your app's code is now ready to use **Amazon DynamoDB** instead of MongoDB.
The code work is done. The only remaining steps happen in **your own accounts**,
because a database and its keys must live under your name. Follow the parts
below in order. It should take about 15–20 minutes.

> ✅ You will NOT write any code. You'll click buttons and copy‑paste a few values.

---

## Part A — Create your Amazon (AWS) keys

1. Go to **https://aws.amazon.com/** and click **Create an AWS Account** (free to
   sign up; a card is required but the free tier covers this app).
2. Once signed in, in the top search bar type **IAM** and open it.
3. Left menu → **Users** → **Create user**. Give it a name like `mystudyguide-app`.
4. On permissions, choose **Attach policies directly** and tick
   **AmazonDynamoDBFullAccess**. Finish creating the user.
5. Open the new user → **Security credentials** tab → **Create access key** →
   choose **Application running outside AWS** → Create.
6. Copy the two values it shows you and keep them safe:
   - **Access key ID**
   - **Secret access key**  *(you can only see this once — save it now)*
7. Note your **Region** (top‑right of the AWS page), e.g. `us-east-1`.

That's the only part only you can do. 🎉

---

## Part B — Give those keys to your backend host

If your backend runs on **Render** (from the deployment guide):

1. Go to **https://dashboard.render.com/** → open your backend service.
2. Left menu → **Environment** → add these variables (click "Add Environment Variable" for each):

   | Name | Value |
   |------|-------|
   | `AWS_REGION` | your region, e.g. `us-east-1` |
   | `AWS_ACCESS_KEY_ID` | the Access key ID from Part A |
   | `AWS_SECRET_ACCESS_KEY` | the Secret access key from Part A |
   | `DYNAMODB_TABLE_PREFIX` | `msg_` |

3. **Keep** your existing `JWT_SECRET`, Cloudinary, and email variables.
   You can **delete** the old `MONGO_URI` — it's no longer used.
4. Click **Save Changes**.

---

## Part C — Deploy the new code

Once Part B is saved, the new DynamoDB code needs to go live:
- If a helper merges the pull request titled **"Migrate backend from MongoDB/
  Mongoose to AWS DynamoDB"**, or you click **Merge** on it in GitHub, your host
  will redeploy automatically.
- On startup the app **creates its own database tables automatically** — you
  don't do anything for that.

> ⚠️ Do Part B **before** deploying, so the app has its keys the moment it starts.

---

## Part D — Load the starter data (one time)

This creates the sample content and your admin login.

- On Render: open your backend service → **Shell** tab → type:
  ```
  npm run seed
  ```
- This creates:
  - Admin: `admin@mystudyguide.com` / `admin123`
  - Student: `student@mystudyguide.com` / `student123`

> 🔒 Change the admin password after your first login.

---

## Part E — Check it worked

Open your backend URL with `/api/health` on the end, for example:
`https://your-backend.onrender.com/api/health`

You should see a small message that includes `"status":"ok"`. Done! 🎉

---

### No AWS account and just want to *see* it run first?
If someone with a computer wants to try it locally with **no AWS account at
all**, see `backend/README.md` → "Offline / no‑AWS: one‑command local database".
