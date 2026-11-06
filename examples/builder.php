<?php

declare(strict_types=1);

/**
 * Builder: the full pattern in plain PHP, no framework.
 * Run it: php examples/builder.php
 *
 * Roles:
 * - Product: EvaluationSearch (the finished object; readonly, so it can never become invalid)
 * - Builder: EvaluationSearchBuilder (collects the parts step by step, checks everything in build())
 * - Director: SearchPresets (a saved recipe of builder steps, so it isn't repeated)
 * - Client: any code that needs a search
 *
 * In Laravel:
 * The query builder. where(), orderBy() and limit() only collect parts and return $this.
 * Nothing touches the database until get(), which turns all the parts into one SQL string.
 */

// ── Step 1: the Product. Built once, cannot change afterwards. ──
final class EvaluationSearch                                // ★ Product
{
    /**
     * @param list<string> $subjects
     */
    public function __construct(
        public readonly ?int $schoolId,            // readonly: can't be changed after creation
        public readonly array $subjects,
        public readonly ?string $from,
        public readonly ?string $to,
        public readonly int $perPage,
    ) {
    }

    public function describe(): string
    {
        $parts = [];
        if ($this->schoolId !== null) {
            $parts[] = "school {$this->schoolId}";
        }
        if (count($this->subjects) > 0) {
            $parts[] = 'subjects ' . implode(' + ', $this->subjects);
        }
        if ($this->from !== null) {
            $parts[] = "from {$this->from} to {$this->to}";
        }
        $parts[] = "{$this->perPage} per page";

        return implode(', ', $parts);
    }
}

// ── Step 2: the Builder. One method per part, in any order. ──
final class EvaluationSearchBuilder                         // ★ Builder
{
    private ?int $schoolId = null;
    /** @var list<string> */
    private array $subjects = [];
    private ?string $from = null;
    private ?string $to = null;
    private int $perPage = 25;

    public function school(int $id): static                 // ★ each step sets one part...
    {
        $this->schoolId = $id;

        return $this;                                       // ★ ...and returns $this, so calls can be chained
    }

    public function subjects(string ...$subjects): static
    {
        $this->subjects = $subjects;

        return $this;
    }

    public function between(string $from, string $to): static
    {
        $this->from = $from;
        $this->to = $to;

        return $this;
    }

    public function perPage(int $perPage): static
    {
        $this->perPage = $perPage;

        return $this;
    }

    public function build(): EvaluationSearch               // ★ the last step: check the rules, then create
    {
        if ($this->from !== null && $this->from > $this->to) {      // this rule needs TWO parts
            throw new InvalidArgumentException('"from" must be before "to".');
        }
        if ($this->perPage < 1 || $this->perPage > 100) {
            throw new InvalidArgumentException('perPage must be between 1 and 100.');
        }

        return new EvaluationSearch($this->schoolId, $this->subjects, $this->from, $this->to, $this->perPage);
    }
}

// ── Step 3: the Director. A recipe you use often, written once. ──
final class SearchPresets                                   // ★ Director
{
    public static function thisTerm(int $schoolId): EvaluationSearch
    {
        return (new EvaluationSearchBuilder())
            ->school($schoolId)
            ->between('2026-09-01', '2027-01-31')
            ->perPage(50)
            ->build();
    }
}

// ── Using it ──
$search = (new EvaluationSearchBuilder())                   // steps in any order
    ->subjects('math', 'science')
    ->school(12)
    ->between('2026-09-01', '2026-10-31')
    ->build();

echo $search->describe() . "\n";
echo SearchPresets::thisTerm(7)->describe() . "\n";

try {
    (new EvaluationSearchBuilder())->between('2026-10-31', '2026-09-01')->build();
} catch (InvalidArgumentException $e) {
    echo 'Refused: ' . $e->getMessage() . "\n";
}
