<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Kit;

use Evalu8\Bus\Queue;
use Evalu8\Storage\FileStorage;

/**
 * The Abstract Factory: creates a whole family of infrastructure services that work
 * together. Code that receives a kit can never get storage from one family and a queue
 * from another.
 */
interface InfrastructureKit
{
    public function name(): string;

    public function storage(): FileStorage;

    public function queue(): Queue;
}
