<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Kit;

use Evalu8\Bus\DatabaseQueue;
use Evalu8\Bus\Queue;
use Evalu8\Storage\FileStorage;
use Evalu8\Storage\LocalDiskStorage;
use PDO;

/**
 * One server: files on its disk, jobs in its database. The worker runs on the same machine,
 * so it can read the files.
 */
final class LocalKit implements InfrastructureKit
{
    private ?FileStorage $storage = null;
    private ?Queue $queue = null;

    public function __construct(
        private readonly string $storageDirectory,
        private readonly PDO $db,
    ) {
    }

    public function name(): string
    {
        return 'local';
    }

    public function storage(): FileStorage
    {
        return $this->storage ??= new LocalDiskStorage($this->storageDirectory);
    }

    public function queue(): Queue
    {
        return $this->queue ??= new DatabaseQueue($this->db);
    }
}
