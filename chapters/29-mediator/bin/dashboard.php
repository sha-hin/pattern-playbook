<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 10: the teacher dashboard reads comments through two proxies.
 *
 *     composer dump-autoload
 *     php bin/dashboard.php
 */

use Evalu8\Auth\AccessDenied;
use Evalu8\Auth\Viewer;
use Evalu8\Auth\ViewerRole;
use Evalu8\Comments\AccessControlledCommentReader;
use Evalu8\Comments\Comment;
use Evalu8\Comments\CommentReader;
use Evalu8\Comments\LazyCommentReader;
use Evalu8\Comments\SqliteCommentReader;
use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Logging\Logger;

const CURRENT_TERM = '2026-T1';

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';

SampleData::loadAnswers($app->make(ResponseRepository::class), CURRENT_TERM);
$logger = $app->make(Logger::class);

// The real reader would open a second connection, to the comments archive. That is the slow part.
// (In the demo the archive is the same in-memory database.)
$lazy = new LazyCommentReader(function () use ($app, $logger): CommentReader {
    $logger->info('opening the comments archive connection');

    return new SqliteCommentReader($app->make(PDO::class));
});

/** @param list<Comment> $comments */
function show(array $comments): void
{
    foreach ($comments as $comment) {
        echo '  - ' . ($comment->role !== null ? "[{$comment->role->value}] " : '') . $comment->text . "\n";
    }
}

echo "DASHBOARD PAGES BUILT (comments panel collapsed)\n";
$asPrincipal = new AccessControlledCommentReader($lazy, new Viewer('Mona Saleh', ViewerRole::Principal));
$asHany = new AccessControlledCommentReader($lazy, new Viewer('Hany Mostafa', ViewerRole::Teacher, teacherId: 1));
echo "  no archive connection yet\n";

echo "\nPRINCIPAL opens Hany's comments\n";
show($asPrincipal->forTeacher(1, CURRENT_TERM));

echo "\nHANY opens his own comments (roles hidden, connection reused)\n";
show($asHany->forTeacher(1, CURRENT_TERM));

echo "\nHANY tries to open Nadia's comments\n";
try {
    $asHany->forTeacher(2, CURRENT_TERM);
} catch (AccessDenied $e) {
    echo "  AccessDenied: {$e->getMessage()}\n";
}
