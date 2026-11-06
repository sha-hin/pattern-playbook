<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 18: admins write "show this question if..." rules as text.
 *
 *     composer dump-autoload
 *     php bin/survey-rules.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Evalu8\Domain\RespondentRole;
use Evalu8\Survey\AnswerSheet;
use Evalu8\Survey\Question;
use Evalu8\Survey\Rules\InvalidRule;
use Evalu8\Survey\Rules\RuleContext;
use Evalu8\Survey\Rules\RuleParser;

$parser = new RuleParser();

// Follow-up questions, with the rules the quality team typed in the survey editor.
$followUps = [
    new Question('q7', 'What would help this teacher start on time?', visibleIf: $parser->parse('q4 <= 2')),
    new Question('q8', 'As a colleague: would you co-teach with them?', visibleIf: $parser->parse('role = "peer" and q1 >= 4')),
    new Question('q9', 'What should the principal discuss with them?', visibleIf: $parser->parse('role = "principal" and (q1 < 3 or q3 < 3)')),
    new Question('q10', 'Anything else?', visibleIf: $parser->parse('not role = "student" or q6 <= 2')),
];

echo "RULES, AS UNDERSTOOD\n";
foreach ($followUps as $question) {
    echo "  {$question->code}: {$question->visibleIf?->describe()}\n";
}

$respondents = [
    'a student' => new RuleContext(AnswerSheet::fromArray(['q1' => 5, 'q3' => 4, 'q4' => 2, 'q6' => 4]), RespondentRole::Student),
    'a peer' => new RuleContext(AnswerSheet::fromArray(['q1' => 4, 'q3' => 4, 'q4' => 5, 'q6' => 5]), RespondentRole::Peer),
    'the principal' => new RuleContext(AnswerSheet::fromArray(['q1' => 2, 'q3' => 4, 'q4' => 3, 'q6' => 3]), RespondentRole::Principal),
];

echo "\nWHO SEES WHICH FOLLOW-UP\n";
foreach ($respondents as $who => $context) {
    $shown = [];
    foreach ($followUps as $question) {
        if ($question->isVisibleTo($context)) {
            $shown[] = $question->code;
        }
    }
    echo '  ' . str_pad($who, 15) . (count($shown) > 0 ? implode(', ', $shown) : 'none') . "\n";
}

echo "\nTYPOS ARE CAUGHT WHEN THE RULE IS SAVED\n";
foreach (['q3 => 4', 'role = "peer" and', 'q3 >= 4 and (role = "peer"', 'score >= 4'] as $rule) {
    try {
        $parser->parse($rule);
    } catch (InvalidRule $e) {
        echo "  {$e->getMessage()}\n";
    }
}
