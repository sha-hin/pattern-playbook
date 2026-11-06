<?php

declare(strict_types=1);

namespace Evalu8\Comments;

/**
 * Reads the written comments about one teacher. The real reader and both proxies implement it.
 */
interface CommentReader
{
    /** @return list<Comment> */
    public function forTeacher(int $teacherId, string $term): array;
}
