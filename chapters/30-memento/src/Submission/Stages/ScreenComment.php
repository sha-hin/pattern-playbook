<?php

declare(strict_types=1);

namespace Evalu8\Submission\Stages;

use Closure;
use Evalu8\Domain\TeacherRepository;
use Evalu8\Moderation\FlaggedComment;
use Evalu8\Moderation\Moderator;
use Evalu8\Submission\Receipt;
use Evalu8\Submission\Submission;
use Evalu8\Submission\SubmissionStage;

/**
 * Comments with suspicious words are handed to the moderation chain. The score is still
 * saved; the comment is held until a person (or the filter) decides.
 */
final readonly class ScreenComment implements SubmissionStage
{
    /** @param list<string> $suspiciousWords */
    public function __construct(
        private array $suspiciousWords,
        private Moderator $moderation,
        private TeacherRepository $teachers,
    ) {
    }

    public function handle(Submission $submission, Closure $next): Receipt
    {
        if (!$this->isSuspicious($submission->comment)) {
            return $next($submission);
        }

        $school = $this->teachers->get($submission->teacherId)->school;
        $decision = $this->moderation->review(new FlaggedComment($school, $submission->comment));

        $withoutComment = new Submission(
            $submission->invitationToken,
            $submission->teacherId,
            $submission->role,
            $submission->score,
            '',
            $submission->ipAddress,
        );
        $receipt = $next($withoutComment);

        return $receipt->accepted
            ? new Receipt(true, "{$receipt->message} Your comment was {$decision}.")
            : $receipt;
    }

    private function isSuspicious(string $comment): bool
    {
        foreach ($this->suspiciousWords as $word) {
            if (preg_match('/\b' . preg_quote($word, '/') . '\b/iu', $comment) === 1) {
                return true;
            }
        }

        return false;
    }
}
