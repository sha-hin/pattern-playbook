<?php

declare(strict_types=1);

namespace Aws;

use RuntimeException;

/**
 * Shaped like the AWS SDK's S3Client::putObject() / getObject(). Objects are kept in memory.
 */
final class S3Client
{
    /** @var array<string, string> "bucket/key" => body */
    private array $objects = [];

    /**
     * @param array{Bucket: string, Key: string, Body: string} $args
     * @return array{ObjectURL: string}
     */
    public function putObject(array $args): array
    {
        $this->objects["{$args['Bucket']}/{$args['Key']}"] = $args['Body'];

        return ['ObjectURL' => "https://{$args['Bucket']}.s3.eu-central-1.amazonaws.com/{$args['Key']}"];
    }

    /**
     * @param array{Bucket: string, Key: string} $args
     * @return array{Body: string}
     */
    public function getObject(array $args): array
    {
        $id = "{$args['Bucket']}/{$args['Key']}";
        if (!isset($this->objects[$id])) {
            throw new RuntimeException("NoSuchKey: {$id}");
        }

        return ['Body' => $this->objects[$id]];
    }
}
