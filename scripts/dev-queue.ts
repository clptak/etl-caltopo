/**
 * Stand in for the Lambda SQS trigger in local development: create the dev Layer's
 * Outgoing queue in a local SQS emulator and hand each message to the Outgoing handler
 *
 * CloudTAK sends to the queue when it runs with AWS_ENDPOINT_URL_SQS pointing at the
 * same emulator - see docs/LOCAL_DEV.md
 *
 * Usage: npx tsx scripts/dev-queue.ts
 *   SQS_ENDPOINT Local SQS emulator          (default http://localhost:9324)
 *   STACK_NAME   CloudTAK StackName          (default test)
 */
import fs from 'node:fs';
import process from 'node:process';
import SQS from '@aws-sdk/client-sqs';

const endpoint = process.env.SQS_ENDPOINT || 'http://localhost:9324';
const stack = process.env.STACK_NAME || 'test';

const layer = JSON.parse(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')).ETL_LAYER;
if (!layer) throw new Error('No ETL_LAYER in .env - run scripts/dev-layer.sh first');

// The emulator accepts any credentials
const sqs = new SQS.SQSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

// Matches the queue Lambda.generate creates for an Outgoing Layer
const { QueueUrl } = await sqs.send(new SQS.CreateQueueCommand({
    QueueName: `${stack}-layer-${layer}-outgoing.fifo`,
    Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' },
}));

console.log(`ok - polling ${QueueUrl}`);

const { handler } = await import('../task.js');

let running = true;
process.on('SIGINT', () => {
    running = false;
    console.log('ok - stopping after the current poll');
});

while (running) {
    const res = await sqs.send(new SQS.ReceiveMessageCommand({
        QueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 10,
    }));

    for (const message of res.Messages || []) {
        // One message per invocation, as the Lambda event source mapping uses BatchSize 1
        try {
            await handler({ Records: [{ body: message.Body }] } as never);
        } catch (err) {
            // Locally a failed message is dropped rather than retried into a dead letter queue
            console.error('not ok - handler failed:', err instanceof Error ? err.message : String(err));
        }

        await sqs.send(new SQS.DeleteMessageCommand({ QueueUrl, ReceiptHandle: message.ReceiptHandle }));
    }
}
