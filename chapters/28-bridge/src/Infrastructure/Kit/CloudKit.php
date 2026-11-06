<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Kit;

use Aws\S3Client;
use Aws\SqsClient;
use Evalu8\Bus\Queue;
use Evalu8\Bus\SqsQueue;
use Evalu8\Storage\FileStorage;
use Evalu8\Storage\S3Storage;

/**
 * Many servers: files in S3, jobs in SQS. Workers run anywhere and read files from S3.
 */
final class CloudKit implements InfrastructureKit
{
    private ?FileStorage $storage = null;
    private ?Queue $queue = null;

    public function __construct(
        private readonly S3Client $s3,
        private readonly SqsClient $sqs,
        private readonly string $bucket,
        private readonly string $queueUrl,
    ) {
    }

    public function name(): string
    {
        return 'cloud';
    }

    public function storage(): FileStorage
    {
        return $this->storage ??= new S3Storage($this->s3, $this->bucket);
    }

    public function queue(): Queue
    {
        return $this->queue ??= new SqsQueue($this->sqs, $this->queueUrl);
    }
}
