<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 28: any notification over any channel, with one class per side.
 *
 *     composer dump-autoload
 *     php bin/notify.php
 */

use Evalu8\Container\Container;
use Evalu8\Domain\EmailAddress;
use Evalu8\Notify\ChannelUnavailable;
use Evalu8\Notify\Channels;
use Evalu8\Notify\LowResponseRate;
use Evalu8\Notify\Recipient;
use Evalu8\Notify\ResultsPublished;
use Evalu8\Notify\SurveyReminder;

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';
$channels = $app->make(Channels::class);
$db = $app->make(PDO::class);

$hany = new Recipient('teacher-1', 'Hany Mostafa', new EmailAddress('hany@smouha.edu.eg'), '+201001234567');
$nadia = new Recipient('teacher-2', 'Nadia Fawzy', null, '+201117654321');
$principal = new Recipient('principal-smouha', 'Mrs. Amal Kamel', new EmailAddress('amal@smouha.edu.eg'));
$student = new Recipient('student-88', 'Youssef', null, '+201550000088');

// Each person's preferred channel comes from their profile. The notification classes don't care.
echo "RESULTS PUBLISHED\n";
(new ResultsPublished($channels->named('email'), '2026-T1', '4.13'))->send($hany);
(new ResultsPublished($channels->named('whatsapp'), '2026-T1', '2.70'))->send($nadia);

echo "\nLOW RESPONSE RATE\n";
(new LowResponseRate($channels->named('email'), 'Laila Samir', 2, 5))->send($principal);
(new LowResponseRate($channels->named('in-app'), 'Laila Samir', 2, 5))->send($principal);

echo "\nSURVEY REMINDER\n";
(new SurveyReminder($channels->named('sms'), 'Teacher evaluation 2026-T1', '20 Nov'))->send($student);

echo "\nUNREACHABLE ON THE CHOSEN CHANNEL\n";
try {
    (new SurveyReminder($channels->named('email'), 'Teacher evaluation 2026-T1', '20 Nov'))->send($student);
} catch (ChannelUnavailable $e) {
    echo "Not sent: {$e->getMessage()}\n";                // loud, so the reminder can go by SMS instead
}

echo "\nIN-APP INBOX\n";
foreach ($db->query('SELECT user_id, subject FROM inbox ORDER BY id')->fetchAll(PDO::FETCH_ASSOC) as $row) {
    echo "{$row['user_id']}: {$row['subject']}\n";
}
