<?php

declare(strict_types=1);

/**
 * Builder: the full pattern in plain PHP, no framework.
 * Run it: php examples/builder.php
 *
 * Roles:
 * - Product: EvaluationSearch (Part 1; readonly, so it can never become invalid)
 * - Fluent builder: EvaluationSearchBuilder (Part 1; collects parts step by step, checks everything in build())
 * - Builder interface: ReportBuilder (Part 2; the steps every builder must support)
 * - Concrete builders: HtmlReportBuilder, CsvReportBuilder (Part 2; same steps, different products)
 * - Director: ReportDirector (Part 2; runs the steps in order without knowing which builder it has)
 * Part 1 is the modern fluent builder you meet every day (query builders, HTTP clients).
 * Part 2 is the book's original form: one recipe, several builders, several kinds of result.
 *
 * In Laravel:
 * The query builder. where(), orderBy() and limit() only collect parts and return $this.
 * Nothing touches the database until get(), which turns all the parts into one SQL string.
 */

// ═══ Part 1: the modern fluent builder ═══

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

// ── Using Part 1 ──
$search = (new EvaluationSearchBuilder())                   // steps in any order
    ->subjects('math', 'science')
    ->school(12)
    ->between('2026-09-01', '2026-10-31')
    ->build();

echo $search->describe() . "\n";

try {
    (new EvaluationSearchBuilder())->between('2026-10-31', '2026-09-01')->build();
} catch (InvalidArgumentException $e) {
    echo 'Refused: ' . $e->getMessage() . "\n";
}

// ═══ Part 2: the book's form. The SAME steps build DIFFERENT products. ═══

// ── Step 1: the Builder interface. The steps every builder supports. ──
interface ReportBuilder                                     // ★ Builder
{
    public function title(string $title): void;

    public function score(string $teacher, int $score): void;
}

// ── Step 2: concrete builders. Each turns the same steps into its own product. ──
final class HtmlReportBuilder implements ReportBuilder      // ★ Concrete builder #1
{
    private string $html = '';

    public function title(string $title): void
    {
        $this->html .= '<h1>' . htmlspecialchars($title) . "</h1>\n";
    }

    public function score(string $teacher, int $score): void
    {
        $this->html .= '<p>' . htmlspecialchars($teacher) . ": <b>{$score}</b></p>\n";
    }

    public function html(): string                          // each builder returns its own product type
    {
        return $this->html;
    }
}

final class CsvReportBuilder implements ReportBuilder       // ★ Concrete builder #2
{
    /** @var list<string> */
    private array $lines = ['teacher,score'];

    public function title(string $title): void
    {
        // a CSV file has no title row: this builder simply skips the step
    }

    public function score(string $teacher, int $score): void
    {
        $this->lines[] = "{$teacher},{$score}";
    }

    public function csv(): string
    {
        return implode("\n", $this->lines) . "\n";
    }
}

// ── Step 3: the Director. Knows the ORDER of the steps, not the builder. ──
final class ReportDirector                                  // ★ Director
{
    /** @param array<string, int> $scores teacher => score */
    public function build(ReportBuilder $builder, string $title, array $scores): void
    {
        $builder->title($title);                            // ★ same recipe...
        foreach ($scores as $teacher => $score) {
            $builder->score($teacher, $score);
        }
    }
}

// ── Using Part 2: one recipe, two products ──
$scores = ['Mona' => 88, 'Omar' => 74];
$director = new ReportDirector();

$html = new HtmlReportBuilder();
$director->build($html, 'Term 1 evaluation', $scores);
echo $html->html();                                         // ★ ...an HTML page

$csv = new CsvReportBuilder();
$director->build($csv, 'Term 1 evaluation', $scores);
echo $csv->csv();                                           // ★ ...or a CSV file
