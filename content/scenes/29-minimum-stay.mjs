// Scene 29 · A minimum stay that every door knows: our own forms, date changes and the channels.

export default {
  description: 'Booking.com sold one night of a cabin that takes three-night stays at least: the minimum stay was checked on our booking form and nowhere else, and never sent to the channels. Fix it in Laravel: one rule on the property, used by every booking path of our own, and pushed to every channel with the open nights.',
  incident: {
    channel: '#support',
    when: 'Friday 17:20',
    messages: [
      ['Erik · host, Rørvig cabin', 'I set a **3-night minimum** last week. Booking.com just sold **one night**, Saturday 10 July. Now Friday and Sunday are single nights nobody can book.'],
      ['Mona · support', 'On our own site the form refuses 1 night, I tried. And a guest just shortened her booking at the same cabin from three nights to **one**, through our date-change page.'],
      ['Karim · developer', 'The minimum lives in one place: the booking form’s validation. Booking.com never heard of it, and neither did the date change.'],
    ],
  },
  sections: [
    {
      title: 'Last week’s feature',
      text: ['Hosts can now set a minimum number of nights per property, in the property settings:'],
      blocks: [
        {
          path: 'database/migrations/2026_04_21_000001_add_min_nights_to_properties_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->unsignedTinyInteger('min_nights')->default(1);   // 1 = no minimum
        });
    }
};`,
        },
        {
          path: 'app/Http/Requests/StoreBookingRequest.php',
          code: String.raw`<?php

namespace App\Http\Requests;

use App\Bookings\Stay;
use App\Enums\GuestChannel;
use App\Models\Property;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreBookingRequest extends FormRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        /** @var Property $property */
        $property = $this->route('property');

        return [
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
            'guests' => ['required', 'integer', 'min:1', "max:{$property->max_guests}"],
            'guest_name' => ['required', 'string', 'max:120'],
            'guest_email' => ['required', 'email:rfc', 'max:254'],
            'contact_channel' => ['required', Rule::enum(GuestChannel::class)],            // email, sms or whatsapp
            'guest_phone' => ['required_unless:contact_channel,email', 'nullable', 'regex:/^\+[1-9]\d{7,14}$/'],   // E.164: +4512345678
        ];
    }

    /** @return list<callable> checks that run after the rules above pass */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;                                                 // the dates themselves are invalid
            }

            $property = $this->route('property');
            if ($this->stay()->nights() < $property->min_nights) {
                $validator->errors()->add('check_out', "This property takes stays of {$property->min_nights} nights or more.");
            }
        }];
    }

    public function stay(): Stay
    {
        return Stay::fromDates($this->validated('check_in'), $this->validated('check_out'));
    }
}`,
        },
        {
          path: 'app/Http/Controllers/StayRulesController.php',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Models\Property;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StayRulesController extends Controller
{
    public function __invoke(Request $request, Property $property): JsonResponse
    {
        $data = $request->validate(['min_nights' => ['required', 'integer', 'min:1', 'max:30']]);

        $property->forceFill(['min_nights' => $data['min_nights']])->save();   // the bug: only our own form will ever read it

        return response()->json(['min_nights' => $property->min_nights]);
    }
}`,
        },
        {
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChangeDatesController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\DuplicatePropertyController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\MessageTemplateController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\StayRulesController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices.
Route::get('/v1/properties/{property}/quote', QuoteController::class);

// Everything a host does: logged in, inside one current account, every id checked by a policy.
Route::middleware(['auth:sanctum', SetCurrentAccount::class])->prefix('v1')->group(function (): void {
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property');
    Route::post('/properties/{property}/duplicate', DuplicatePropertyController::class)->can('update', 'property');
    Route::patch('/properties/{property}/stay-rules', StayRulesController::class)->can('update', 'property');

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
        },
      ],
    },
    {
      title: 'The broken code',
      text: [
        'The settings controller above saves the number and stops. Nothing else changes: the availability push from scene 17 sends each run of nights as open or closed, and nothing more. So Booking.com and Airbnb only know whether a night is free, never how long a stay must be:',
      ],
      blocks: [
        {
          path: 'app/Channels/BookingCom/BookingComApi.php (the request it sends, before)',
          broken: true,
          fragment: true,
          lang: 'xml',
          code: String.raw`<request>
    <hotel_id>8812345</hotel_id>
    <date from="2027-07-09" to="2027-07-11"><closed>0</closed></date>   <!-- open, and nothing else -->
</request>`,
          after: [
            'There are three doors a booking can come through: our booking form, our date-change page (scene 23), and the channels. The rule guarded one of them.',
            'A reservation Booking.com has already sold is a contract with the guest. We can’t refuse it after the fact, so the rule has to reach Booking.com **before** it sells.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: the rule lives on the property',
      text: ['One method answers "is this stay too short here?", and every door of our own asks it.'],
      blocks: [
        {
          path: 'app/Models/Property.php',
          code: String.raw`<?php

namespace App\Models;

use App\Bookings\Stay;
use App\Casts\MoneyCast;
use App\Enums\CancellationPolicy;
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

    /** Null when the stay is long enough, or the message to show the guest. */
    public function stayTooShort(Stay $stay): ?string
    {
        return $stay->nights() < $this->min_nights
            ? "This property takes stays of {$this->min_nights} nights or more."
            : null;
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
}`,
        },
        {
          title: 'The booking form asks the property',
          path: 'app/Http/Requests/StoreBookingRequest.php',
          code: String.raw`<?php

namespace App\Http\Requests;

use App\Bookings\Stay;
use App\Enums\GuestChannel;
use App\Models\Property;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreBookingRequest extends FormRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        /** @var Property $property */
        $property = $this->route('property');

        return [
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
            'guests' => ['required', 'integer', 'min:1', "max:{$property->max_guests}"],
            'guest_name' => ['required', 'string', 'max:120'],
            'guest_email' => ['required', 'email:rfc', 'max:254'],
            'contact_channel' => ['required', Rule::enum(GuestChannel::class)],            // email, sms or whatsapp
            'guest_phone' => ['required_unless:contact_channel,email', 'nullable', 'regex:/^\+[1-9]\d{7,14}$/'],   // E.164: +4512345678
        ];
    }

    /** @return list<callable> checks that run after the rules above pass */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;                                                 // the dates themselves are invalid
            }

            $tooShort = $this->route('property')->stayTooShort($this->stay());
            if ($tooShort !== null) {
                $validator->errors()->add('check_out', $tooShort);
            }
        }];
    }

    public function stay(): Stay
    {
        return Stay::fromDates($this->validated('check_in'), $this->validated('check_out'));
    }
}`,
        },
        {
          title: 'So does the date change',
          text: ['The second door. A rule that fails outside a Form Request throws the same 422 with `ValidationException::withMessages()`.'],
          path: 'app/Http/Controllers/ChangeDatesController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\ChangeBookingDates;
use App\Bookings\Stay;
use App\Models\Booking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class ChangeDatesController extends Controller
{
    public function __invoke(Request $request, Booking $booking, ChangeBookingDates $change): JsonResponse
    {
        $data = $request->validate([
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
        ]);
        $stay = Stay::fromDates($data['check_in'], $data['check_out']);

        $tooShort = $booking->property->stayTooShort($stay);
        if ($tooShort !== null) {
            throw ValidationException::withMessages(['check_out' => $tooShort]);   // 422, like the booking form
        }

        $secret = $change->handle($booking, $stay);                           // 409 when the nights are taken

        return response()->json(['client_secret' => $secret]);                // null: nothing more to pay
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: every open night carries the minimum to the channels',
      text: [
        'Both channels accept a minimum stay together with availability: Airbnb as `min_nights` on a calendar range, Booking.com as `<min_stay_arrival>` on a date range. So "open" becomes "open, for stays of at least N nights", and the interface says so. A closed night needs no minimum.',
      ],
      blocks: [
        {
          path: 'app/Channels/ChannelApi.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Bookings\Stay;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;

interface ChannelApi
{
    /** Make these nights unbookable on the channel. Throws ChannelRequestFailed when the channel refuses. */
    public function closeDates(ChannelListing $listing, Stay $nights): void;

    /** Make these nights bookable, for stays of at least $minNights nights. */
    public function openDates(ChannelListing $listing, Stay $nights, int $minNights): void;

    /** @return iterable<ChannelReservation> every reservation of the listing modified since $since */
    public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable;
}`,
          after: ['PHP refuses to load a class that implements the interface with the old signature, so no adapter can be forgotten. The three that implement it change below.'],
        },
        {
          path: 'app/Channels/Airbnb/AirbnbApi.php',
          code: String.raw`<?php

namespace App\Channels\Airbnb;

use App\Bookings\Stay;
use App\Channels\ChannelApi;
use App\Channels\ChannelRequestFailed;
use App\Enums\Channel;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;

final readonly class AirbnbApi implements ChannelApi
{
    public function __construct(
        private AirbnbTokens $tokens,
        private string $baseUrl,
    ) {
    }

    public function closeDates(ChannelListing $listing, Stay $nights): void
    {
        $this->setAvailability($listing, $nights, ['availability' => 'unavailable']);
    }

    public function openDates(ChannelListing $listing, Stay $nights, int $minNights): void
    {
        $this->setAvailability($listing, $nights, ['availability' => 'available', 'min_nights' => $minNights]);
    }

    /** @param array<string, string|int> $fields */
    private function setAvailability(ChannelListing $listing, Stay $nights, array $fields): void
    {
        $response = Http::withToken($this->tokens->for($listing))
            ->timeout(10)
            ->retry([200, 600], when: ChannelRequestFailed::worthRetrying(...), throw: false)   // two more tries, 200 and 600 ms apart
            ->acceptJson()
            ->put("{$this->baseUrl}/calendars/{$listing->external_listing_id}", [
                'start_date' => $nights->checkIn->toDateString(),
                'end_date' => $nights->checkOut->subDay()->toDateString(),   // Airbnb counts nights inclusively
                ...$fields,
            ]);

        if ($response->failed()) {
            throw ChannelRequestFailed::from(Channel::Airbnb, $response);  // never a silent 401 again
        }
    }

    public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable
    {
        $mapper = new AirbnbReservationMapper();
        $cursor = null;

        do {
            $response = Http::withToken($this->tokens->for($listing))->timeout(10)->acceptJson()
                ->get("{$this->baseUrl}/reservations", array_filter([
                    'listing_id' => $listing->external_listing_id,
                    'updated_since' => $since->toIso8601String(),
                    'cursor' => $cursor,
                ]));

            if ($response->failed()) {
                throw ChannelRequestFailed::from(Channel::Airbnb, $response);
            }

            foreach ($response->json('reservations') as $reservation) {
                yield $mapper->reservation(['reservation' => $reservation]);   // the same mapper as the webhooks
            }

            $cursor = $response->json('next_cursor');
        } while ($cursor !== null);
    }
}`,
        },
        {
          path: 'app/Channels/BookingCom/BookingComApi.php',
          code: String.raw`<?php

namespace App\Channels\BookingCom;

use App\Bookings\Stay;
use App\Channels\ChannelApi;
use App\Channels\ChannelRequestFailed;
use App\Enums\Channel;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;

final readonly class BookingComApi implements ChannelApi
{
    public function __construct(
        private string $baseUrl,
        private string $username,
        private string $password,
    ) {
    }

    public function closeDates(ChannelListing $listing, Stay $nights): void
    {
        $this->send($listing, $nights, '<closed>1</closed>');
    }

    public function openDates(ChannelListing $listing, Stay $nights, int $minNights): void
    {
        $this->send($listing, $nights, "<closed>0</closed><min_stay_arrival>{$minNights}</min_stay_arrival>");   // an int: safe in XML
    }

    private function send(ChannelListing $listing, Stay $nights, string $restrictions): void
    {
        $xml = sprintf(
            '<request><hotel_id>%s</hotel_id><date from="%s" to="%s">%s</date></request>',
            htmlspecialchars($listing->external_listing_id, ENT_XML1),            // never trust a value inside XML
            $nights->checkIn->toDateString(),
            $nights->checkOut->subDay()->toDateString(),
            $restrictions,
        );

        $response = Http::withBasicAuth($this->username, $this->password)
            ->timeout(10)
            ->retry([200, 600], when: ChannelRequestFailed::worthRetrying(...), throw: false)   // two more tries, 200 and 600 ms apart
            ->withBody($xml, 'text/xml')
            ->post("{$this->baseUrl}/hotels/xml/availability");

        // Booking.com-style XML APIs can answer 200 with an error inside the body
        if ($response->failed() || str_contains($response->body(), '<error')) {
            throw ChannelRequestFailed::from(Channel::BookingCom, $response);
        }
    }

    public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable
    {
        $mapper = new BookingComReservationMapper();
        $page = 1;

        do {
            $response = Http::withBasicAuth($this->username, $this->password)->timeout(10)->acceptJson()
                ->get("{$this->baseUrl}/hotels/json/reservations", [
                    'hotel_id' => $listing->external_listing_id,
                    'last_change' => $since->utc()->format('Y-m-d H:i:s'),
                    'page' => $page,
                ]);

            if ($response->failed()) {
                throw ChannelRequestFailed::from(Channel::BookingCom, $response);
            }

            foreach ($response->json('reservations') as $reservation) {
                yield $mapper->reservation(['reservation' => $reservation]);   // the same mapper as the webhooks
            }

            $page++;
        } while ($response->json('has_more') === true);
    }
}`,
        },
        {
          path: 'app/Channels/ThrottledChannelApi.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Bookings\Stay;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Facades\RateLimiter;

final readonly class ThrottledChannelApi implements ChannelApi
{
    public function __construct(
        private ChannelApi $inner,
        private string $channel,
        private int $perMinute,
    ) {
    }

    public function closeDates(ChannelListing $listing, Stay $nights): void
    {
        $this->throttle(fn () => $this->inner->closeDates($listing, $nights));
    }

    public function openDates(ChannelListing $listing, Stay $nights, int $minNights): void
    {
        $this->throttle(fn () => $this->inner->openDates($listing, $nights, $minNights));
    }

    public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable
    {
        $this->throttle(fn () => null);                                  // counts the first page; polls are rare
        return $this->inner->reservationsUpdatedSince($listing, $since);
    }

    private function throttle(Closure $call): void
    {
        $key = "channel-api:{$this->channel}";

        if (RateLimiter::attempt($key, $this->perMinute, $call, decaySeconds: 60) === false) {
            throw ChannelRateLimited::wait($this->channel, RateLimiter::availableIn($key));
        }
    }
}`,
        },
        {
          title: 'The push sends the property’s minimum',
          path: 'app/Jobs/PushAvailability.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Channels\AvailabilityRuns;
use App\Channels\ChannelManager;
use App\Channels\ChannelRateLimited;
use App\Models\ChannelListing;
use App\Models\Property;
use DateTimeInterface;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Throwable;

class PushAvailability implements ShouldQueue, ShouldBeUniqueUntilProcessing
{
    use Queueable;

    public const DAYS = 365;

    public int $uniqueFor = 900;                                       // a stuck lock frees itself after 15 minutes

    public function __construct(public ChannelListing $listing)
    {
        $this->onQueue('channels');                                     // never in front of guest emails again
    }

    /** Dispatch one push per listing of the property, after the current transaction commits. */
    public static function forProperty(Property $property): void
    {
        foreach ($property->channelListings as $listing) {
            self::dispatch($listing)->afterCommit();
        }
    }

    public function uniqueId(): string
    {
        return (string) $this->listing->id;                             // one waiting push per listing
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [(new WithoutOverlapping("push-listing-{$this->listing->id}"))->releaseAfter(30)->expireAfter(600)];
    }

    public function retryUntil(): DateTimeInterface
    {
        return now()->addHours(2);
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return [30, 120, 300, 900];
    }

    public function handle(ChannelManager $channels, AvailabilityRuns $runs): void
    {
        $api = $channels->for($this->listing->channel)->api();
        $property = $this->listing->property;                           // read when the job runs: the newest rules

        try {
            foreach ($runs->for($property, now()->startOfDay(), self::DAYS) as $run) {
                $run['open']
                    ? $api->openDates($this->listing, $run['nights'], $property->min_nights)
                    : $api->closeDates($this->listing, $run['nights']);
            }
        } catch (ChannelRateLimited $e) {
            $this->release($e->retryAfter);                             // scene 16
            return;
        }

        $this->listing->forceFill(['last_pushed_at' => now(), 'last_push_error' => null])->save();
    }

    public function failed(Throwable $exception): void
    {
        $this->listing->forceFill(['last_push_error' => $exception->getMessage()])->save();
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 3: a changed rule is pushed like a changed calendar',
      text: ['The channels must hear about a new minimum as soon as the host saves it, not at the next booking. `CalendarSync` is where every calendar change already goes, so the rule change goes there too:'],
      blocks: [
        {
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

    /** A booking was created, confirmed, imported, cancelled, expired or moved to other dates. */
    public function bookingChanged(Booking $booking): void
    {
        if (in_array($booking->status, BookingStatus::blocking(), true)) {
            $this->recordClashes($booking);
        }

        $this->turnover->forBooking($booking);                          // the cleaning follows the booking

        PushAvailability::forProperty($booking->property);           // every channel learns the new state (scene 17)
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
        },
        {
          path: 'app/Http/Controllers/StayRulesController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Channels\CalendarSync;
use App\Models\Property;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StayRulesController extends Controller
{
    public function __invoke(Request $request, Property $property, CalendarSync $calendar): JsonResponse
    {
        $data = $request->validate(['min_nights' => ['required', 'integer', 'min:1', 'max:30']]);

        $property->forceFill(['min_nights' => $data['min_nights']])->save();
        $calendar->stayRulesChanged($property);                                // every channel gets the new minimum

        return response()->json(['min_nights' => $property->min_nights]);
    }
}`,
          after: [
            'Erik’s one-night booking stays: the guest has a confirmed reservation. Support tells Erik, who can offer the guest a longer stay or leave it. From now on every channel refuses stays shorter than three nights at his cabin, because the channel itself checks.',
          ],
        },
      ],
    },
  ],
  tests: {
    summary: 'What each channel receives, a rule change that is pushed at once, and both of our own doors',
    blocks: [
      {
        path: 'tests/Feature/MinimumStayTest.php',
        code: String.raw`<?php

use App\Channels\AvailabilityRuns;
use App\Channels\ChannelManager;
use App\Enums\Channel;
use App\Jobs\PushAvailability;
use App\Models\Booking;
use App\Models\ChannelListing;
use App\Models\Property;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->cabin = Property::factory()->create(['name' => 'Rørvig cabin']);
    $this->cabin->forceFill(['min_nights' => 3])->save();
    $this->host = hostOf($this->cabin);
});

it('sends the minimum stay to Booking.com with every open run', function () {
    config(['services.booking_com' => ['base_url' => 'https://booking.test', 'username' => 'u', 'password' => 'p', 'webhook_secret' => 's']]);
    $listing = ChannelListing::forceCreate(['property_id' => $this->cabin->id, 'channel' => Channel::BookingCom, 'external_listing_id' => '8812345']);
    Http::fake(['booking.test/*' => Http::response('<ok/>')]);

    (new PushAvailability($listing))->handle(app(ChannelManager::class), app(AvailabilityRuns::class));

    Http::assertSent(fn (Request $request): bool => str_contains($request->body(), '<closed>0</closed><min_stay_arrival>3</min_stay_arrival>'));
});

it('pushes to the channels as soon as the host changes the minimum', function () {
    Queue::fake();
    ChannelListing::forceCreate(['property_id' => $this->cabin->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);

    $this->actingAs($this->host)
        ->patchJson("/api/v1/properties/{$this->cabin->id}/stay-rules", ['min_nights' => 4])
        ->assertOk();

    Queue::assertPushed(PushAvailability::class);
});

it('refuses a one-night booking on our own site', function () {
    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->cabin->id}/bookings", [
            'check_in' => '2027-07-10', 'check_out' => '2027-07-11', 'guests' => 2,
            'guest_name' => 'Søren', 'guest_email' => 'soren@example.com', 'contact_channel' => 'email',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['check_out' => 'This property takes stays of 3 nights or more.']);
});

it('refuses a date change that shortens a stay below the minimum', function () {
    $booking = Booking::factory()->for($this->cabin)->forStay('2027-07-09', 3)->create();

    $this->actingAs($this->host)
        ->patchJson("/api/v1/bookings/{$booking->id}/dates", ['check_in' => '2027-07-10', 'check_out' => '2027-07-11'])
        ->assertUnprocessable();

    expect($booking->fresh()->stay->nights())->toBe(3);                            // the incident’s second door
});`,
      },
      {
        path: 'tests/Unit/ThrottledChannelApiTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Channels\ChannelApi;
use App\Channels\ChannelRateLimited;
use App\Channels\ThrottledChannelApi;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;

it('stops calling at the limit and says how long to wait', function () {
    $inner = new class implements ChannelApi {
        public int $calls = 0;

        public function closeDates(ChannelListing $listing, Stay $nights): void
        {
            $this->calls++;
        }

        public function openDates(ChannelListing $listing, Stay $nights, int $minNights): void
        {
        }

        public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable
        {
            return [];
        }
    };
    $api = new ThrottledChannelApi($inner, 'airbnb', perMinute: 2);
    $nights = Stay::fromDates('2027-07-10', '2027-07-13');

    $api->closeDates(new ChannelListing(), $nights);
    $api->closeDates(new ChannelListing(), $nights);

    expect(fn () => $api->closeDates(new ChannelListing(), $nights))->toThrow(ChannelRateLimited::class)
        ->and($inner->calls)->toBe(2);                                   // the third call never reached the channel
});`,
        after: ['Scene 16’s test fake implements `ChannelApi` too, so it takes the new argument; PHP would refuse to load it otherwise, and the whole suite would stop.'],
      },
    ],
  },
  next: 'Every door knows the minimum now, and every channel enforces it. Next, a host who wanted five nights over Christmas finds that nobody can book two nights in July.',
};
