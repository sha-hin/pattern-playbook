<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Sqlite;

use Evalu8\Domain\RespondentRole;
use Evalu8\Domain\Response;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\Score;
use PDO;

/**
 * The ONLY class that knows how responses are stored in SQL.
 */
final readonly class SqliteResponseRepository implements ResponseRepository
{
    public function __construct(private PDO $db)
    {
    }

    public function add(Response $response): void
    {
        $insert = $this->db->prepare(
            'INSERT INTO responses (teacher_id, term, role, score, comment) VALUES (?, ?, ?, ?, ?)'
        );

        $insert->execute([                                  // object → row
            $response->teacherId,
            $response->term,
            $response->role->value,
            $response->score->value,
            $response->comment,
        ]);
    }

    public function forTeacherInTerm(int $teacherId, string $term): array
    {
        $select = $this->db->prepare(
            'SELECT teacher_id, term, role, score, comment FROM responses WHERE teacher_id = ? AND term = ? ORDER BY id'
        );
        $select->execute([$teacherId, $term]);

        $responses = [];
        foreach ($select->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $responses[] = $this->toResponse($row);
        }

        return $responses;
    }

    /**
     * Row → object. Rows are rebuilt through the value objects, so a bad
     * value already in the database fails loudly here instead of being used.
     *
     * @param array<string, mixed> $row
     */
    private function toResponse(array $row): Response
    {
        return new Response(
            (int) $row['teacher_id'],
            (string) $row['term'],
            RespondentRole::from((string) $row['role']),
            new Score((int) $row['score']),
            (string) $row['comment'],
        );
    }
}
