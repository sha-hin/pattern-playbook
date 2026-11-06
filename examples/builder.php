<?php

declare(strict_types=1);

/**
 * Builder: the full pattern in plain PHP, no framework.
 * Run it: php examples/builder.php
 *
 * Roles:
 * - Product: EvaluationSearch (readonly; can never exist in an invalid state)
 * - Builder: EvaluationSearchBuilder (collects parts step by step, checks everything in build())
 * - Director: SearchPresets (runs a fixed recipe of builder steps, so it is not repeated)
 * - Client: any code that needs a search
 *
 * In Laravel:
 * The query builder: Illuminate\Database\Query\Builder only collects parts (wheres, orders,
 * limit, bindings). Nothing touches the database until get(), which asks the Grammar
 * (compileSelect) to turn those parts into one SQL string with bindings.
 */

final class EvaluationSearch                                    // ★ Product: readonly, built once
{
    /** @param list<string> $subjects */
    public function __construct(
        public readonly ?int $schoolId,
        public readonly array $subjects,
        public readonly ?string $from,
        public readonly ?string $to,
        public readonly int $perPage,
    ) {}

    /** @return array{0: string, 1: list<int|string>} SQL and its bindings */
    public function toSql(): array
    {
        $where = [];
        $bindings = [];

        if ($this->schoolId !== null) {
            $where[] = 'school_id = ?';
            $bindings[] = $this->schoolId;
        }
        if ($this->subjects !== []) {
            $where[] = 'subject IN (' . implode(', ', array_fill(0, count($this->subjects), '?')) . ')';
            array_push($bindings, ...$this->subjects);
        }
        if ($this->from !== null) {
            $where[] = 'submitted_on BETWEEN ? AND ?';
            array_push($bindings, $this->from, $this->to);
        }

        $sql = 'SELECT * FROM evaluations'
            . ($where === [] ? '' : ' WHERE ' . implode(' AND ', $where))
            . ' ORDER BY id LIMIT ' . $this->perPage;

        return [$sql, $bindings];
    }
}

final class EvaluationSearchBuilder                             // ★ Builder
{
    private ?int $schoolId = null;
    /** @var list<string> */
    private array $subjects = [];
    private ?string $from = null;
    private ?string $to = null;
    private int $perPage = 25;

    public function school(int $id): self                       // ★ each step sets one part...
    {
        $this->schoolId = $id;

        return $this;                                           // ★ ...and returns $this for chaining
    }

    public function subjects(string ...$subjects): self
    {
        $this->subjects = array_values($subjects);

        return $this;
    }

    public function between(string $from, string $to): self
    {
        $this->from = $from;
        $this->to = $to;

        return $this;
    }

    public function perPage(int $perPage): self
    {
        $this->perPage = $perPage;

        return $this;
    }

    public function build(): EvaluationSearch                   // ★ the one gate: rules that need several parts
    {
        foreach ([$this->from, $this->to] as $date) {
            if ($date !== null && DateTimeImmutable::createFromFormat('!Y-m-d', $date) === false) {
                throw new InvalidArgumentException("Invalid date [{$date}], use YYYY-MM-DD.");
            }
        }
        if ($this->from !== null && $this->from > $this->to) {
            throw new InvalidArgumentException('"from" must be before "to".');
        }
        if ($this->perPage < 1 || $this->perPage > 100) {
            throw new InvalidArgumentException('perPage must be between 1 and 100.');
        }

        return new EvaluationSearch($this->schoolId, $this->subjects, $this->from, $this->to, $this->perPage);
    }
}

final class SearchPresets                                       // ★ Director: a reusable recipe
{
    public static function thisTermForSchool(EvaluationSearchBuilder $builder, int $schoolId): EvaluationSearch
    {
        return $builder->school($schoolId)->between('2026-09-01', '2027-01-31')->perPage(50)->build();
    }
}

// ── Using it ────────────────────────────────────────────────────────────
$search = (new EvaluationSearchBuilder())                       // steps in any order
    ->subjects('math', 'science')
    ->school(12)
    ->between('2026-09-01', '2026-10-31')
    ->build();

[$sql, $bindings] = $search->toSql();
echo $sql, PHP_EOL, json_encode($bindings), PHP_EOL;

echo SearchPresets::thisTermForSchool(new EvaluationSearchBuilder(), 7)->toSql()[0], PHP_EOL;

try {
    (new EvaluationSearchBuilder())->between('2026-10-31', '2026-09-01')->build();
} catch (InvalidArgumentException $e) {
    echo 'Refused: ', $e->getMessage(), PHP_EOL;
}
