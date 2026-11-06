<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

/** `a or b`: true when at least one part is true. */
final readonly class AnyOf implements Condition
{
    /** @var list<Condition> */
    private array $conditions;

    public function __construct(Condition ...$conditions)
    {
        $this->conditions = array_values($conditions);
    }

    public function isTrue(RuleContext $context): bool
    {
        foreach ($this->conditions as $condition) {
            if ($condition->isTrue($context)) {
                return true;
            }
        }

        return false;
    }

    public function describe(): string
    {
        return '(' . implode(' or ', array_map(fn (Condition $c): string => $c->describe(), $this->conditions)) . ')';
    }
}
