<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Sqlite;

use Evalu8\Domain\NotFound;
use Evalu8\Domain\School;
use Evalu8\Domain\SchoolRepository;
use JsonException;
use PDO;

final readonly class SqliteSchoolRepository implements SchoolRepository
{
    public function __construct(private PDO $db)
    {
    }

    public function get(string $name): School
    {
        $select = $this->db->prepare('SELECT name, scoring_method, scoring_weights FROM schools WHERE name = ?');
        $select->execute([$name]);
        $row = $select->fetch(PDO::FETCH_ASSOC);

        if ($row === false) {
            throw new NotFound("No school called \"{$name}\".");
        }

        return new School(
            (string) $row['name'],
            (string) $row['scoring_method'],
            $this->weights($row['scoring_weights']),
        );
    }

    /**
     * @return array<string, float>
     * @throws JsonException when the stored weights are not valid JSON
     */
    private function weights(mixed $json): array
    {
        if ($json === null || $json === '') {
            return [];
        }

        /** @var array<string, float> $weights */
        $weights = json_decode((string) $json, true, flags: JSON_THROW_ON_ERROR);

        return $weights;
    }
}
