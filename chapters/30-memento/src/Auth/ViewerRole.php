<?php

declare(strict_types=1);

namespace Evalu8\Auth;

enum ViewerRole: string
{
    case Principal = 'principal';
    case Quality = 'quality';                               // the school's quality team
    case Teacher = 'teacher';
}
