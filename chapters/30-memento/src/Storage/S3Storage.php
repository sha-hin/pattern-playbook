<?php

declare(strict_types=1);

namespace Evalu8\Storage;

use Aws\S3Client;

/** Files in an S3 bucket, readable from any server that has the bucket's credentials. */
final readonly class S3Storage implements FileStorage
{
    public function __construct(
        private S3Client $s3,
        private string $bucket,
    ) {
    }

    public function put(string $path, string $contents): string
    {
        $this->s3->putObject(['Bucket' => $this->bucket, 'Key' => $path, 'Body' => $contents]);

        return "s3://{$this->bucket}/{$path}";
    }

    public function get(string $location): string
    {
        $key = substr($location, strlen("s3://{$this->bucket}/"));

        return $this->s3->getObject(['Bucket' => $this->bucket, 'Key' => $key])['Body'];
    }
}
