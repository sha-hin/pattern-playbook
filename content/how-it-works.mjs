// "How the fix works": one Before/After picture per scene and per follow-up, shown before the fix is explained.
// Each picture is up to three lanes of steps, left to right. Keys: the scene number, or "scene:followup-id".
// Step kinds: n plain, x the broken step, v the fix, v2 a result of the fix, i waiting or an interface.

const WIDTH = 292, LEFT = 4, GAP = 24, HEIGHT = 30;
const ROWS = { 1: [62], 2: [34, 102], 3: [20, 74, 128] };

/** @param lanes list of { label?, steps: [text, kind][] } @param foot optional closing line: [text, 'x' | 'v'] */
function picture(lanes, foot) {
  const ys = ROWS[lanes.length];
  const out = [];
  lanes.forEach((lane, i) => {
    const y = ys[i], n = lane.steps.length;
    const room = WIDTH - GAP * (n - 1);
    const weights = lane.steps.map(([text]) => Math.max(text.length, 7));   // longer labels get wider boxes
    const total = weights.reduce((sum, v) => sum + v, 0);
    if (lane.label) out.push(['t', LEFT + 2, y - 6, lane.label, 's']);
    let x = LEFT;
    lane.steps.forEach(([text, kind = 'n'], j) => {
      const w = room * weights[j] / total;
      out.push(['b', x, y, w, HEIGHT, text, kind]);
      if (j > 0) {
        const arrow = kind === 'x' ? 'x' : kind === 'v' || kind === 'v2' ? 'k' : kind === 'i' ? 'd' : 'n';
        out.push(['a', x - GAP + 1, y + HEIGHT / 2, x - 2, y + HEIGHT / 2, '', arrow]);
      }
      x += w + GAP;
    });
  });
  if (foot) out.push(['t', 150, lanes.length === 3 ? 162 : 156, foot[0], foot[1] === 'x' ? 'kx' : 'kv', 'middle']);
  return out;
}

const how = (bad, good, badCaption, goodCaption) => ({ bad, good, badCaption, goodCaption });

export default {
  1: how(
    picture([{ label: '€150.10 a night, as a float', steps: [['150.1 (binary)'], ['× 3 nights'], ['450.2999… → 450.29', 'x']] }], ['one cent lost per booking', 'x']),
    picture([{ label: '€150.10 a night, in cents', steps: [['15010 cents', 'v'], ['× 3 nights'], ['45030 = €450.30', 'v2']] }], ['integers are exact', 'v']),
    'A float can’t hold 0.10 exactly, so the total lands a hair under, and rounding drops a cent.',
    'Money is an integer number of cents with its currency: the multiplication is exact.',
  ),
  2: how(
    picture([{ label: 'moments, with times', steps: [['1 Jul 15:00'], ['5 Jul 11:00'], ['3.83 days → 3', 'x']] }], ['billed for 3 nights', 'x']),
    picture([{ label: 'calendar dates', steps: [['1 July', 'v'], ['5 July', 'v'], ['4 nights', 'v2']] }], ['nights = days between the dates', 'v']),
    'Once check-in and check-out carried times, the difference was 3.83 days, cut to 3.',
    'A stay is two dates; nights are the days between them. Times only matter for messages.',
  ),
  3: how(
    picture([{ label: 'one controller method', steps: [['validate, check, save, reply', 'x']] }, { steps: [['taken nights'], ['500 error', 'x']] }]),
    picture([{ label: 'each part has a home', steps: [['Form Request', 'v'], ['Policy', 'v'], ['action', 'v'], ['Resource', 'v']] }, { steps: [['taken nights'], ['409, a clear message', 'v2']] }]),
    'Everything in one method: no permission check, and a taken night becomes a 500.',
    'Validation, permission, the decision and the answer each in one class; errors become the right status.',
  ),
  4: undefined,                                                    // drawn in the scene file
  5: how(
    picture([{ label: 'inside the class', steps: [['new StripeClient()', 'x'], ['.env: live key'], ['live Stripe', 'x']] }], ['tests can’t swap it', 'x']),
    picture([{ label: 'in tests', steps: [['class asks for it'], ['container', 'v'], ['fake gateway', 'v2']] }, { label: 'in production', steps: [['class asks for it'], ['container', 'v'], ['Stripe', 'v2']] }]),
    'The class builds its own client from the config, so a test run uses whatever key the laptop has.',
    'The class asks for a client in its constructor; the container decides which one, and tests bind a fake.',
  ),
  6: how(
    picture([{ label: 'card payment', steps: [['return page'], ['confirm + email']] }, { label: 'bank transfer', steps: [['Mark as paid'], ['status only', 'x']] }], ['no payment, no email', 'x']),
    picture([{ label: 'card payment', steps: [['return page'], ['BookingConfirmation', 'v']] }, { label: 'bank transfer', steps: [['Mark as paid'], ['BookingConfirmation', 'v']] }], ['payment, status, email: every time', 'v']),
    'Each door did its own subset of confirming, and the manual one skipped the payment and the email.',
    'Every door calls one confirmation, which always does every step.',
  ),
  7: how(
    picture([{ label: 'price page', steps: [['its own sum'], ['€1,098.90']] }, { label: 'checkout', steps: [['its own sum'], ['€1,105.50', 'x']] }], ['two calculations, two prices', 'x']),
    picture([{ label: 'price page', steps: [['QuoteBuilder', 'v'], ['one Quote', 'v2'], ['shown']] }, { label: 'checkout', steps: [['the same Quote', 'v2'], ['charged']] }], ['what is shown is what is charged', 'v']),
    'The page and the checkout each added up the price; the page took the weekly discount off the cleaning fee too.',
    'One builder makes one quote with line items; the page shows it and the checkout charges it.',
  ),
  8: how(
    picture([{ label: 'normal', steps: [['pays'], ['comes back'], ['confirmed']] }, { label: 'phone loses signal', steps: [['pays'], ['never comes back', 'x'], ['still pending', 'x']] }]),
    picture([{ label: 'Stripe tells us, whatever the browser does', steps: [['webhook'], ['verify, store, 200', 'v'], ['job confirms', 'v2']] }], ['a repeat is ignored by event id', 'v']),
    'The booking was confirmed on the page the browser returns to, so a lost connection meant no confirmation.',
    'Stripe’s webhook confirms it: verified, stored, answered at once, processed in a job.',
  ),
  9: how(
    picture([{ label: 'hold expired at 14:27', steps: [['payment 14:29'], ['confirm?'], ['fails 5 times', 'x']] }, { label: 'expiry', steps: [['only when opened', 'x']] }]),
    picture([{ label: 'the scheduler', steps: [['every minute'], ['expire holds', 'v']] }, { label: 'a late payment', steps: [['Expired state', 'v'], ['refund it', 'v2']] }]),
    'Nothing knew what a payment for an expired booking means, and holds expired only when someone looked.',
    'Each state says what it allows: an expired booking refunds a late payment. Holds expire on a schedule.',
  ),
  10: how(
    picture([{ steps: [['cancel'], ['property’s policy now: flexible'], ['100% back', 'x']] }], ['the host’s later change applied', 'x']),
    picture([{ steps: [['cancel'], ['the booking’s policy: strict', 'v'], ['0% back', 'v2']] }], ['the terms she booked under', 'v']),
    'The refund read the property’s current policy, changed after she booked.',
    'Each booking stores the policy it was sold under, as a class that computes the refund.',
  ),
  11: how(
    picture([{ label: 'Stripe', steps: [['1,900 refunds']] }, { label: 'our table', steps: [['1,899 refunds']] }], ['nobody compares: €40 unexplained', 'x']),
    picture([{ label: 'Stripe, page by page', steps: [['iterator'], ['compare', 'v'], ['difference', 'v2']] }, { label: 'our rows, lazily', steps: [['lazyById()'], ['compare', 'v']] }], ['every night, automatically', 'v']),
    'A refund made in Stripe’s dashboard never reached our table, and nothing compared the two.',
    'A nightly job streams both sides through a generator and reports each difference.',
  ),
  12: how(
    picture([{ steps: [['delete all blocks', 'x'], ['download (hangs)', 'x'], ['no blocks for 15 min', 'x']] }], ['a direct booking slips in', 'x']),
    picture([{ steps: [['download + parse', 'v'], ['one transaction', 'v'], ['blocks replaced', 'v2']] }], ['a failed download changes nothing', 'v']),
    'Old blocks were deleted first; when the download hung, the cabin looked free.',
    'Download and parse first, then replace the blocks in one transaction, only for that source.',
  ),
  13: how(
    picture([{ steps: [['if airbnb … elseif …', 'x'], ['copy per action', 'x']] }, { label: 'after an hour', steps: [['token expired'], ['401, every call', 'x']] }]),
    picture([{ steps: [['CalendarSync'], ['ChannelApi', 'i'], ['Airbnb adapter', 'v']] }, { steps: [['token expiring'], ['refresh under a lock', 'v'], ['calls go on', 'v2']] }]),
    'Channel code was copied into every action, and the token was never refreshed.',
    'One interface, an adapter per channel picked by a Manager; tokens are refreshed before they expire.',
  ),
  14: how(
    picture([{ steps: [['Booking.com webhook'], ['verifier with Airbnb’s secret', 'x'], ['401', 'x']] }], ['14 reservations lost', 'x']),
    picture([{ steps: [['Booking.com kit', 'v'], ['client · verifier · mapper', 'v2']] }, { steps: [['one config', 'v'], ['all three built from it', 'v2']] }]),
    'Each part was built separately, and one copied line gave Booking.com’s verifier Airbnb’s secret.',
    'One kit per channel builds its client, verifier and mapper together, from that channel’s own config.',
  ),
  15: how(
    picture([{ steps: [['cancel (v2) 17:02'], ['booking (v1) 17:03'], ['saved: confirmed', 'x']] }], ['the last to arrive wins', 'x']),
    picture([{ steps: [['cancel (v2) 17:02'], ['booking (v1) 17:03'], ['older: ignored', 'v']] }], ['the newest version wins', 'v']),
    'The import saved whatever arrived last, and a retry delivered the original booking after its cancellation.',
    'Each reservation keeps the channel’s version; under a lock, an older one is ignored.',
  ),
  16: how(
    picture([{ steps: [['3 workers'], ['retry every error', 'x'], ['40× the limit', 'x']] }], ['Airbnb blocks the app key', 'x']),
    picture([{ steps: [['shared Redis limit', 'v'], ['429: wait Retry-After', 'v'], ['within the limit', 'v2']] }], ['retry only what can succeed', 'v']),
    'Every worker retried everything at full speed, together.',
    'All workers share one rate limit in Redis, honour 429 and Retry-After, and retry only real blips.',
  ),
  17: how(
    picture([{ steps: [['321 imports'], ['642 pushes', 'x'], ['emails wait', 'x']] }], ['one push per change, on the default queue', 'x']),
    picture([{ steps: [['321 imports'], ['1 push per listing', 'v'], ['channels queue', 'v2']] }], ['the full state, coalesced', 'v']),
    'Every change queued its own push, in front of guest emails.',
    'A unique job per listing sends the whole calendar state; a burst becomes one push, on its own queue.',
  ),
  18: how(
    picture([{ label: 'Airbnb', steps: [['booking 22:10'], ['push 40 s later']] }, { label: 'Booking.com', steps: [['sells it 22:10'], ['nobody warned', 'x']] }]),
    picture([{ steps: [['any calendar change'], ['CalendarSync', 'v'], ['clash recorded', 'v2']] }, { steps: [['host told once', 'v2'], ['every channel updated', 'v2']] }]),
    'Two channels can sell the same night within seconds; nothing looked for the clash.',
    'Every change goes through one coordinator, which records a clash, tells the host and updates the channels.',
  ),
  19: how(
    picture([{ steps: [['/bookings/813'], ['Booking::find(813)', 'x'], ['another host’s booking', 'x']] }]),
    picture([{ steps: [['/bookings/813'], ['$account->bookings()', 'v'], ['404', 'v2']] }], ['another account’s ids don’t exist', 'v']),
    'The lookup found any booking by its number.',
    'Every query starts from the current account; anything else is a 404.',
  ),
  20: how(
    picture([{ label: 'cleaner', steps: [['opens a booking'], ['sees €1,105', 'x']] }, { label: 'co-host', steps: [['owner’s password', 'x']] }]),
    picture([{ label: 'cleaner', steps: [['opens a booking'], ['policy: role', 'v'], ['tasks only', 'v2']] }, { label: 'co-host', steps: [['signed invitation', 'v'], ['own login', 'v2']] }]),
    'Every member saw everything, and people shared one login.',
    'Policies decide by role; members join with their own login through an invitation.',
  ),
  21: how(
    picture([{ steps: [['1 day before, 15:00'], ['in UTC', 'x'], ['03:04 in Queenstown', 'x']] }]),
    picture([{ steps: [['1 day before, 15:00'], ['property’s timezone', 'v'], ['15:00 local', 'v2']] }], ['stored in UTC, computed locally', 'v']),
    'The send time was built in UTC, which is 3 a.m. in New Zealand.',
    'The local time is computed in the property’s timezone, then stored in UTC; DST is tested.',
  ),
  22: how(
    picture([{ label: 'worker A', steps: [['reads pending'], ['sends', 'x']] }, { label: 'worker B', steps: [['reads pending'], ['sends', 'x']] }], ['the door code, twice', 'x']),
    picture([{ label: 'worker A', steps: [['UPDATE … WHERE pending', 'v'], ['1 row: sends', 'v2']] }, { label: 'worker B', steps: [['UPDATE … WHERE pending', 'v'], ['0 rows: stops', 'v2']] }]),
    'Two workers both saw the message as pending and both sent it.',
    'Sending starts with one conditional update; only the worker that changed the row sends.',
  ),
  23: how(
    picture([{ steps: [['5 nights saved'], ['charge €300'], ['declined: half changed', 'x']] }]),
    picture([{ steps: [['snapshot', 'v'], ['change + charge'], ['declined: restore', 'v2']] }], ['3 nights, old total, old messages', 'v']),
    'The booking was changed before the payment, and nothing undid it when the card was declined.',
    'A snapshot is taken first and restored exactly, with the messages, if the payment fails.',
  ),
  24: how(
    picture([{ steps: [['{guestname}'], ['sent as is', 'x']] }, { steps: [['a name with a link'], ['a link in the email', 'x']] }]),
    picture([{ steps: [['{guestname}'], ['refused on save', 'v']] }, { steps: [['a name with a link'], ['escaped: plain text', 'v2']] }]),
    'Variables were never checked, and guests’ names were treated as Markdown.',
    'Templates are checked against a fixed list when saved; values are escaped; door codes only near arrival.',
  ),
  25: how(
    picture([{ label: 'the guest chose SMS', steps: [['GuestMessage'], ['always mail', 'x']] }], ['the choice is saved, nothing reads it', 'x']),
    picture([
      { label: 'one notification', steps: [['GuestMessage'], ['via(): guest’s choice', 'v']] },
      { label: 'picks one channel', steps: [['mail · SMS · WhatsApp', 'v2']] },
    ], ['one message, any channel', 'v']),
    'The notification only knew one way of delivering.',
    'The message says what; each channel class knows how to deliver it; the guest’s choice picks one.',
  ),
  26: how(
    picture([{ steps: [['stay extended'], ['task: 14 July', 'x'], ['cleaner walks in', 'x']] }]),
    picture([{ steps: [['stay extended'], ['CalendarSync', 'v'], ['task: 15 July', 'v2']] }], ['every date change moves the task', 'v']),
    'The cleaning task was created once, at confirmation, and date changes skipped it.',
    'Date changes go through the calendar coordinator, which plans the cleaning again.',
  ),
  27: how(
    picture([{ label: 'a July Saturday', steps: [['season: €180'], ['return', 'x'], ['weekend rule skipped', 'x']] }]),
    picture([{ label: 'a July Saturday', steps: [['base: season €180', 'v'], ['+20% weekend', 'v'], ['€216', 'v2']] }], ['base first, then adjustments', 'v']),
    'Inside a season the code returned the season price before the weekend rule ran.',
    'Each night: choose the base price, then apply every adjustment to it.',
  ),
  28: how(
    picture([{ steps: [['replicate()'], ['same rate_plan_id', 'x'], ['both prices change', 'x']] }]),
    picture([{ steps: [['replicate()'], ['its own rate plan', 'v'], ['its own prices', 'v2']] }]),
    'The copy kept the original’s rate plan, so lowering one lowered both.',
    'Duplicating gives the copy its own plan; what a copy may share is decided, not inherited.',
  ),
  29: how(
    picture([{ label: 'our form', steps: [['3-night rule'], ['refuses 1 night']] }, { label: 'Booking.com, date change', steps: [['no rule', 'x'], ['1 night sold', 'x']] }]),
    picture([{ steps: [['rule on the property', 'v'], ['form + date change', 'v2']] }, { steps: [['pushed with availability', 'v'], ['channels enforce it', 'v2']] }]),
    'The minimum lived only in the website’s form.',
    'One rule check for every booking path, and the minimum is sent to the channels.',
  ),
  30: how(
    picture([{ steps: [['min_nights = 5'], ['pushed for 365 nights', 'x'], ['July: 5 nights', 'x']] }]),
    picture([{ steps: [['19 Dec–2 Jan: 5', 'v'], ['other dates: 2', 'v2'], ['pushed per run', 'v2']] }], ['a rule for some dates only', 'v']),
    'One number per property, and since scene 29 it is pushed for every night of the year.',
    'Date rules live in calendar_days; dates without one use the default, and each run is pushed with its minimum.',
  ),
  31: how(
    picture([{ label: 'search', steps: [['confirmed only'], ['free']] }, { label: 'booking', steps: [['+ pending holds'], ['taken', 'x']] }], ['two rules, two answers', 'x']),
    picture([{ steps: [['one scope: availableFor()', 'v'], ['search', 'v2'], ['booking', 'v2']] }], ['one rule, one answer', 'v']),
    'Search wrote its own overlap query and ignored holds.',
    'One availability rule as one scope, used by search, booking, date changes and moves.',
  ),
  32: how(
    picture([{ label: 'our site', steps: [['booking'], ['broadcast']] }, { label: 'Airbnb import', steps: [['booking'], ['no broadcast', 'x']] }]),
    picture([{ steps: [['any calendar change'], ['CalendarSync', 'v'], ['after commit', 'v']] }, { steps: [['account channel', 'v2'], ['page reloads its data', 'v2']] }]),
    'Only the website’s controller broadcast, and before the commit.',
    'The coordinator broadcasts after commit, only an id; the page fetches the truth from the API.',
  ),
  33: how(
    picture([{ label: 'Sofie', steps: [['page loaded once'], ['answers 15:00', 'x']] }, { label: 'Emil', steps: [['page loaded once'], ['answers 12:00', 'x']] }]),
    picture([{ steps: [['presence: Emil is here', 'v'], ['“Emil is typing…”', 'v2']] }, { steps: [['reply missed a newer one'], ['409, shown first', 'v']] }]),
    'Nobody could see a teammate in the conversation, and the server took both answers.',
    'A presence channel shows who is here and typing; the server refuses a reply that missed a newer one.',
  ),
  34: how(
    picture([{ steps: [['140 properties'], ['4 queries each', 'x'], ['561 queries', 'x']] }]),
    picture([{ steps: [['with() + withCount()', 'v'], ['a few queries', 'v2'], ['80 ms', 'v2']] }], ['the same queries for 3 or 3,000', 'v']),
    'The resource ran four queries for every property.',
    'Relations and counts are loaded for all properties at once.',
  ),
  35: how(
    picture([{ steps: [['€220 at 09:00'], ['cache: €180 for 1 h', 'x'], ['guests pay €180', 'x']] }]),
    picture([{ steps: [['price change'], ['version bump', 'v'], ['new key: €220', 'v2']] }], ['the price paid is never cached', 'v']),
    'The rates were cached for an hour and nothing cleared them on a change.',
    'A caching proxy keys entries by a price version, bumped after commit; bookings read the database.',
  ),
  '35:eviction': how(
    picture([{ steps: [['one Redis, allkeys-lru'], ['memory full'], ['evicts sessions, jobs', 'x']] }], ['and the price versions', 'x']),
    picture([{ label: 'may forget', steps: [['cache Redis', 'v'], ['allkeys-lru']] }, { label: 'must not', steps: [['data Redis', 'v'], ['noeviction', 'v2']] }]),
    'Cache, sessions, queues and counters shared one Redis that deletes the least recently used key.',
    'Two instances: the cache may evict; queues, sessions, locks and price versions never are.',
  ),
  36: how(
    picture([{ steps: [['commit booking'], ['queue dispatch', 'x'], ['Redis down: lost', 'x']] }]),
    picture([{ steps: [['booking + outbox row', 'v'], ['relay job', 'v'], ['partner', 'v2']] }], ['written in one transaction', 'v']),
    'The message was sent after the commit; when that failed, it was gone.',
    'The message is written with the booking, in the same transaction; a relay delivers it, at least once.',
  ),
  37: how(
    picture([{ label: 'first try', steps: [['POST book'], ['booked'], ['response lost']] }, { label: 'retry', steps: [['POST book'], ['nights taken', 'x']] }]),
    picture([{ label: 'first try', steps: [['POST + key'], ['booked'], ['response stored', 'v']] }, { label: 'retry, same key', steps: [['middleware', 'v'], ['same response', 'v2']] }]),
    'The retry was a new request, and it found the nights taken by itself.',
    'An Idempotency-Key middleware replays the stored response to a retry with the same key.',
  ),
  38: undefined,                                                   // drawn in the scene file
  39: how(
    picture([{ steps: [['token: [*], no expiry', 'x'], ['cancel × 14'], ['all allowed', 'x']] }]),
    picture([{ steps: [['token: bookings:read', 'v'], ['cancel'], ['403', 'v2']] }], ['abilities, expiry, one account, a budget', 'v']),
    'A host’s token could do everything the host could, forever, as fast as it liked.',
    'Integration tokens carry abilities checked per route, an expiry, one account and their own rate limit.',
  ),
  40: how(
    picture([{ steps: [['tax export, copied'], ['no account scope', 'x'], ['other hosts’ rows', 'x']] }]),
    picture([{ steps: [['AccountExport', 'v'], ['scope + chunks', 'v'], ['tax · payouts · …', 'v2']] }], ['no export can skip the scope', 'v']),
    'The copy started from another table and lost the account scope.',
    'A base export always scopes and chunks; each export only says which rows and columns.',
  ),
  41: how(
    picture([{ steps: [['every event'], ['updateOrCreate', 'x'], ['3,100 feeds: queue grows', 'x']] }]),
    picture([{ steps: [['diff in memory', 'v'], ['1 upsert + 1 delete', 'v'], ['only changes', 'v2']] }], ['most syncs write nothing', 'v']),
    'Each sync wrote row by row, whether anything changed or not.',
    'Changes are worked out in memory and written once: one upsert, one delete.',
  ),
  '41:deadlocks': how(
    picture([{ label: 'Airbnb feed', steps: [['upsert'], ['gap lock']] }, { label: 'Booking.com feed', steps: [['upsert'], ['gap lock', 'x']] }], ['same cottage, same second: deadlock', 'x']),
    picture([{ label: 'Airbnb feed', steps: [['lock: property 412', 'v'], ['upsert, commit']] }, { label: 'Booking.com feed', steps: [['waits 10 s', 'i'], ['upsert, commit', 'v2']] }]),
    'Two feeds of one property wrote the same index at once, each holding a gap the other needed.',
    'One sync per property at a time; the second waits seconds instead of deadlocking.',
  ),
  42: how(
    picture([{ steps: [['every search'], ['primary'], ['full table scan', 'x']] }], ['8.2 s at p99', 'x']),
    picture([{ steps: [['every search'], ['replica', 'v'], ['composite index', 'v']] }], ['bookings still decide on the primary', 'v']),
    'Searches read all 21,000 properties, on the database that takes bookings.',
    'An index answers the query; searches read a replica, decisions stay on the primary.',
  ),
  '42:stampede': how(
    picture([{ steps: [['key expires 21:00'], ['1,000 requests miss', 'x'], ['1,000 computations', 'x']] }]),
    picture([{ steps: [['5 min: fresh'], ['to 15 min: stale served', 'v'], ['one refresh', 'v2']] }], ['Cache::flexible()', 'v']),
    'Every request that missed while the value was being rebuilt rebuilt it too.',
    'The old value is served while one request refreshes it after its response.',
  ),
  '42:cdn': how(
    picture([{ steps: [['every guest'], ['nginx, PHP, MySQL', 'x'], ['the same answer', 'x']] }], ['71% of the load', 'x']),
    picture([{ steps: [['guest'], ['CDN copy (ETag)', 'v'], ['origin on a miss', 'v2']] }, { steps: [['host edits'], ['purge that URL', 'v']] }]),
    'Pages that are the same for everyone were built again for every guest.',
    'Public pages carry cache headers; the CDN keeps them, and an edit purges the copy.',
  ),
  43: how(
    picture([{ steps: [['controller'], ['Meilisearch'], ['restarting: 500', 'x']] }]),
    picture([{ steps: [['PropertyRepository', 'i'], ['Meilisearch', 'v2']] }, { label: 'when it fails', steps: [['the same interface', 'i'], ['MySQL search', 'v']] }]),
    'The controller called the search engine directly, with nothing to fall back on.',
    'One search interface with two implementations; when the engine fails, MySQL answers.',
  ),
  '43:reindex': how(
    picture([{ steps: [['flush the live index', 'x'], ['import 40 min'], ['half the cottages', 'x']] }]),
    picture([{ steps: [['build properties_next', 'v'], ['swap, atomic', 'v'], ['always complete', 'v2']] }]),
    'The index that searches were reading was emptied and refilled.',
    'The new index is built next to the live one, then the two swap in one step.',
  ),
  44: how(
    picture([{ steps: [['report on primary 25 min'], ['ALTER waits'], ['1,400 queries wait', 'x']] }]),
    picture([{ steps: [['report on replica', 'v'], ['ALTER: lock_wait 5 s', 'v'], ['gives up, retries', 'v2']] }], ['never queue the site behind a migration', 'v']),
    'The ALTER needed a lock a long report held, and every booking query queued behind the ALTER.',
    'Reports run off the primary, and a migration gives up after 5 seconds instead of blocking everyone.',
  ),
  '44:archiving': how(
    picture([{ steps: [['one DELETE: 31M rows', 'x'], ['52 min transaction'], ['replica 40 min behind', 'x']] }]),
    picture([{ steps: [['MassPrunable', 'v'], ['1,000 at a time', 'v'], ['replica keeps up', 'v2']] }], ['90 days, every night', 'v']),
    'One huge transaction had to be replayed on the replica in one piece.',
    'A retention rule deletes small batches every night; each is milliseconds on both servers.',
  ),
  45: how(
    picture([{ label: 'web servers', steps: [['deploy 14:00'], ['new code']] }, { label: 'queue workers', steps: [['still running'], ['old code until 16:00', 'x']] }]),
    picture([{ steps: [['deploy'], ['switch release', 'v'], ['horizon:terminate', 'v']] }, { steps: [['workers restart', 'v2'], ['new code', 'v2']] }]),
    'Long-running workers kept the code they started with.',
    'The deploy switches releases atomically and restarts every long-running process.',
  ),
  '45:reverb-scaling': how(
    picture([{ label: 'server A', steps: [['worker'], ['Reverb A'], ['A’s browsers only', 'x']] }, { label: 'server B', steps: [['Reverb B'], ['hears nothing', 'x']] }]),
    picture([{ steps: [['Reverb A'], ['Redis pub/sub', 'v'], ['Reverb B', 'v2']] }], ['every server delivers every event', 'v']),
    'Each Reverb only knew its own connections.',
    'With scaling on, each broadcast goes through Redis to every Reverb server.',
  ),
  46: how(
    picture([{ steps: [['every job'], ['static array keeps models', 'x'], ['memory → killed', 'x']] }]),
    picture([{ steps: [['no state between jobs', 'v'], ['maxJobs / maxTime', 'v'], ['memory flat', 'v2']] }], ['and an alert on queue wait', 'v']),
    'A static array kept every model the worker had ever loaded.',
    'Workers keep nothing between jobs, restart on a schedule, and queue wait times are alerted on.',
  ),
};
