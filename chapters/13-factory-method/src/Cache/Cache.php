<?php

declare(strict_types=1);

namespace Evalu8\Cache;

/**
 * A key-value cache. In production this is Redis or Memcached; the demo uses memory.
 */
interface Cache
{
    public function get(string $key): ?string;

    public function set(string $key, string $value, int $ttlSeconds): void;
}
