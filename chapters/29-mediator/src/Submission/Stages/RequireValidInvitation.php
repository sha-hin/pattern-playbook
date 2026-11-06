<?php

declare(strict_types=1);

namespace Evalu8\Submission\Stages;

use Closure;
use Evalu8\Submission\Receipt;
use Evalu8\Submission\Submission;
use Evalu8\Submission\SubmissionStage;

/**
 * Each respondent gets one invitation link. The token is marked as used only AFTER the
 * rest of the pipeline accepted the answer, so a rejected answer can be corrected and resent.
 */
final class RequireValidInvitation implements SubmissionStage
{
    /** @var array<string, true> tokens already used */
    private array $used = [];

    /** @param array<string, int> $invitations token => teacher id it was issued for */
    public function __construct(private readonly array $invitations)
    {
    }

    public function handle(Submission $submission, Closure $next): Receipt
    {
        $token = $submission->invitationToken;

        if (($this->invitations[$token] ?? null) !== $submission->teacherId) {
            return new Receipt(false, 'This invitation link is not valid for this teacher.');
        }
        if (isset($this->used[$token])) {
            return new Receipt(false, 'This invitation has already been used.');
        }

        $receipt = $next($submission);                      // run the rest of the pipeline first...

        if ($receipt->accepted) {
            $this->used[$token] = true;                     // ...and only then use up the invitation
        }

        return $receipt;
    }
}
