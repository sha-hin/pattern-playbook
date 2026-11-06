<?php

declare(strict_types=1);

namespace Evalu8\Logging;

/**
 * Writes one line per log entry to a stream (a file, or STDOUT/STDERR).
 */
final readonly class StreamLogger implements Logger
{
    /** @param resource $stream */
    public function __construct(private mixed $stream)
    {
    }

    public function info(string $message, array $context = []): void
    {
        $this->write('info', $message, $context);
    }

    public function warning(string $message, array $context = []): void
    {
        $this->write('warning', $message, $context);
    }

    /** @param array<string, scalar> $context */
    private function write(string $level, string $message, array $context): void
    {
        $details = '';
        foreach ($context as $key => $value) {
            $details .= " {$key}=" . var_export($value, true);
        }

        fwrite($this->stream, "[{$level}] {$message}{$details}\n");
    }
}
