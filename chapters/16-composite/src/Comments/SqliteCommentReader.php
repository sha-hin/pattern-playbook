<?php

declare(strict_types=1);

namespace Evalu8\Comments;

use Evalu8\Domain\RespondentRole;
use PDO;

/**
 * The real subject: reads comments from the comments archive database.
 * Creating it means opening a connection to that archive, which is slow.
 */
final readonly class SqliteCommentReader implements CommentReader
{
    public function __construct(private PDO $archive)
    {
    }

    public function forTeacher(int $teacherId, string $term): array
    {
        $select = $this->archive->prepare(
            "SELECT role, comment FROM responses WHERE teacher_id = ? AND term = ? AND comment <> '' ORDER BY id"
        );
        $select->execute([$teacherId, $term]);

        $comments = [];
        foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $comments[] = new Comment(RespondentRole::from((string) $row['role']), (string) $row['comment']);
        }

        return $comments;
    }
}
