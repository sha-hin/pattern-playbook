<?php

declare(strict_types=1);

namespace Evalu8\Comments;

use Closure;

/**
 * Virtual proxy: stands in for the real reader and only creates it (and opens the
 * archive connection) the first time comments are actually read.
 */
final class LazyCommentReader implements CommentReader
{
    private ?CommentReader $real = null;

    /** @param Closure(): CommentReader $createReal */
    public function __construct(private readonly Closure $createReal)
    {
    }

    public function forTeacher(int $teacherId, string $term): array
    {
        $this->real ??= ($this->createReal)();              // created on first use, then reused

        return $this->real->forTeacher($teacherId, $term);
    }
}
