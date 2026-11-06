<?php

declare(strict_types=1);

namespace Evalu8\Logging;

/**
 * The two log levels this app needs. (A real project would use PSR-3's LoggerInterface.)
 */
interface Logger
{
    /** @param array<string, scalar> $context */
    public function info(string $message, array $context = []): void;

    /** @param array<string, scalar> $context */
    public function warning(string $message, array $context = []): void;
}
