<?php

declare(strict_types=1);

namespace Evalu8\Closing;

use Evalu8\Logging\Logger;
use Evalu8\Mail\Mailer;
use Evalu8\Reporting\MinistryExport;
use Evalu8\Reporting\TermReport;
use Evalu8\Reporting\TermResultStore;

/**
 * The Facade: one method that closes a term, running every step in the right order.
 * The admin panel, the CLI command and the scheduler all call close(); none of them
 * needs to know the five subsystems behind it.
 */
final readonly class TermClosing
{
    public function __construct(
        private TermReport $report,
        private TermResultStore $store,
        private Mailer $mailer,
        private MinistryExport $ministry,
        private Logger $logger,
        private string $exportDirectory,
    ) {
    }

    public function close(string $term): ClosingSummary
    {
        if ($this->store->isClosed($term)) {                // 1. never close twice
            throw new TermAlreadyClosed("Term {$term} is already closed; its results can't change.");
        }

        $results = $this->report->results($term);           // 2. calculate
        $this->store->saveAndClose($term, $results);        // 3. freeze the results (one transaction)

        $emailed = 0;                                       // 4. tell every teacher, only after the results are frozen
        $notEmailed = [];
        foreach ($results as $result) {
            if ($result->teacher->email === null) {
                $notEmailed[] = $result->teacher->name;
                $this->logger->warning('result not emailed: no address', ['teacher' => $result->teacher->name]);
                continue;
            }

            $this->mailer->send(
                $result->teacher->email,
                "Your {$term} evaluation result",
                "Your {$result->method} score is {$result->formattedScore()}. Comments: {$result->commentSummary}",
            );
            $emailed++;
        }

        $path = "{$this->exportDirectory}/ministry-{$term}.csv";  // 5. the Ministry's file
        $this->ministry->write($results, $path);

        return new ClosingSummary($term, count($results), $emailed, $notEmailed, $path);
    }
}
