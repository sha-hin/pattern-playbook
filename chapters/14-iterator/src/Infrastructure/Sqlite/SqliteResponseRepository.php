<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Sqlite;

use Evalu8\Domain\RespondentRole;
use Evalu8\Domain\Response;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\Score;
use Generator;
use PDO;

/**
 * The ONLY class that knows how responses are stored in SQL.
 */
final readonly class SqliteResponseRepository implements ResponseRepository
{
    public function __construct(
        private PDO $db,
        private int $batchSize = 1000,
    ) {
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
     * A generator: PHP turns this method into an Iterator. Each `yield` hands one Response to the
     * caller's foreach and pauses here until the loop asks for the next one.
     *
     * @return Generator<int, Response>
     */
    public function inTerm(string $term): Generator
    {
        $select = $this->db->prepare(
            'SELECT id, teacher_id, term, role, score, comment FROM responses
             WHERE term = ? AND id > ? ORDER BY id LIMIT ?'
        );

        $lastId = 0;
        do {
            $select->execute([$term, $lastId, $this->batchSize]);
            $rows = $select->fetchAll(PDO::FETCH_ASSOC);    // at most one batch in memory

            foreach ($rows as $row) {
                $lastId = (int) $row['id'];
                yield $this->toResponse($row);
            }
        } while (count($rows) === $this->batchSize);        // a short batch was the last one
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
