<?php

declare(strict_types=1);

namespace Evalu8\Editor;

enum QuestionType: string
{
    case Scale = 'scale';                                   // 1 to N, can be scored
    case YesNo = 'yes-no';                                  // can be scored as 0 / 1
    case Text = 'text';                                     // free comment, never scored
}
