// Scene 31 · Specification: one availability rule, used to check one property and to search for many.

export default {
  description: 'Guests found a free cabin in search, then were told at checkout that it was taken: search had its own copy of the availability rule, and it ignored holds and channel blocks. Fix it in Laravel with one Eloquent scope that every place uses: search, new bookings, date changes and moving a booking.',
  incident: {
    channel: '#support',
    when: 'Monday 19:40',
    messages: [
      ['Mona · support', 'Fourteen complaints since last week with the same story. Search for Rørvig, **12–15 July**: the cabin shows as free. Pick it, fill in everything, press Pay: **“The property is already booked for some nights”**.'],
      ['Mona · support', 'Every time, another guest had it on hold while paying, or it was sold on Booking.com.'],
      ['Karim · developer', 'Search was built last week with its own query. It counts confirmed bookings and nothing else.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Last week’s search: guests pick a city, dates and the number of guests, and get the properties that are free.'],
      blocks: [
        {
          path: 'app/Http/Controllers/SearchController.php',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\Stay;
use App\Enums\BookingStatus;
use App\Models\Property;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SearchController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'city' => ['required', 'string', 'max:80'],
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
            'guests' => ['required', 'integer', 'min:1', 'max:30'],
        ]);
        $stay = Stay::fromDates($data['check_in'], $data['check_out']);

        $taken = DB::table('bookings')
            ->select('property_id')
            ->where('status', BookingStatus::Confirmed->value)             // the bug: holds and channel blocks don't count
            ->where('check_in', '<', $stay->checkOut->toDateString())
            ->where('check_out', '>', $stay->checkIn->toDateString());

        $properties = Property::query()
            ->where('city', $data['city'])
            ->where('max_guests', '>=', $data['guests'])
            ->whereNotIn('id', $taken)
            ->orderBy('name')
            ->limit(50)
            ->get(['id', 'name', 'city', 'max_guests']);

        return response()->json(['data' => $properties]);
    }
}`,
          after: [
            'The booking side decides availability differently (scene 12): a night is taken by a **pending or confirmed** booking (`BookingStatus::blocking()`, scene 3), or by a **block from a channel** (`external_blocks`). Search wrote its own version of the rule, and got two parts of it wrong.',
            'Look for the rule in the code and there are four copies: `CreateBooking`, `ChangeBookingDates`, this search, and none at all where a host moves a booking to another property (scene 19 left a note: “Day 5 adds the availability check”).',
          ],
        },
        {
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CalendarRulesController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChangeDatesController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\DuplicatePropertyController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\MessageTemplateController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StayRulesController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices or search.
Route::get('/v1/properties/{property}/quote', QuoteController::class);
Route::get('/v1/search', SearchController::class);

// Everything a host does: logged in, inside one current account, every id checked by a policy.
Route::middleware(['auth:sanctum', SetCurrentAccount::class])->prefix('v1')->group(function (): void {
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property');
    Route::post('/properties/{property}/duplicate', DuplicatePropertyController::class)->can('update', 'property');
    Route::patch('/properties/{property}/stay-rules', StayRulesController::class)->can('update', 'property');
    Route::put('/properties/{property}/calendar-rules', CalendarRulesController::class)->can('update', 'property');

    Route::get('/bookings', [BookingController::class, 'index']);
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking');
    Route::post('/bookings/{booking}/payment', BookingPaymentController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/cancel', CancelBookingController::class)->can('update', 'booking');
    Route::patch('/bookings/{booking}/dates', ChangeDatesController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/mark-paid', MarkBookingPaidController::class)->can('update', 'booking');

    Route::post('/members', [AccountMemberController::class, 'store']);         // invite someone to the current account
    Route::delete('/members/{user}', [AccountMemberController::class, 'destroy']);

    Route::post('/message-templates', [MessageTemplateController::class, 'store']);
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
          after: ['The search route was added last week with the controller: public, like the quote.'],
        },
      ],
    },
    {
      title: 'The fix, part 1: the rule, written once, as a scope',
      text: [
        'A local scope is a piece of a query with a name. This one says what "free for these nights" means, using the two scopes that already exist: `Booking::overlapping()` (pending and confirmed bookings that share a night) and `ExternalBlock::overlapping()`.',
        'Because it is a query, it answers both questions: **"which properties are free?"** (add it to a search) and **"is this one free?"** (`whereKey($id)->availableFor($stay)->exists()`).',
      ],
      blocks: [
        {
          path: 'app/Models/Property.php',
          code: String.raw`<?php

namespace App\Models;

use App\Bookings\Stay;
use App\Casts\MoneyCast;
use App\Enums\CancellationPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Property extends Model
{
    use HasFactory;

    protected $fillable = [
        'name', 'city', 'country', 'timezone', 'check_in_time', 'check_out_time',
        'max_guests', 'nightly_rate_cents', 'cleaning_fee_cents', 'currency',
    ];

    protected function casts(): array
    {
        return [
            'nightly_rate' => MoneyCast::class . ':nightly_rate_cents',   // Money from nightly_rate_cents + currency
            'cancellation_policy' => CancellationPolicy::class,          // the terms for new bookings
        ];
    }

    /**
     * Properties where every night of $stay is free: no pending or confirmed booking, no block from a channel.
     * $ignoring: the booking being changed, which never blocks its own new dates.
     */
    public function scopeAvailableFor(Builder $query, Stay $stay, ?Booking $ignoring = null): void
    {
        $query
            ->whereDoesntHave('bookings', function (Builder $bookings) use ($stay, $ignoring): void {
                $bookings->overlapping($stay);
                if ($ignoring !== null) {
                    $bookings->whereKeyNot($ignoring->id);
                }
            })
            ->whereDoesntHave('externalBlocks', fn (Builder $blocks) => $blocks->overlapping($stay));
    }

    /** Null when the stay is long enough, or the message to show the guest. */
    public function stayTooShort(Stay $stay): ?string
    {
        $minNights = $this->minNightsOn($stay->checkIn);

        return $stay->nights() < $minNights
            ? "Stays arriving on {$stay->checkIn->toDateString()} must be {$minNights} nights or more."
            : null;
    }

    /** The minimum for stays that arrive on this date: the date's own rule, or the property's default. */
    public function minNightsOn(CarbonImmutable $arrival): int
    {
        $rule = $this->calendarDays()
            ->where('date', $arrival->toDateString())                     // a plain comparison: whereDate() would wrap the column in DATE() and skip the index
            ->value('min_nights');

        return $rule ?? $this->min_nights;
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function ratePlan(): BelongsTo
    {
        return $this->belongsTo(RatePlan::class);                      // shared: several listings can use one plan
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }

    public function icalFeeds(): HasMany
    {
        return $this->hasMany(IcalFeed::class);
    }

    public function externalBlocks(): HasMany
    {
        return $this->hasMany(ExternalBlock::class);
    }

    public function channelListings(): HasMany
    {
        return $this->hasMany(ChannelListing::class);
    }

    public function calendarDays(): HasMany
    {
        return $this->hasMany(CalendarDay::class);
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: search uses it',
      blocks: [
        {
          path: 'app/Http/Controllers/SearchController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\Stay;
use App\Models\Property;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SearchController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'city' => ['required', 'string', 'max:80'],
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
            'guests' => ['required', 'integer', 'min:1', 'max:30'],
        ]);
        $stay = Stay::fromDates($data['check_in'], $data['check_out']);

        $properties = Property::query()
            ->where('city', $data['city'])
            ->where('max_guests', '>=', $data['guests'])
            ->availableFor($stay)                                          // the same rule the booking checks
            ->orderBy('name')
            ->limit(50)
            ->get(['id', 'name', 'city', 'max_guests']);

        return response()->json(['data' => $properties]);
    }
}`,
          after: ['Search can still be wrong for a few seconds: a guest can take the last free cabin between the search and the click. That is fine, because the booking checks again under a lock (scene 4). Search is a good guess; the booking is the decision.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: every booking path asks the same question',
      text: ['The new booking and the date change replace their own two-line checks with the scope, after the same lock as before:'],
      blocks: [
        {
          path: 'app/Bookings/CreateBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;
use Illuminate\Support\Facades\DB;

final class CreateBooking
{
    public const HOLD_MINUTES = 30;

    public function __construct(private PriceQuoter $quoter)
    {
    }

    /** @param array{guest_name: string, guest_email: string, guest_phone: ?string, guest_channel: string, guests: int} $guest */
    public function handle(Property $property, Stay $stay, array $guest): Booking
    {
        return DB::transaction(function () use ($property, $stay, $guest): Booking {
            Property::whereKey($property->id)->lockForUpdate()->firstOrFail();   // others wait here

            if (! Property::whereKey($property->id)->availableFor($stay)->exists()) {   // the one availability rule
                throw BookingConflict::for($stay);
            }

            $quote = $this->quoter->quote($property, $stay);              // the same price the page showed

            $booking = new Booking($guest);
            $booking->stay = $stay;
            $booking->total = $quote->total();
            $booking->cancellation_policy = $property->cancellation_policy;   // the terms the guest agreed to, frozen
            $booking->status = BookingStatus::Pending;
            $booking->expires_at = now()->addMinutes(self::HOLD_MINUTES);
            $property->bookings()->save($booking);

            $booking->lineItems()->createMany(array_map(fn (LineItem $line): array => [
                'type' => $line->type,
                'description' => $line->description,
                'amount' => $line->amount,
            ], $quote->lines));                                           // every line of the bill, kept

            return $booking;
        }, attempts: 3);                                                   // retried on a deadlock
    }
}`,
        },
        {
          path: 'app/Bookings/ChangeBookingDates.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Channels\CalendarSync;
use App\Enums\PaymentStatus;
use App\Messaging\RescheduleGuestMessages;
use App\Models\Booking;
use App\Models\BookingChange;
use App\Models\Property;
use App\Payments\PaymentGateway;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;
use Illuminate\Support\Facades\DB;

final readonly class ChangeBookingDates
{
    public function __construct(
        private PriceQuoter $quoter,
        private PaymentGateway $gateway,
        private RescheduleGuestMessages $reschedule,
        private CalendarSync $calendar,
    ) {
    }

    /** @return string|null the client secret for the extra payment, or null when nothing more is owed */
    public function handle(Booking $booking, Stay $newStay): ?string
    {
        return DB::transaction(function () use ($booking, $newStay): ?string {
            Property::whereKey($booking->property_id)->lockForUpdate()->firstOrFail();

            if (! Property::whereKey($booking->property_id)->availableFor($newStay, ignoring: $booking)->exists()) {
                throw BookingConflict::for($newStay);                   // 409, nothing changed
            }

            $change = BookingChange::forceCreate(['booking_id' => $booking->id, 'snapshot' => $booking->snapshot()->toArray()]);

            $quote = $this->quoter->quote($booking->property, $newStay);
            $difference = $quote->total()->add($booking->total->negate());

            $booking->stay = $newStay;                                  // the nights are ours from now on
            $booking->total = $quote->total();
            $booking->save();
            $booking->lineItems()->delete();
            $booking->lineItems()->createMany(array_map(fn (LineItem $line): array => [
                'type' => $line->type, 'description' => $line->description, 'amount' => $line->amount,
            ], $quote->lines));

            $this->reschedule->handle($booking);                        // messages follow the new dates
            $this->calendar->bookingChanged($booking);                  // channels and the cleaning follow too

            if ($difference->amount <= 0) {
                $change->forceFill(['status' => 'settled'])->save();    // a shorter stay: refunds go through scene 10's job
                return null;
            }

            $intent = $this->gateway->createPaymentIntent($difference, ['booking_id' => (string) $booking->id], "booking-change-{$change->id}");
            $booking->payments()->create([
                'amount_cents' => $difference->amount, 'currency' => $difference->currency->value,
                'status' => PaymentStatus::Pending, 'provider_payment_id' => $intent['id'], 'booking_change_id' => $change->id,
            ]);

            return $intent['client_secret'];
        });
    }
}`,
          after: ['`ignoring: $booking` is what lets a guest extend into nights that are already her own: 10–13 July extended to 10–15 July overlaps her current booking, which must not count.'],
        },
        {
          title: 'Moving a booking gets the check it never had',
          text: [
            'Scene 19 let a host move a booking to another of her properties, with a promise to check availability later. It becomes an action: lock the target property, ask the same question, move, and tell `CalendarSync` about both properties: the new one is now taken, the old one is free.',
          ],
          path: 'app/Bookings/MoveBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Channels\CalendarSync;
use App\Models\Booking;
use App\Models\Property;
use Illuminate\Support\Facades\DB;

final readonly class MoveBooking
{
    public function __construct(private CalendarSync $calendar)
    {
    }

    public function handle(Booking $booking, Property $to): Booking
    {
        return DB::transaction(function () use ($booking, $to): Booking {
            Property::whereKey($to->id)->lockForUpdate()->firstOrFail();     // the same lock as a new booking there

            if (! Property::whereKey($to->id)->availableFor($booking->stay)->exists()) {
                throw BookingConflict::for($booking->stay);                 // 409, the booking stays where it is
            }

            $from = $booking->property;
            $booking->property()->associate($to);
            $booking->save();

            $this->calendar->bookingChanged($booking);                      // the new property: channels, clashes, cleaning
            $this->calendar->bookingLeft($from);                            // the old one: its nights are free again

            return $booking;
        });
    }
}`,
        },
        {
          path: 'app/Http/Controllers/BookingController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\CreateBooking;
use App\Bookings\MoveBooking;
use App\Http\Requests\MoveBookingRequest;
use App\Http\Requests\StoreBookingRequest;
use App\Http\Resources\BookingResource;
use App\Models\Account;
use App\Models\Booking;
use App\Models\Property;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class BookingController extends Controller
{
    public function store(StoreBookingRequest $request, Property $property, CreateBooking $createBooking): BookingResource
    {
        $booking = $createBooking->handle(
            $property,
            $request->stay(),
            $request->safe()->only(['guest_name', 'guest_email', 'guest_phone', 'guests'])
                + ['guest_channel' => $request->validated('contact_channel')],
        );

        return new BookingResource($booking);
    }

    public function index(Account $account): AnonymousResourceCollection
    {
        return BookingResource::collection(
            $account->bookings()->latest('bookings.id')->cursorPaginate(50),   // the account is injected by the middleware
        );
    }

    public function show(Booking $booking): BookingResource
    {
        return new BookingResource($booking);                                     // the route's policy has checked it
    }

    public function move(MoveBookingRequest $request, Booking $booking, MoveBooking $move): BookingResource
    {
        $to = Property::findOrFail($request->validated('property_id'));           // the request checked it's in this account

        return new BookingResource($move->handle($booking, $to));                // 409 when the nights are taken there
    }
}`,
        },
        {
          title: 'The coordinator learns that a booking can leave a property',
          path: 'app/Channels/CalendarSync.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Enums\BookingStatus;
use App\Enums\MembershipRole;
use App\Jobs\PushAvailability;
use App\Models\Booking;
use App\Models\Overbooking;
use App\Models\Property;
use App\Notifications\OverbookingDetected;
use App\Operations\PlanTurnover;
use Illuminate\Support\Facades\Notification;

final class CalendarSync
{
    public function __construct(private PlanTurnover $turnover)
    {
    }

    /** A booking was created, confirmed, imported, cancelled, expired, moved to other dates or to this property. */
    public function bookingChanged(Booking $booking): void
    {
        if (in_array($booking->status, BookingStatus::blocking(), true)) {
            $this->recordClashes($booking);
        }

        $this->turnover->forBooking($booking);                          // the cleaning follows the booking

        PushAvailability::forProperty($booking->property);           // every channel learns the new state (scene 17)
    }

    /** A booking moved away from this property: its nights are free here now. */
    public function bookingLeft(Property $property): void
    {
        PushAvailability::forProperty($property);
    }

    /** An iCal sync changed the blocks of a property (scene 12). */
    public function blocksChanged(Property $property): void
    {
        PushAvailability::forProperty($property);
    }

    /** The host changed a rule the channels enforce for us, like the minimum stay. */
    public function stayRulesChanged(Property $property): void
    {
        PushAvailability::forProperty($property);
    }

    private function recordClashes(Booking $booking): void
    {
        $clashes = $booking->property->bookings()
            ->overlapping($booking->stay)
            ->whereKeyNot($booking->id)
            ->where('id', '<', $booking->id)                               // earlier bookings only: each clash is recorded once, on the later one
            ->get();

        foreach ($clashes as $earlier) {
            $overbooking = Overbooking::createOrFirst([
                'property_id' => $booking->property_id,
                'booking_id' => $booking->id,
                'conflicting_booking_id' => $earlier->id,
            ]);

            if ($overbooking->wasRecentlyCreated) {
                $owners = $booking->property->account->users()->wherePivot('role', MembershipRole::Owner->value)->get();
                Notification::send($owners, (new OverbookingDetected($overbooking))->afterCommit());
            }
        }
    }
}`,
          after: ['Today the three property methods do the same thing: push. They stay separate because they say *why* the calendar changed, and the reasons will not stay the same: scene 32 adds a live update for the host’s screen to the booking changes only.'],
        },
        {
          title: 'The cleaning moves with the booking',
          text: ['`PlanTurnover` from scene 26 compared only the start time. A moved booking keeps its dates, so its cleaning must also follow it to the new property:'],
          path: 'app/Operations/PlanTurnover.php',
          code: String.raw`<?php

namespace App\Operations;

use App\Enums\BookingStatus;
use App\Enums\CleaningTaskStatus;
use App\Models\Booking;
use App\Models\CleaningTask;
use App\Notifications\TurnoverChanged;
use Carbon\CarbonImmutable;

final class PlanTurnover
{
    /** Make the cleaning after $booking match the booking as it is now. Safe to call any number of times. */
    public function forBooking(Booking $booking): void
    {
        $task = CleaningTask::firstWhere('booking_id', $booking->id);

        if ($task?->status === CleaningTaskStatus::Done) {
            return;                                                     // already cleaned: history, not a plan
        }

        if (! in_array($booking->status, BookingStatus::blocking(), true)) {   // cancelled or expired
            if ($task?->status === CleaningTaskStatus::Pending) {
                $task->forceFill(['status' => CleaningTaskStatus::Cancelled])->save();
                $this->tellCleaner($task);
            }

            return;
        }

        $startsAt = $this->checkOutMoment($booking);

        if ($task === null) {
            CleaningTask::forceCreate([
                'property_id' => $booking->property_id,
                'booking_id' => $booking->id,
                'starts_at' => $startsAt,
                'status' => CleaningTaskStatus::Pending,
            ]);

            return;                                                     // nobody is assigned yet: nobody to tell
        }

        $unchanged = $task->status === CleaningTaskStatus::Pending
            && $task->property_id === $booking->property_id
            && $task->starts_at->equalTo($startsAt);
        if ($unchanged) {
            return;                                                     // nothing moved: no message
        }

        $task->forceFill(['property_id' => $booking->property_id, 'starts_at' => $startsAt, 'status' => CleaningTaskStatus::Pending])->save();
        $this->tellCleaner($task);
    }

    /** 14 July at 11:00 in Copenhagen → 2027-07-14 09:00 UTC. */
    private function checkOutMoment(Booking $booking): CarbonImmutable
    {
        $property = $booking->property;

        return CarbonImmutable::parse("{$booking->stay->checkOut->toDateString()} {$property->check_out_time}", $property->timezone)
            ->utc();
    }

    private function tellCleaner(CleaningTask $task): void
    {
        if ($task->cleaner !== null) {
            $task->cleaner->notify((new TurnoverChanged($task))->afterCommit());   // never about a change that rolled back
        }
    }
}`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Specification'],
    rules: [['Specification', 'A business rule packaged on its own, so the same rule can check one object and select every object that satisfies it.']],
    points: [
      '`availableFor()` is the rule "every night of this stay is free". It doesn’t search, book or move anything; it only says what free means.',
      'Four places use it: search, a new booking, a date change and a move. When the rule changes (a cleaning day blocked after every stay, say), it changes once.',
      'In Laravel the natural form of a specification is a **local scope**: the database applies it to millions of rows, and `exists()` turns it into a yes or no for one.',
    ],
    whenNot: [
      'A condition used in one query only: a plain `where()` is clearer than a named scope.',
      'A rule that must hold for objects not in the database yet: then it’s a method on the object, like `stayTooShort()`, not a query.',
    ],
  },
  laravel: {
    title: 'Laravel inside: what availableFor() sends to MySQL',
    text: [
      '`whereDoesntHave()` becomes a `NOT EXISTS` subquery, which MySQL stops evaluating at the first matching row. `toRawSql()` prints the query with its values filled in:',
    ],
    blocks: [
      {
        path: 'php artisan tinker',
        fragment: true,
        code: String.raw`Property::query()->where('city', 'Rørvig')->availableFor(Stay::fromDates('2027-07-12', '2027-07-15'))->toRawSql();`,
      },
      {
        path: 'the SQL',
        lang: 'sql',
        code: String.raw`SELECT * FROM properties
WHERE city = 'Rørvig'
  AND NOT EXISTS (
    SELECT * FROM bookings
    WHERE properties.id = bookings.property_id
      AND status IN ('pending', 'confirmed')
      AND check_in < '2027-07-15'
      AND check_out > '2027-07-12'
  )
  AND NOT EXISTS (
    SELECT * FROM external_blocks
    WHERE properties.id = external_blocks.property_id
      AND starts_on < '2027-07-15'
      AND ends_on > '2027-07-12'
  )`,
        after: [
          'Each subquery looks up one property’s rows by `property_id`, then by dates. An index on `bookings (property_id, check_in)` keeps it fast; scene 34 measures it with `EXPLAIN`.',
          '**When SQL is enough:** until searches need typo-tolerant text, relevance ranking or facets over many thousands of listings, a database query with the right indexes is simpler and always current. Even with a search engine, availability is checked like this, against the database: an index that lags by a few seconds would show taken cabins as free, which is this incident again.',
        ],
      },
    ],
  },
  tests: {
    summary: 'The incident, search and booking agreeing in every case, a guest extending her own stay, and a move into taken nights',
    blocks: [
      {
        path: 'tests/Feature/AvailabilityTest.php',
        code: String.raw`<?php

use App\Bookings\BookingConflict;
use App\Bookings\ChangeBookingDates;
use App\Bookings\CreateBooking;
use App\Bookings\Stay;
use App\Enums\BookingStatus;
use App\Enums\Channel;
use App\Models\Booking;
use App\Models\ExternalBlock;
use App\Models\Property;
use App\Payments\PaymentGateway;
use Tests\Fakes\FakePaymentGateway;

beforeEach(function () {
    $this->app->instance(PaymentGateway::class, new FakePaymentGateway());
    $this->cabin = Property::factory()->create(['name' => 'Rørvig cabin', 'city' => 'Rørvig']);
});

function searchIds(string $checkIn, string $checkOut): array
{
    return collect(test()->getJson("/api/v1/search?city=Rørvig&check_in={$checkIn}&check_out={$checkOut}&guests=2")->assertOk()->json('data'))
        ->pluck('id')->all();
}

function canBook(Property $property, string $checkIn, string $checkOut): bool
{
    try {
        app(CreateBooking::class)->handle($property, Stay::fromDates($checkIn, $checkOut), [
            'guest_name' => 'Søren', 'guest_email' => 'soren@example.com', 'guest_phone' => null, 'guest_channel' => 'email', 'guests' => 2,
        ]);

        return true;
    } catch (BookingConflict) {
        return false;
    }
}

it('hides a cabin another guest is holding while she pays', function () {
    Booking::factory()->for($this->cabin)->forStay('2027-07-13', 2)->pending()->create();

    expect(searchIds('2027-07-12', '2027-07-15'))->toBe([]);                    // the incident
});

it('agrees with the booking, whatever is in the calendar', function (Closure $occupy, bool $free) {
    $occupy($this->cabin);

    expect(in_array($this->cabin->id, searchIds('2027-07-12', '2027-07-15'), true))->toBe($free)
        ->and(canBook($this->cabin, '2027-07-12', '2027-07-15'))->toBe($free);
})->with([
    'nothing booked' => [fn (Property $p) => null, true],
    'a confirmed stay' => [fn (Property $p) => Booking::factory()->for($p)->forStay('2027-07-14', 3)->create(), false],
    'a hold' => [fn (Property $p) => Booking::factory()->for($p)->forStay('2027-07-14', 3)->pending()->create(), false],
    'an expired hold' => [fn (Property $p) => Booking::factory()->for($p)->forStay('2027-07-14', 3)->create(['status' => BookingStatus::Expired]), true],
    'a cancelled stay' => [fn (Property $p) => Booking::factory()->for($p)->forStay('2027-07-14', 3)->cancelled()->create(), true],
    'sold on Booking.com' => [fn (Property $p) => ExternalBlock::forceCreate(['property_id' => $p->id, 'source' => Channel::BookingCom, 'uid' => 'bk-1', 'kind' => 'blocked', 'starts_on' => '2027-07-13', 'ends_on' => '2027-07-14']), false],
    'guests leaving the morning we arrive' => [fn (Property $p) => Booking::factory()->for($p)->forStay('2027-07-09', 3)->create(), true],
]);

it('lets a guest extend into nights that are already hers', function () {
    $booking = Booking::factory()->for($this->cabin)->forStay('2027-07-10', 3)->create();

    app(ChangeBookingDates::class)->handle($booking, Stay::fromDates('2027-07-10', '2027-07-15'));

    expect($booking->fresh()->stay->nights())->toBe(5);
});

it('refuses to move a booking into nights that are taken', function () {
    $host = hostOf($this->cabin);
    $other = Property::factory()->for($this->cabin->account)->create();
    Booking::factory()->for($other)->forStay('2027-07-11', 2)->create();
    $booking = Booking::factory()->for($this->cabin)->forStay('2027-07-10', 3)->create();

    $this->actingAs($host)
        ->patchJson("/api/v1/bookings/{$booking->id}/property", ['property_id' => $other->id])
        ->assertConflict();

    expect($booking->fresh()->property_id)->toBe($this->cabin->id);
});`,
        after: ['The dataset is the specification’s contract: for every kind of calendar entry, search and booking must give the same answer. A new kind of entry (a host’s own block, say) gets a row here first.'],
      },
    ],
  },
  next: 'Search and booking agree now. Next, a host watches her calendar while Airbnb sells a week of it, and nothing on her screen changes.',
};
