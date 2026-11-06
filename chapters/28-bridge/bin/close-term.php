<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 24: results and the Ministry message are saved together; a relay delivers the message.
 *
 *     composer dump-autoload
 *     php bin/close-term.php
 */

use Evalu8\Closing\FrozenResult;
use Evalu8\Closing\TermClosing;
use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Outbox\OutboxMessage;
use Evalu8\Outbox\OutboxRelay;
use Evalu8\Persistence\UnitOfWork;
use Evalu8\Reporting\TermReport;

const CURRENT_TERM = '2026-T1';

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';
SampleData::loadAnswers($app->make(ResponseRepository::class), CURRENT_TERM);
$db = $app->make(PDO::class);

function outbox(PDO $db): string
{
    $rows = [];
    foreach ($db->query('SELECT message_key, status, attempts FROM outbox') as $row) {
        $rows[] = "{$row['message_key']} [{$row['status']}, {$row['attempts']} attempt(s)]";
    }

    return count($rows) > 0 ? implode('; ', $rows) : 'empty';
}

echo "── THE REQUEST: close the term ──\n";
$app->make(TermClosing::class)->close(CURRENT_TERM);
echo 'Outbox: ' . outbox($db) . "\n";
echo "(The request never calls the Ministry. If the server died now, the message is safe in the database.)\n";

echo "\n── THE RELAY, minute 1 ──\n";
$relay = $app->make(OutboxRelay::class);
$relay->run();
echo 'Outbox: ' . outbox($db) . "\n";

echo "\n── THE RELAY, minute 2 ──\n";
$relay->run();
echo 'Outbox: ' . outbox($db) . "\n";

echo "\n── THE RELAY CRASHED BEFORE MARKING IT SENT, AND SENDS AGAIN ──\n";
$db->exec("UPDATE outbox SET status = 'pending'");
$relay->run();

echo "\n── ALL OR NOTHING: a write fails half-way through a unit of work ──\n";
$results = $app->make(TermReport::class)->results(CURRENT_TERM);
$unitOfWork = $app->make(UnitOfWork::class);
$unitOfWork->registerNew(new OutboxMessage('ministry.correction', 'ministry-correction:1', ['term' => CURRENT_TERM]));
$unitOfWork->registerNew(new FrozenResult(CURRENT_TERM, $results[0]));   // already frozen: duplicate key
try {
    $unitOfWork->commit();
} catch (PDOException $e) {
    echo 'Commit failed: ' . explode("\n", $e->getMessage())[0] . "\n";
}
echo 'Outbox: ' . outbox($db) . "   (the correction message was rolled back with the failed write)\n";
