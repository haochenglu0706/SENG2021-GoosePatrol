# Deploy and test auth (register) on Lambda

Minimal deploy: one Lambda (handler → router → auth), API Gateway, and DynamoDB **Clients** + **Sessions** tables.

## Prerequisites

- AWS CLI configured (`aws configure`)
- [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) installed
- Node 20+ and `npm install` already run in the project root
- **esbuild** on your PATH so SAM can bundle the Lambda. If `sam build` fails with "Cannot find esbuild", either:
  - Run from the project root with local esbuild:  
    `PATH="$(pwd)/node_modules/.bin:$PATH" sam build`
  - Or install globally: `npm install -g esbuild`

## 1. Build

From the project root:

```bash
npm run build
# or: sam build
```

This uses esbuild (via SAM) to bundle `src/handler.ts` and all dependencies (router, auth, db, AWS SDK, uuid, etc.) into a single deployment artifact. Only that bundle and its runtime dependencies are deployed.

## 2. Deploy

First time (guided):

```bash
sam deploy --guided
```

- Stack name: e.g. `goosepatrol-auth`
- Region: your choice (e.g. `ap-southeast-2`)
- Confirm defaults; allow SAM to create the IAM role and save the config to `samconfig.toml`.

Later deploys:

```bash
sam deploy
```

## 3. Get the API URL

After deploy, SAM prints the API endpoint, or:

```bash
aws cloudformation describe-stacks \
  --stack-name goosepatrol-auth \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text
```

Example: `https://xxxxxxxxxx.execute-api.ap-southeast-2.amazonaws.com/Prod/`

## 4. Test register (create a user)

Replace `BASE_URL` with your API endpoint (no trailing slash):

```bash
export BASE_URL="https://xxxxxxxxxx.execute-api.ap-southeast-2.amazonaws.com/Prod"

curl -X POST "$BASE_URL/clients" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"securePass1"}'
```

Expected: `201` and a JSON body with `clientId` and `username`.

## 5. Verify in DynamoDB

In the AWS Console: **DynamoDB → Tables → Clients → Explore table items**. You should see an item with `clientId`, `username`, and `passwordHash`.

Or with the CLI:

```bash
aws dynamodb scan --table-name Clients
```

## Optional: test login (session)

```bash
curl -X POST "$BASE_URL/sessions" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"securePass1"}'
```

Expected: `201` with `sessionId` and `clientId`. A new item will appear in the **Sessions** table.

## Files involved in the deploy

- **template.yaml** – Defines the Lambda (ApiFunction), API Gateway routes (`POST /clients`, `POST /sessions`), and DynamoDB tables (Clients, Sessions).
- **src/handler.ts** – Lambda entry; calls `route(event)`.
- **src/router.ts** – Routes `POST /clients` → `auth.register`, `POST /sessions` → `auth.login`.
- **src/routes/auth.ts** – Register and login logic.
- **src/db.ts** – DynamoDB client and table names from env.

SAM build bundles these (and their dependencies) into a single artifact; you don’t upload individual files by hand.
