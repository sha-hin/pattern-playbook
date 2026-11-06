<?php

declare(strict_types=1);

namespace Evalu8\Cache;

/**
 * An in-memory cache that lives as long as the PHP process. Good for demos and one-off scripts.
 */
final class ArrayCache implements Cache
{
    /** @var array<string, array{value: string, expires: int}> */
    private array $items = [];

    public function get(string $key): ?string
    {
        $item = $this->items[$key] ?? null;
        if ($item === null || $item['expires'] < time()) {
            return null;
        }

        return $item['value'];
    }

    public function set(string $key, string $value, int $ttlSeconds): void
    {
        $this->items[$key] = ['value' => $value, 'expires' => time() + $ttlSeconds];
    }
}
