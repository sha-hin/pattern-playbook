<?php

declare(strict_types=1);

namespace Evalu8\Storage;

use RuntimeException;

/** Files on this server's disk. Only processes on the same server can read them. */
final readonly class LocalDiskStorage implements FileStorage
{
    public function __construct(private string $directory)
    {
    }

    public function put(string $path, string $contents): string
    {
        $location = rtrim($this->directory, '/') . '/' . ltrim($path, '/');
        if (!is_dir(dirname($location)) && !mkdir(dirname($location), 0775, true)) {
            throw new RuntimeException("Can't create " . dirname($location) . '.');
        }
        if (file_put_contents($location, $contents) === false) {
            throw new RuntimeException("Can't write {$location}.");
        }

        return 'disk://' . ltrim($path, '/');               // a location, not a server path: it is only valid on this server
    }

    public function get(string $location): string
    {
        if (!str_starts_with($location, 'disk://')) {
            throw new RuntimeException("Not a local disk location: {$location}");
        }

        $file = rtrim($this->directory, '/') . '/' . substr($location, strlen('disk://'));
        $contents = @file_get_contents($file);
        if ($contents === false) {
            throw new RuntimeException("File not found on this server: {$location}");
        }

        return $contents;
    }
}
