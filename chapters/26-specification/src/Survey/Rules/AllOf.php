<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

/** `a and b`: true when every part is true. */
final readonly class AllOf implements Condition
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
            if (!$condition->isTrue($context)) {
                return false;
            }
        }

        return true;
    }

    public function describe(): string
    {
        return '(' . implode(' and ', array_map(fn (Condition $c): string => $c->describe(), $this->conditions)) . ')';
    }
}
