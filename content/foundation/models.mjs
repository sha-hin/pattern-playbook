// Foundation, part 3: every enum and Eloquent model, one block per file.

export const enums = {
  id: 'enums',
  title: 'Enums',
  text: [
    'Every status, role and type is a backed enum, cast on its model, so `$booking->status` is a `BookingStatus` and a typo can’t be stored. Behaviour that belongs to a value (which statuses block the calendar, which channel a source is) lives on the enum.',
  ],
  numbered: false,
  blocks: [
    {
      id: 'enum-booking-status',
      title: 'BookingStatus',
      path: 'app/Enums/BookingStatus.php',
      code: String.raw`<?php

namespace App\Enums;

enum BookingStatus: string
{
    case Pending = 'pending';                 // a hold, waiting for payment
    case Confirmed = 'confirmed';
    case Cancelled = 'cancelled';
    case Expired = 'expired';                 // a hold that was never paid

    /** @return list<self> statuses that occupy the calendar */
    public static function blocking(): array
    {
        return [self::Pending, self::Confirmed];
    }
}`,
    },
    {
      id: 'enum-channel',
      title: 'Channel',
      path: 'app/Enums/Channel.php',
      code: String.raw`<?php

namespace App\Enums;

enum Channel: string
{
    case Airbnb = 'airbnb';
    case BookingCom = 'booking_com';
    case Vrbo = 'vrbo';
}`,
    },
    {
      id: 'enum-booking-source',
      title: 'BookingSource',
      path: 'app/Enums/BookingSource.php',
      code: String.raw`<?php

namespace App\Enums;

enum BookingSource: string
{
    case Direct = 'direct';
    case Airbnb = 'airbnb';
    case BookingCom = 'booking_com';
    case Vrbo = 'vrbo';

    public function channel(): ?Channel
    {
        return Channel::tryFrom($this->value);                    // null for direct bookings
    }
}`,
    },
    {
      id: 'enum-cancellation-policy',
      title: 'CancellationPolicy',
      path: 'app/Enums/CancellationPolicy.php',
      code: String.raw`<?php

namespace App\Enums;

/** Only the names here; the refund rules are built in lesson 15. */
enum CancellationPolicy: string
{
    case Flexible = 'flexible';
    case Moderate = 'moderate';
    case Strict = 'strict';
}`,
    },
    {
      id: 'enum-payment-kind',
      title: 'PaymentKind',
      path: 'app/Enums/PaymentKind.php',
      code: String.raw`<?php

namespace App\Enums;

enum PaymentKind: string
{
    case Deposit = 'deposit';
    case Balance = 'balance';
    case Refund = 'refund';
}`,
    },
    {
      id: 'enum-payment-status',
      title: 'PaymentStatus',
      path: 'app/Enums/PaymentStatus.php',
      code: String.raw`<?php

namespace App\Enums;

enum PaymentStatus: string
{
    case Pending = 'pending';
    case Succeeded = 'succeeded';
    case Failed = 'failed';
    case Cancelled = 'cancelled';
}`,
    },
    {
      id: 'enum-line-item-type',
      title: 'LineItemType',
      path: 'app/Enums/LineItemType.php',
      code: String.raw`<?php

namespace App\Enums;

enum LineItemType: string
{
    case Night = 'night';
    case CleaningFee = 'cleaning_fee';
    case Discount = 'discount';
    case Tax = 'tax';
    case Refund = 'refund';
}`,
    },
    {
      id: 'enum-membership-role',
      title: 'MembershipRole',
      path: 'app/Enums/MembershipRole.php',
      code: String.raw`<?php

namespace App\Enums;

enum MembershipRole: string
{
    case Owner = 'owner';
    case CoHost = 'co_host';
    case Cleaner = 'cleaner';
}`,
    },
    {
      id: 'enum-rate-rule-type',
      title: 'RateRuleType',
      path: 'app/Enums/RateRuleType.php',
      code: String.raw`<?php

namespace App\Enums;

enum RateRuleType: string
{
    case Group = 'group';                     // a season holding other rules
    case Weekend = 'weekend';
    case MinStay = 'min_stay';
    case LengthOfStay = 'length_of_stay';
}`,
    },
    {
      id: 'enum-message-trigger',
      title: 'MessageTrigger',
      path: 'app/Enums/MessageTrigger.php',
      code: String.raw`<?php

namespace App\Enums;

enum MessageTrigger: string
{
    case BookingConfirmed = 'booking_confirmed';
    case BeforeCheckIn = 'before_check_in';
    case AfterCheckOut = 'after_check_out';
}`,
    },
    {
      id: 'enum-guest-channel',
      title: 'GuestChannel',
      path: 'app/Enums/GuestChannel.php',
      code: String.raw`<?php

namespace App\Enums;

enum GuestChannel: string
{
    case Mail = 'mail';
    case Sms = 'sms';
    case WhatsApp = 'whatsapp';
}`,
    },
    {
      id: 'enum-scheduled-message-status',
      title: 'ScheduledMessageStatus',
      path: 'app/Enums/ScheduledMessageStatus.php',
      code: String.raw`<?php

namespace App\Enums;

enum ScheduledMessageStatus: string
{
    case Pending = 'pending';
    case Sent = 'sent';
    case Cancelled = 'cancelled';
}`,
    },
    {
      id: 'enum-chat-sender',
      title: 'ChatSender',
      path: 'app/Enums/ChatSender.php',
      code: String.raw`<?php

namespace App\Enums;

enum ChatSender: string
{
    case Guest = 'guest';
    case Host = 'host';
}`,
    },
    {
      id: 'enum-cleaning-task-status',
      title: 'CleaningTaskStatus',
      path: 'app/Enums/CleaningTaskStatus.php',
      code: String.raw`<?php

namespace App\Enums;

enum CleaningTaskStatus: string
{
    case Open = 'open';
    case Assigned = 'assigned';
    case Done = 'done';
    case Cancelled = 'cancelled';
}`,
    },
    {
      id: 'enum-review-request-status',
      title: 'ReviewRequestStatus',
      path: 'app/Enums/ReviewRequestStatus.php',
      code: String.raw`<?php

namespace App\Enums;

enum ReviewRequestStatus: string
{
    case Pending = 'pending';
    case Sent = 'sent';
    case Skipped = 'skipped';
}`,
    },
    {
      id: 'enum-webhook-status',
      title: 'WebhookStatus',
      path: 'app/Enums/WebhookStatus.php',
      code: String.raw`<?php

namespace App\Enums;

enum WebhookStatus: string
{
    case Received = 'received';
    case Processed = 'processed';
    case Failed = 'failed';
}`,
    },
    {
      id: 'enum-reconciliation-kind',
      title: 'ReconciliationKind',
      path: 'app/Enums/ReconciliationKind.php',
      code: String.raw`<?php

namespace App\Enums;

enum ReconciliationKind: string
{
    case PaymentMismatch = 'payment_mismatch';
    case MissingOnChannel = 'missing_on_channel';
    case MissingHere = 'missing_here';
}`,
    },
  ],
};

export const models = {
  id: 'models',
  title: 'Models',
  text: [
    'Models hold data, relations, casts and query scopes. **Business rules don’t live here**; they live in the classes the lessons build. For models a request can fill (properties, bookings, templates), `$fillable` lists only what a user may set: ownership columns (`account_id`, `property_id`) and statuses are set by code. Models that only our own code writes (payments, scheduled messages, outbox rows) list their columns, because no request ever reaches them.',
    '`Model::shouldBeStrict()` (in [the provider](F#app-provider)) turns a non-fillable key into an exception instead of a silently dropped value, so a mistake here shows up in the first test.',
  ],
  numbered: false,
  blocks: [
    {
      id: 'model-user',
      title: 'User',
      text: [
        '`roleIn()` answers the question every policy asks.',
      ],
      path: 'app/Models/User.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\MembershipRole;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = ['name', 'email', 'password', 'phone', 'notification_channels'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'notification_channels' => 'array',
        ];
    }

    public function accounts(): BelongsToMany
    {
        return $this->belongsToMany(Account::class, 'memberships')
            ->using(Membership::class)
            ->withPivot('role')
            ->withTimestamps();
    }

    public function currentAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'current_account_id');
    }

    /** The user's role in an account, or null when they are not a member. */
    public function roleIn(int $accountId): ?MembershipRole
    {
        $membership = $this->accounts->firstWhere('id', $accountId)?->pivot;

        return $membership?->role;
    }

    public function cleaningTasks(): HasMany
    {
        return $this->hasMany(CleaningTask::class, 'cleaner_id');
    }
}`,
    },
    {
      id: 'model-account',
      title: 'Account',
      path: 'app/Models/Account.php',
      code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Account extends Model
{
    use HasFactory;

    protected $fillable = ['name'];

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'memberships')
            ->using(Membership::class)
            ->withPivot('role')
            ->withTimestamps();
    }

    public function properties(): HasMany
    {
        return $this->hasMany(Property::class);
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(AccountInvitation::class);
    }

    public function messageTemplates(): HasMany
    {
        return $this->hasMany(MessageTemplate::class);
    }

    public function channelConnections(): HasMany
    {
        return $this->hasMany(ChannelConnection::class);
    }
}`,
    },
    {
      id: 'model-membership',
      title: 'Membership',
      text: [
        'The pivot has its own model so the role is cast to `MembershipRole`.',
      ],
      path: 'app/Models/Membership.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\MembershipRole;
use Illuminate\Database\Eloquent\Relations\Pivot;

class Membership extends Pivot
{
    protected $table = 'memberships';

    public $incrementing = true;

    protected function casts(): array
    {
        return ['role' => MembershipRole::class];
    }
}`,
    },
    {
      id: 'model-account-invitation',
      title: 'AccountInvitation',
      path: 'app/Models/AccountInvitation.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\MembershipRole;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AccountInvitation extends Model
{
    use HasFactory;

    protected $fillable = ['email', 'role', 'expires_at'];

    protected function casts(): array
    {
        return ['role' => MembershipRole::class, 'expires_at' => 'datetime', 'accepted_at' => 'datetime'];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }

    public function scopeOpen(Builder $query): void
    {
        $query->whereNull('accepted_at')->where('expires_at', '>', now());
    }
}`,
    },
    {
      id: 'model-property',
      title: 'Property',
      path: 'app/Models/Property.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\CancellationPolicy;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Property extends Model
{
    use HasFactory;

    protected $fillable = [
        'name', 'city', 'country', 'latitude', 'longitude', 'timezone', 'check_in_time', 'check_out_time',
        'bedrooms', 'max_guests', 'pets_allowed', 'amenities', 'min_nights', 'booking_lead_hours',
        'nightly_rate_cents', 'cleaning_fee_cents', 'tax_rate_bps', 'currency', 'cancellation_policy',
    ];

    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
            'pets_allowed' => 'boolean',
            'amenities' => 'array',
            'cancellation_policy' => CancellationPolicy::class,
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }

    public function calendarDays(): HasMany
    {
        return $this->hasMany(CalendarDay::class);
    }

    /** Top-level rate rules; groups hold their children (lesson 12). */
    public function rateRules(): HasMany
    {
        return $this->hasMany(RateRule::class)->whereNull('parent_id')->orderBy('position');
    }

    public function checklistTemplate(): HasOne
    {
        return $this->hasOne(ChecklistTemplate::class);
    }

    public function cleaningTasks(): HasMany
    {
        return $this->hasMany(CleaningTask::class);
    }

    public function channelListings(): HasMany
    {
        return $this->hasMany(ChannelListing::class);
    }

    public function icalFeeds(): HasMany
    {
        return $this->hasMany(IcalFeed::class);
    }
}`,
    },
    {
      id: 'model-calendar-day',
      title: 'CalendarDay',
      path: 'app/Models/CalendarDay.php',
      code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CalendarDay extends Model
{
    use HasFactory;

    public $timestamps = false;

    protected $fillable = ['date', 'blocked', 'price_cents', 'min_nights'];

    protected function casts(): array
    {
        return ['date' => 'date:Y-m-d', 'blocked' => 'boolean'];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }
}`,
    },
    {
      id: 'model-rate-rule',
      title: 'RateRule',
      path: 'app/Models/RateRule.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\RateRuleType;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RateRule extends Model
{
    use HasFactory;

    protected $fillable = ['type', 'name', 'starts_on', 'ends_on', 'settings', 'position'];

    protected function casts(): array
    {
        return [
            'type' => RateRuleType::class,
            'starts_on' => 'date:Y-m-d',
            'ends_on' => 'date:Y-m-d',
            'settings' => 'array',
        ];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('position');
    }
}`,
    },
    {
      id: 'model-checklist-template',
      title: 'ChecklistTemplate',
      path: 'app/Models/ChecklistTemplate.php',
      code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ChecklistTemplate extends Model
{
    use HasFactory;

    protected $fillable = ['items'];

    protected function casts(): array
    {
        return ['items' => 'array'];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }
}`,
    },
    {
      id: 'model-booking',
      title: 'Booking',
      text: [
        '`date:Y-m-d` keeps a date a date: a plain `date` cast becomes a Carbon at midnight in the app timezone. The door code is encrypted at rest. The booking itself is notifiable, routed to the guest’s email and phone, because guests are not users.',
        '[Lesson 1](../01-value-object/) adds two casts that turn `total_cents` + `currency` into `Money` and `check_in` + `check_out` into `Stay`: that is the pattern work, so it stays in the lesson.',
      ],
      path: 'app/Models/Booking.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\BookingSource;
use App\Enums\BookingStatus;
use App\Enums\CancellationPolicy;
use App\Enums\GuestChannel;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Notifications\Notifiable;

class Booking extends Model
{
    use HasFactory, Notifiable;

    protected $fillable = ['guest_name', 'guest_email', 'guest_phone', 'guest_channel', 'guest_locale', 'check_in', 'check_out', 'guests'];

    protected $hidden = ['door_code'];

    protected function casts(): array
    {
        return [
            'check_in' => 'date:Y-m-d',
            'check_out' => 'date:Y-m-d',
            'status' => BookingStatus::class,
            'source' => BookingSource::class,
            'guest_channel' => GuestChannel::class,
            'cancellation_policy' => CancellationPolicy::class,
            'door_code' => 'encrypted',
            'expires_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }

    public function lineItems(): HasMany
    {
        return $this->hasMany(BookingLineItem::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function scheduledMessages(): HasMany
    {
        return $this->hasMany(ScheduledMessage::class);
    }

    public function cleaningTask(): HasOne
    {
        return $this->hasOne(CleaningTask::class);
    }

    public function conversation(): HasOne
    {
        return $this->hasOne(Conversation::class);
    }

    public function reviewRequest(): HasOne
    {
        return $this->hasOne(ReviewRequest::class);
    }

    /** Bookings that occupy any night of [checkIn, checkOut). Back-to-back stays don't overlap. */
    public function scopeOverlapping(Builder $query, string $checkIn, string $checkOut): void
    {
        $query->whereIn('status', BookingStatus::blocking())
            ->where('check_in', '<', $checkOut)
            ->where('check_out', '>', $checkIn);
    }

    public function routeNotificationForMail(): string
    {
        return $this->guest_email;
    }

    public function routeNotificationForVonage(): ?string
    {
        return $this->guest_phone;
    }
}`,
    },
    {
      id: 'model-booking-line-item',
      title: 'BookingLineItem',
      path: 'app/Models/BookingLineItem.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\LineItemType;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BookingLineItem extends Model
{
    use HasFactory;

    protected $fillable = ['type', 'description', 'night', 'amount_cents', 'currency'];

    protected function casts(): array
    {
        return ['type' => LineItemType::class, 'night' => 'date:Y-m-d'];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }
}`,
    },
    {
      id: 'model-payment',
      title: 'Payment',
      path: 'app/Models/Payment.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\PaymentKind;
use App\Enums\PaymentStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    use HasFactory;

    /** Payments are only ever written by our own code, never filled from a request. */
    protected $fillable = ['kind', 'amount_cents', 'currency', 'status', 'provider_payment_id', 'due_at', 'failure_reason'];

    protected function casts(): array
    {
        return [
            'kind' => PaymentKind::class,
            'status' => PaymentStatus::class,
            'due_at' => 'datetime',
        ];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }
}`,
    },
    {
      id: 'model-channel-connection',
      title: 'ChannelConnection',
      text: [
        'OAuth tokens use Laravel’s `encrypted` cast, so a database dump never contains a usable token.',
      ],
      path: 'app/Models/ChannelConnection.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\Channel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ChannelConnection extends Model
{
    use HasFactory;

    protected $fillable = ['channel', 'access_token', 'refresh_token', 'expires_at'];

    protected $hidden = ['access_token', 'refresh_token'];

    protected function casts(): array
    {
        return [
            'channel' => Channel::class,
            'access_token' => 'encrypted',
            'refresh_token' => 'encrypted',
            'expires_at' => 'datetime',
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }
}`,
    },
    {
      id: 'model-channel-listing',
      title: 'ChannelListing',
      path: 'app/Models/ChannelListing.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\Channel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ChannelListing extends Model
{
    use HasFactory;

    protected $fillable = ['channel', 'external_listing_id'];

    protected function casts(): array
    {
        return ['channel' => Channel::class, 'last_pushed_at' => 'datetime'];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }
}`,
    },
    {
      id: 'model-ical-feed',
      title: 'IcalFeed',
      path: 'app/Models/IcalFeed.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\Channel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IcalFeed extends Model
{
    use HasFactory;

    protected $fillable = ['source', 'url'];

    protected function casts(): array
    {
        return ['source' => Channel::class, 'last_synced_at' => 'datetime'];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }
}`,
    },
    {
      id: 'model-webhook-event',
      title: 'WebhookEvent',
      path: 'app/Models/WebhookEvent.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\WebhookStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class WebhookEvent extends Model
{
    use HasFactory;

    protected $fillable = ['provider', 'event_id', 'type', 'payload'];

    protected function casts(): array
    {
        return ['payload' => 'array', 'status' => WebhookStatus::class, 'processed_at' => 'datetime'];
    }

    public function markProcessed(): void
    {
        $this->forceFill(['status' => WebhookStatus::Processed, 'processed_at' => now()])->save();
    }
}`,
    },
    {
      id: 'model-reconciliation-issue',
      title: 'ReconciliationIssue',
      path: 'app/Models/ReconciliationIssue.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\ReconciliationKind;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ReconciliationIssue extends Model
{
    use HasFactory;

    protected $fillable = ['kind', 'property_id', 'booking_id', 'details'];

    protected function casts(): array
    {
        return ['kind' => ReconciliationKind::class, 'details' => 'array', 'resolved_at' => 'datetime'];
    }
}`,
    },
    {
      id: 'model-message-template',
      title: 'MessageTemplate',
      path: 'app/Models/MessageTemplate.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\MessageTrigger;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MessageTemplate extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'trigger', 'offset_minutes', 'send_time', 'subject', 'body', 'active'];

    protected function casts(): array
    {
        return ['trigger' => MessageTrigger::class, 'active' => 'boolean'];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }
}`,
    },
    {
      id: 'model-scheduled-message',
      title: 'ScheduledMessage',
      path: 'app/Models/ScheduledMessage.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\ScheduledMessageStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ScheduledMessage extends Model
{
    use HasFactory;

    protected $fillable = ['message_template_id', 'send_at', 'status'];

    protected function casts(): array
    {
        return ['status' => ScheduledMessageStatus::class, 'send_at' => 'datetime', 'sent_at' => 'datetime'];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(MessageTemplate::class, 'message_template_id');
    }

    public function scopeDue(Builder $query): void
    {
        $query->where('status', ScheduledMessageStatus::Pending)->where('send_at', '<=', now());
    }
}`,
    },
    {
      id: 'model-conversation',
      title: 'Conversation',
      path: 'app/Models/Conversation.php',
      code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Conversation extends Model
{
    use HasFactory;

    protected function casts(): array
    {
        return ['last_message_at' => 'datetime'];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ChatMessage::class);
    }
}`,
    },
    {
      id: 'model-chat-message',
      title: 'ChatMessage',
      path: 'app/Models/ChatMessage.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\ChatSender;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ChatMessage extends Model
{
    use HasFactory;

    protected $fillable = ['body'];

    protected function casts(): array
    {
        return ['sender' => ChatSender::class, 'read_at' => 'datetime'];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }
}`,
    },
    {
      id: 'model-review-request',
      title: 'ReviewRequest',
      path: 'app/Models/ReviewRequest.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\ReviewRequestStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReviewRequest extends Model
{
    use HasFactory;

    protected $fillable = ['send_at', 'status'];

    protected function casts(): array
    {
        return ['status' => ReviewRequestStatus::class, 'send_at' => 'datetime', 'sent_at' => 'datetime'];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }
}`,
    },
    {
      id: 'model-cleaning-task',
      title: 'CleaningTask',
      path: 'app/Models/CleaningTask.php',
      code: String.raw`<?php

namespace App\Models;

use App\Enums\CleaningTaskStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CleaningTask extends Model
{
    use HasFactory;

    protected $fillable = ['property_id', 'due_at', 'status', 'checklist'];

    protected function casts(): array
    {
        return [
            'status' => CleaningTaskStatus::class,
            'checklist' => 'array',
            'due_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function cleaner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cleaner_id');
    }
}`,
    },
    {
      id: 'model-outbox-message',
      title: 'OutboxMessage',
      path: 'app/Models/OutboxMessage.php',
      code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OutboxMessage extends Model
{
    use HasFactory;

    protected $fillable = ['message_id', 'type', 'payload'];

    protected function casts(): array
    {
        return ['payload' => 'array', 'published_at' => 'datetime'];
    }
}`,
    },
    {
      id: 'model-idempotency-key',
      title: 'IdempotencyKey',
      path: 'app/Models/IdempotencyKey.php',
      code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class IdempotencyKey extends Model
{
    protected $fillable = ['user_id', 'key', 'request_hash', 'response_status', 'response_body'];
    protected function casts(): array
    {
        return ['response_body' => 'array'];
    }
}`,
    },
  ],
};
