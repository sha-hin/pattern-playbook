<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

/**
 * `left OP right`, with OP one of = != < <= > >=.
 * An unknown value (an unanswered question) makes every comparison false.
 */
final readonly class Comparison implements Condition
{
    public const OPERATORS = ['=', '!=', '<', '<=', '>', '>='];

    public function __construct(
        private Operand $left,
        private string $operator,
        private Operand $right,
    ) {
        if (!in_array($operator, self::OPERATORS, true)) {
            throw new InvalidRule("Unknown operator \"{$operator}\".");
        }
    }

    public function isTrue(RuleContext $context): bool
    {
        $left = $this->left->valueIn($context);
        $right = $this->right->valueIn($context);

        if ($left === null || $right === null) {
            return false;
        }

        return match ($this->operator) {
            '=' => $left === $right,
            '!=' => $left !== $right,
            '<' => $left < $right,
            '<=' => $left <= $right,
            '>' => $left > $right,
            '>=' => $left >= $right,
        };
    }

    public function describe(): string
    {
        return "{$this->left->describe()} {$this->operator} {$this->right->describe()}";
    }
}
