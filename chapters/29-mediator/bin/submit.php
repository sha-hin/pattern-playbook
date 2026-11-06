<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 25: online answers pass a pipeline of checks; flagged comments go down a chain of moderators.
 *
 *     composer dump-autoload
 *     php bin/submit.php
 */

use Evalu8\Container\Container;
use Evalu8\Domain\EmailAddress;
use Evalu8\Domain\InvalidValue;
use Evalu8\Domain\RespondentRole;
use Evalu8\Domain\Response;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\Score;
use Evalu8\Domain\TeacherRepository;
use Evalu8\Lifecycle\SurveyRun;
use Evalu8\Moderation\AutoFilter;
use Evalu8\Moderation\QualityTeam;
use Evalu8\Moderation\SchoolModerator;
use Evalu8\Submission\Pipeline;
use Evalu8\Submission\Receipt;
use Evalu8\Submission\Stages\LimitRate;
use Evalu8\Submission\Stages\RequireOpenSurvey;
use Evalu8\Submission\Stages\RequireValidInvitation;
use Evalu8\Submission\Stages\ScreenComment;
use Evalu8\Submission\Submission;

const CURRENT_TERM = '2026-T1';

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';
$responses = $app->make(ResponseRepository::class);

$run = new SurveyRun('Teacher evaluation', CURRENT_TERM, 'Smouha', new EmailAddress('principal@smouha.edu.eg'));
$run->open();

// The chain of moderators, read left to right.
$moderation = new AutoFilter(['idiot']);
$moderation->then(new SchoolModerator(['Smouha']))->then(new QualityTeam());

$pipeline = new Pipeline(
    [
        new LimitRate(maxPerDevice: 3),                     // first: cheap, and stops token guessing
        new RequireOpenSurvey($run),
        new RequireValidInvitation(['tok-A' => 1, 'tok-B' => 1, 'tok-C' => 2, 'tok-D' => 4, 'tok-E' => 1]),
        new ScreenComment(['idiot', 'hate', 'useless'], $moderation, $app->make(TeacherRepository::class)),
    ],
    function (Submission $s) use ($responses, $run): Receipt {   // the destination: validate and save
        try {
            $responses->add(new Response($s->teacherId, CURRENT_TERM, RespondentRole::fromInput($s->role), Score::fromInput($s->score), $s->comment));
        } catch (InvalidValue $e) {
            return new Receipt(false, $e->getMessage());
        }
        $run->submitAnswer();

        return new Receipt(true, 'Thank you, your answer was saved.');
    },
);

$submissions = [
    'A normal answer' => new Submission('tok-A', 1, 'student', '5', 'Explains clearly', '10.0.0.1'),
    'The same link again' => new Submission('tok-A', 1, 'student', '4', '', '10.0.0.2'),
    'A link for another teacher' => new Submission('tok-B', 2, 'student', '1', '', '10.0.0.3'),
    'Score typo, then corrected' => new Submission('tok-E', 1, 'peer', '40', '', '10.0.0.4'),
    'Corrected' => new Submission('tok-E', 1, 'peer', '4', '', '10.0.0.4'),
    'Abusive comment' => new Submission('tok-B', 1, 'student', '2', 'What an idiot', '10.0.0.5'),
    'Harsh comment, Smouha teacher' => new Submission('tok-C', 2, 'student', '2', 'I hate these group tasks', '10.0.0.6'),
    'Harsh comment, Victoria teacher' => new Submission('tok-D', 4, 'peer', '3', 'Useless planning', '10.0.0.7'),
    'A script guessing tokens (1)' => new Submission('tok-W', 1, 'student', '1', '', '10.0.0.66'),
    'A script guessing tokens (2)' => new Submission('tok-X', 1, 'student', '1', '', '10.0.0.66'),
    'A script guessing tokens (3)' => new Submission('tok-Y', 1, 'student', '1', '', '10.0.0.66'),
    'A script guessing tokens (4)' => new Submission('tok-Z', 1, 'student', '1', '', '10.0.0.66'),
];

foreach ($submissions as $label => $submission) {
    $receipt = $pipeline->process($submission);
    echo str_pad($label, 33) . ($receipt->accepted ? 'saved:   ' : 'refused: ') . $receipt->message . "\n";
}

$run->close(new DateTimeImmutable('2026-06-11'));
$late = $pipeline->process(new Submission('tok-D', 4, 'student', '5', '', '10.0.0.9'));
echo str_pad('After the survey closed', 33) . 'refused: ' . $late->message . "\n";
echo "\n{$run->answers()} answers saved\n";
