<?php

declare(strict_types=1);

namespace Evalu8\Storage;

interface FileStorage
{
    /** @return string where the file now lives, in a form only this storage understands */
    public function put(string $path, string $contents): string;

    /** @param string $location a value returned by put() */
    public function get(string $location): string;
}
