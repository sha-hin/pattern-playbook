// Scene 24 · Template variables: replaced, escaped, and sensitive ones only when it is safe. No new pattern.

export default {
  description: 'Guests received “Hi {guest_name},” and a door code three weeks early, and a guest name turned into a link inside the email. Fix template variables in Laravel: a fixed list checked when the template is saved, values escaped after the Markdown is rendered, and the door code encrypted and only revealed close to check-in.',
  incident: {
    channel: '#support',
    when: 'Monday 10:00',
    messages: [
      ['Mona · support', 'Three things from this weekend. Welcome emails start with “Hi {guest_name},”. A host’s template uses `{guestname}`, which shows up as is. And a confirmation sent **three weeks** before arrival contains the door code.'],
      ['Sara · tech lead', 'And one I found myself: a Booking.com guest named himself `[Claim your refund](https://evil.example)`, and in his welcome email his name is a link.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Notifications/GuestMessage.php (before)',
          broken: true, fragment: true,
          code: String.raw`public function toMail(object $notifiable): MailMessage
{
    $body = str_replace(
        ['{guest}', '{door_code}'],                                   // the names someone remembered
        [$booking->guest_name, $booking->door_code],                  // the door code, whenever the message is sent
        $this->message->template->body,
    );

    return (new MailMessage())->markdown('mail.guest', ['body' => $body]);   // the guest's name is now Markdown
}`,
          after: [
            '**Unknown names** stay in the text, because nothing ever said which names exist. **Sensitive values** go out with any message that mentions them, whenever it is sent. And the values are pasted **into Markdown before it is rendered**, so whatever a guest types as their name becomes part of the email’s markup: here a link, elsewhere bold text or an image.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: a fixed list, checked when the template is saved',
      text: [
        'A host finds a typo best at the moment they type it, not when a guest receives it. The list of variables is defined once; saving a template with any other `{name}` is a 422 with the name in the error.',
        'The door code has a second rule: it may only appear in messages sent **at most two days before check-in**, so a template sent on confirmation can’t contain it at all.',
      ],
      blocks: [
        {
          path: 'app/Messaging/TemplateVariables.php',
          code: String.raw`<?php

namespace App\Messaging;

final class TemplateVariables
{
    public const NAMES = ['guest_name', 'property_name', 'check_in', 'check_out', 'check_in_time', 'door_code'];

    /** Variables that are only filled in close to arrival. */
    public const SENSITIVE = ['door_code'];

    public const SENSITIVE_HOURS_BEFORE_CHECK_IN = 48;

    /** @return list<string> every {name} in the text */
    public static function in(string $text): array
    {
        preg_match_all('/\{([a-z_]+)\}/', $text, $matches);

        return array_values(array_unique($matches[1]));
    }
}`,
        },
        {
          path: 'app/Http/Requests/StoreMessageTemplateRequest.php',
          code: String.raw`<?php

namespace App\Http\Requests;

use App\Enums\MessageTrigger;
use App\Messaging\TemplateVariables;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreMessageTemplateRequest extends FormRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'trigger' => ['required', Rule::enum(MessageTrigger::class)],
            'days_offset' => ['required', 'integer', 'between:-30,30'],
            'send_time' => ['nullable', 'date_format:H:i'],
            'subject' => ['required', 'string', 'max:150', $this->knownVariables(...)],
            'body' => ['required', 'string', 'max:5000', $this->knownVariables(...), $this->doorCodeOnlyNearArrival(...)],
        ];
    }

    private function knownVariables(string $attribute, mixed $value, Closure $fail): void
    {
        $unknown = array_diff(TemplateVariables::in((string) $value), TemplateVariables::NAMES);

        if ($unknown !== []) {
            $fail('Unknown variable: {' . implode('}, {', $unknown) . '}. Use one of: {' . implode('}, {', TemplateVariables::NAMES) . '}.');
        }
    }

    private function doorCodeOnlyNearArrival(string $attribute, mixed $value, Closure $fail): void
    {
        $usesSecret = array_intersect(TemplateVariables::in((string) $value), TemplateVariables::SENSITIVE) !== [];
        $nearArrival = $this->input('trigger') === MessageTrigger::BeforeCheckIn->value && in_array((int) $this->input('days_offset'), [-2, -1, 0], true);

        if ($usesSecret && ! $nearArrival) {
            $fail('{door_code} can only be used in messages sent at most 2 days before check-in.');
        }
    }
}`,
          after: ['`$this->knownVariables(...)` is PHP’s first-class callable syntax: it passes the method itself as the closure rule.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: the door code is a secret',
      text: ['Stored encrypted, like scene 13’s tokens, hidden from every API response, and filled into a message only if that message is actually being sent within 48 hours of the guest’s check-in moment, whatever the template says. Two independent checks: the template rule above and this one.'],
      blocks: [
        {
          path: 'database/migrations/2026_04_13_000001_add_door_code_to_bookings_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->text('door_code')->nullable();                     // encrypted: a few digits become ~200 characters
        });
    }
};`,
          after: ['`Booking` adds `\'door_code\' => \'encrypted\'` to its casts and `door_code` to `$hidden`.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: escape after rendering',
      text: [
        'The order is what makes it safe. The host’s template is Markdown and is rendered to HTML **first**, with the `{names}` still in it. Only then are the values put in, each escaped for HTML. A value can’t become markup, because by the time it arrives there is no Markdown left to interpret it. SMS (scene 25) gets the same values in plain text.',
      ],
      blocks: [
        {
          path: 'app/Messaging/TemplateRenderer.php',
          code: String.raw`<?php

namespace App\Messaging;

use App\Models\Booking;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use LogicException;

final class TemplateRenderer
{
    /** The host's Markdown as HTML, with every value escaped. */
    public function html(string $template, Booking $booking, CarbonImmutable $sentAt): string
    {
        $html = Str::markdown($template, ['html_input' => 'escape', 'allow_unsafe_links' => false]);   // the host's own markup

        return $this->fill($html, $booking, $sentAt, fn (string $value): string => e($value));         // values: never markup
    }

    /** For SMS and WhatsApp: no markup at all. */
    public function text(string $template, Booking $booking, CarbonImmutable $sentAt): string
    {
        return $this->fill($template, $booking, $sentAt, fn (string $value): string => $value);
    }

    /** @param callable(string): string $escape */
    private function fill(string $text, Booking $booking, CarbonImmutable $sentAt, callable $escape): string
    {
        return preg_replace_callback('/\{([a-z_]+)\}/', fn (array $m): string => $escape($this->value($m[1], $booking, $sentAt)), $text);
    }

    private function value(string $name, Booking $booking, CarbonImmutable $sentAt): string
    {
        $property = $booking->property;

        return match ($name) {
            'guest_name' => $booking->guest_name,
            'property_name' => $property->name,
            'check_in' => $booking->stay->checkIn->format('l j F Y'),
            'check_out' => $booking->stay->checkOut->format('l j F Y'),
            'check_in_time' => substr($property->check_in_time, 0, 5),
            'door_code' => $this->doorCode($booking, $sentAt),
            default => throw new LogicException("Unknown template variable {{$name}}."),   // never sent as text
        };
    }

    private function doorCode(Booking $booking, CarbonImmutable $sentAt): string
    {
        $hoursBefore = $sentAt->diffInHours($booking->stay->checkInAt($booking->property), false);

        if ($hoursBefore > TemplateVariables::SENSITIVE_HOURS_BEFORE_CHECK_IN || $booking->door_code === null) {
            return 'sent to you the day before arrival';           // too early, or not set yet: never the code
        }

        return $booking->door_code;
    }
}`,
        },
        {
          title: 'The message uses it',
          path: 'app/Notifications/GuestMessage.php (toMail, after)',
          fragment: true,
          code: String.raw`public function toMail(object $notifiable): MailMessage
{
    $template = $this->message->template;
    $booking = $this->message->booking;
    $renderer = app(TemplateRenderer::class);

    return (new MailMessage())
        ->subject($renderer->text($template->subject, $booking, now()))               // a subject is plain text
        ->view('mail.guest', ['html' => $renderer->html($template->body, $booking, now())]);
}`,
          after: ['The view prints `{!! $html !!}`: the one place unescaped output is correct, because every value in it was escaped by the renderer. The renderer is resolved from the container inside `toMail()`, so the notification itself stays small enough to queue.'],
        },
      ],
    },
  ],
  tests: {
    summary: 'Unknown names refused on save, values that can’t become markup, and a door code only near arrival',
    blocks: [
      {
        path: 'tests/Feature/TemplateVariablesTest.php',
        code: String.raw`<?php

use App\Messaging\TemplateRenderer;
use App\Models\Booking;
use App\Models\Property;
use Carbon\CarbonImmutable;

it('refuses a template with an unknown variable, naming it', function () {
    $property = Property::factory()->create();

    $this->actingAs(hostOf($property))->postJson('/api/v1/message-templates', [
        'name' => 'Welcome', 'trigger' => 'booking_confirmed', 'days_offset' => 0,
        'subject' => 'Welcome', 'body' => 'Hi {guestname},',
    ])->assertUnprocessable()->assertJsonFragment(['Unknown variable: {guestname}. Use one of: {guest_name}, {property_name}, {check_in}, {check_out}, {check_in_time}, {door_code}.']);
});

it('refuses the door code in a message sent on confirmation', function () {
    $property = Property::factory()->create();

    $this->actingAs(hostOf($property))->postJson('/api/v1/message-templates', [
        'name' => 'Welcome', 'trigger' => 'booking_confirmed', 'days_offset' => 0,
        'subject' => 'Welcome', 'body' => 'Your code: {door_code}',
    ])->assertUnprocessable()->assertJsonValidationErrors('body');
});

it('never turns a guest’s name into markup', function () {
    $booking = Booking::factory()->create(['guest_name' => '[Claim your refund](https://evil.example) <script>x</script>']);

    $html = app(TemplateRenderer::class)->html('Hi **{guest_name}**,', $booking, now());

    expect($html)->not->toContain('<a ')->not->toContain('<script>')
        ->and($html)->toContain('<strong>[Claim your refund](https://evil.example) &lt;script&gt;x&lt;/script&gt;</strong>');
});

it('shows the door code only within 48 hours of check-in', function (string $sentAt, string $shown) {
    // check-in 2027-07-10, 15:00 in Copenhagen = 13:00 UTC
    $booking = Booking::factory()->forStay('2027-07-10', 3)->create(['door_code' => '4711']);

    expect(app(TemplateRenderer::class)->text('Code: {door_code}', $booking, CarbonImmutable::parse($sentAt)))->toBe("Code: {$shown}");
})->with([
    'the day before' => ['2027-07-09 13:00:00', '4711'],
    'three weeks before' => ['2027-06-19 13:00:00', 'sent to you the day before arrival'],
]);`,
        after: ['The template routes are scene 19’s pattern: `POST /api/v1/message-templates` inside the account group, saving with `$account->messageTemplates()->create($request->validated())`.'],
      },
    ],
  },
  next: 'Messages now say the right things. Tuesday: a guest who asked for SMS gets every message by email.',
};
