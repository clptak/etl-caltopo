# AWS cheat sheet (for the etl-caltopo deployment)

Everything here is typed in **Terminal on your Mac**. The AWS account is `ccso`, region
`us-east-1`.

## Sign in

```bash
aws login --profile ccso --region us-east-1
```

1. A browser tab opens on the AWS sign-in page. If it doesn't, the terminal prints a link:
   open it yourself.
2. Sign in with the account email and password (and the MFA code, if you set one up).
3. Approve the request when the page asks to allow the AWS CLI.
4. Back in Terminal, you see a "logged in" message. You can close the browser tab.

That one sign-in covers every `aws` command run on this Mac, Claude's included, until it
expires (several hours; at most 12). After that, sign in again the same way.

## Check you're signed in

```bash
aws sts get-caller-identity --profile ccso
```

If it prints an `Account` number, you're signed in. If it prints an error, see the table below.

## Common errors

| You see | What to do |
|---|---|
| `Your session has expired. Please reauthenticate using 'aws login'` | Sign in again (above) |
| `Unable to locate credentials` | You left out `--profile ccso`, or you've never signed in on this Mac |
| A Python traceback ending in `Library not loaded … libaws-c-…dylib` | A Homebrew update broke the CLI. Run `brew upgrade awscli` |
| `AccessDenied` | You're signed in to the wrong account. Run the check above and compare the Account number |

## Optional: skip typing `--profile ccso`

Add this line to the end of `~/.zshrc`, then open a new Terminal window:

```bash
export AWS_PROFILE=ccso AWS_REGION=us-east-1
```

After that, `aws login` and `aws sts get-caller-identity` work on their own.

## Never

- Never paste access keys, secrets or tokens into chat, email or a ticket.
- Never create access keys for the root account. The VPS uses the separate `CloudTAKUser`
  key from `deploy/cloudtak-etl.yml`.
- Don't set `AWS_REGION` to anything but `us-east-1` on a CloudTAK compose box (Garage storage
  only accepts that region).

## Where things are in the AWS console (browser)

Sign in at <https://console.aws.amazon.com>, and pick **N. Virginia (us-east-1)** at the
top right.

| To see | Go to |
|---|---|
| A Layer's Lambda logs | CloudWatch → Log groups → `/aws/lambda/<StackName>-layer-<id>` |
| Layer stacks | CloudFormation → Stacks (`test`, `test-layer-1`, …) |
| Pushed ETL images | ECR → Repositories → `tak-vpc-ccso-dev-cloudtak-tasks` |
| Spending | Billing → Budgets (`test-cloudtak-etl`, $5/month alert) |
