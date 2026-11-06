<?php

declare(strict_types=1);

namespace Evalu8\Comments;

use Evalu8\Auth\AccessDenied;
use Evalu8\Auth\Viewer;
use Evalu8\Auth\ViewerRole;

/**
 * Protection proxy: decides whether the viewer may reach the real reader at all.
 *
 * - principals and the quality team read every comment, with the respondent's role
 * - a teacher reads only their own comments, with the role hidden (answers stay anonymous)
 * - anything else is refused before the real reader is touched
 */
final readonly class AccessControlledCommentReader implements CommentReader
{
    public function __construct(
        private CommentReader $inner,
        private Viewer $viewer,
    ) {
    }

    public function forTeacher(int $teacherId, string $term): array
    {
        if ($this->viewer->role === ViewerRole::Principal || $this->viewer->role === ViewerRole::Quality) {
            return $this->inner->forTeacher($teacherId, $term);
        }

        if ($this->viewer->role === ViewerRole::Teacher && $this->viewer->teacherId === $teacherId) {
            $comments = [];
            foreach ($this->inner->forTeacher($teacherId, $term) as $comment) {
                $comments[] = $comment->withoutRole();
            }

            return $comments;
        }

        throw new AccessDenied("{$this->viewer->name} may not read the comments about teacher #{$teacherId}.");
    }
}
