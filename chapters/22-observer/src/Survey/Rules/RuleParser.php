<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

/**
 * Turns the text an admin types into a tree of Condition objects.
 *
 * The grammar, from loosest to tightest binding:
 *
 *     rule       := and ( "or" and )*
 *     and        := unary ( "and" unary )*
 *     unary      := "not" unary | "(" rule ")" | comparison
 *     comparison := operand ( "=" | "!=" | "<" | "<=" | ">" | ">=" ) operand
 *     operand    := q1, q2...  |  role  |  a whole number  |  "text in quotes"
 *
 * The parser is not the pattern; it only builds the tree. The Interpreter pattern is the
 * tree itself: each class knows how to evaluate its own small piece of the language.
 */
final class RuleParser
{
    /** @var list<array{type: string, text: string, at: int}> */
    private array $tokens = [];
    private int $position = 0;
    private string $source = '';

    public function parse(string $rule): Condition
    {
        $this->source = $rule;
        $this->tokens = $this->tokenize($rule);
        $this->position = 0;

        $condition = $this->parseOr();

        if ($this->position < count($this->tokens)) {
            $this->fail('Unexpected "' . $this->tokens[$this->position]['text'] . '"');
        }

        return $condition;
    }

    private function parseOr(): Condition
    {
        $parts = [$this->parseAnd()];
        while ($this->accept('word', 'or')) {
            $parts[] = $this->parseAnd();
        }

        return count($parts) === 1 ? $parts[0] : new AnyOf(...$parts);
    }

    private function parseAnd(): Condition
    {
        $parts = [$this->parseUnary()];
        while ($this->accept('word', 'and')) {
            $parts[] = $this->parseUnary();
        }

        return count($parts) === 1 ? $parts[0] : new AllOf(...$parts);
    }

    private function parseUnary(): Condition
    {
        if ($this->accept('word', 'not')) {
            return new Not($this->parseUnary());
        }

        if ($this->accept('(')) {
            $inner = $this->parseOr();
            if (!$this->accept(')')) {
                $this->fail('Missing ")"');
            }

            return $inner;
        }

        $left = $this->parseOperand();
        $operator = $this->next('operator', 'a comparison (=, !=, <, <=, >, >=)');
        $right = $this->parseOperand();

        return new Comparison($left, $operator, $right);
    }

    private function parseOperand(): Operand
    {
        $token = $this->tokens[$this->position] ?? null;
        if ($token === null) {
            $this->fail('The rule ends too early');
        }
        $this->position++;

        return match (true) {
            $token['type'] === 'number' => new Literal((int) $token['text']),
            $token['type'] === 'string' => new Literal(stripcslashes(substr($token['text'], 1, -1))),
            $token['type'] === 'word' && $token['text'] === 'role' => new Role(),
            $token['type'] === 'word' && preg_match('/^q\d+$/', $token['text']) === 1 => new AnswerTo($token['text']),
            default => $this->fail("Expected a question code (q1), role, a number or \"text\", got \"{$token['text']}\"", $token['at']),
        };
    }

    /** @return list<array{type: string, text: string, at: int}> */
    private function tokenize(string $rule): array
    {
        preg_match_all(
            '/\s*(?:(?<number>\d+)|(?<string>"(?:\\\\.|[^"\\\\])*")|(?<operator><=|>=|!=|=|<|>)|(?<word>[A-Za-z_]\w*)|(?<paren>[()])|(?<bad>\S))/',
            $rule,
            $matches,
            PREG_SET_ORDER | PREG_OFFSET_CAPTURE | PREG_UNMATCHED_AS_NULL,
        );

        $tokens = [];
        foreach ($matches as $match) {
            foreach (['number', 'string', 'operator', 'word', 'paren', 'bad'] as $type) {
                if ($match[$type][0] === null) {
                    continue;
                }
                [$text, $at] = $match[$type];
                if ($type === 'bad') {
                    $this->fail("Unexpected character \"{$text}\"", $at);
                }
                $tokens[] = ['type' => $type === 'paren' ? $text : $type, 'text' => $type === 'word' ? strtolower($text) : $text, 'at' => $at];
                break;
            }
        }

        return $tokens;
    }

    private function accept(string $type, ?string $text = null): bool
    {
        $token = $this->tokens[$this->position] ?? null;
        if ($token !== null && $token['type'] === $type && ($text === null || $token['text'] === $text)) {
            $this->position++;

            return true;
        }

        return false;
    }

    private function next(string $type, string $expected): string
    {
        $token = $this->tokens[$this->position] ?? null;
        if ($token === null || $token['type'] !== $type) {
            $this->fail("Expected {$expected}", $token['at'] ?? null);
        }
        $this->position++;

        return $token['text'];
    }

    private function fail(string $message, ?int $at = null): never
    {
        $at ??= $this->tokens[$this->position]['at'] ?? strlen($this->source);
        throw new InvalidRule("{$message} at position " . ($at + 1) . " in: {$this->source}");
    }
}
