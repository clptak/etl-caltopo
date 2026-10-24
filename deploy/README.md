# Deploying the ETL to AWS from a self-hosted CloudTAK

CloudTAK deploys every ETL Layer as its own CloudFormation stack - a Lambda, its schedule,
log group, alarms and (for Outgoing Layers) SQS queues - using the AWS credentials it runs
with. CloudTAK itself does not need to run in AWS. `cloudtak-etl.yml` creates what those
Layer stacks expect to find in the account.

```
CloudTAK (self-hosted) ──CloudFormation──► <StackName>-layer-<id> stack ─► Lambda (every minute)
        ▲                                                                    │
        └──────────────── HTTPS, ETL token (ETL_API = CloudTAKUrl) ──────────┘
```

| Piece | Where |
| ----- | ----- |
| Image repository `tak-vpc-<Environment>-cloudtak-tasks` | this stack |
| Role the Lambdas run as (export `<StackName>-etl-role`) | this stack |
| CloudTAK's URL (export `<StackName>-hosted`) | this stack, from `CloudTAKUrl` |
| IAM user CloudTAK runs as - only Layer stacks, nothing else | this stack; its access key is created by hand |
| Monthly budget alert | this stack |

The stack **must be named CloudTAK's `StackName`** - CloudTAK reads it and names Layer stacks
after it. A dev CloudTAK without `StackName` uses `test`.

## Steps

Commands assume region `us-west-2`, Environment `ccso-dev` and a dev CloudTAK (`test`).

1. **Tools**: `brew install awscli cloudflared`, then sign in with an account admin profile
   (`aws configure sso` or `aws configure`) - those credentials are only used for steps 3-5.

2. **Public URL for CloudTAK** - the Lambdas post back over the internet. For a dev CloudTAK
   a temporary tunnel is enough:

   ```sh
   cloudflared tunnel --url http://localhost:5001
   ```

   A quick tunnel gets a new URL every time it starts, and CloudFormation will not change the
   `-hosted` export while a Layer stack imports it - delete the Layer stacks first, or use a
   named tunnel with a fixed hostname for anything longer lived.

3. **Deploy this stack**

   ```sh
   aws cloudformation deploy --region us-west-2 --stack-name test \
       --template-file deploy/cloudtak-etl.yml --capabilities CAPABILITY_IAM \
       --parameter-overrides Environment=ccso-dev CloudTAKUrl=https://<tunnel host> BudgetEmail=<you>
   ```

4. **CloudTAK's access key** - IAM console → Users → the `CloudTAKUserName` output → Security
   credentials → Create access key ("Application running outside AWS"). Keep it out of git.

5. **Build & push the image** from this repo's root - tagged `etl-caltopo-v<package.json version>`.
   `.dockerignore` keeps the local settings files (credentials) out of the image.

   ```sh
   AWS_REGION=us-west-2 AWS_ACCOUNT_ID=<account id> Environment=ccso-dev npx cloudtak-etl
   ```

6. **Run CloudTAK against AWS** - with the access key from step 4, without the local
   emulator variables (`AWS_ENDPOINT_URL_SQS` / `_STS`):

   ```sh
   AWS_REGION=us-west-2 ECR_TASKS_REPOSITORY_NAME=tak-vpc-ccso-dev-cloudtak-tasks \
   AWS_ACCESS_KEY_ID=<key> AWS_SECRET_ACCESS_KEY=<secret> \
   npx tsx watch index.ts --no-events --no-geofence
   ```

   Stop `scripts/dev-queue.ts` - the Lambda reads the Outgoing queue now.

7. **Deploy the Layer** - save the Layer in CloudTAK (or use its Redeploy action); CloudTAK
   creates the `test-layer-<id>` stack. Check it reaches `CREATE_COMPLETE`, then the Lambda's
   log group `/aws/lambda/test-layer-<id>` for the scheduled runs.

## Tearing down

Delete the Layers in CloudTAK (or their `test-layer-<id>` stacks), then this stack, then the
images in the repository if CloudFormation refuses to delete a non-empty repository. Delete
the CloudTAK user's access key with it.
