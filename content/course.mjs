// The course plan: design patterns first, a vacation-rental PMS (property management system) as the setting.
// Each lesson's content lives in content/lessons/<slug>.mjs; lessons with `ready: true` get a page.

export const PLAN = [
  { n: 0, slug: '00-foundation', patterns: [], title: 'Foundation: everything the course stands on', problem: 'Every table, model, factory and test helper, ready before lesson 1', ready: true },
  { n: 1, slug: '01-value-object', patterns: ['Value Object'], problem: 'Money and stays are passed around as bare numbers', ready: true },
  { n: 2, slug: '02-active-record', patterns: ['Active Record', 'Data Mapper', 'Repository'], problem: 'Where booking logic and SQL belong', ready: true },
  { n: 3, slug: '03-container', patterns: ['Singleton', 'Dependency Injection Container'], problem: 'The Stripe client is created everywhere', ready: true },
  { n: 4, slug: '04-facade', patterns: ['Facade'], problem: '“Confirm a booking” is many steps', ready: true },
  { n: 5, slug: '05-builder', patterns: ['Builder'], problem: 'Quotes with many optional parts' },
  { n: 6, slug: '06-factory', patterns: ['Simple Factory', 'Factory Method'], problem: 'Webhook payloads into typed events; one feed parser per source' },
  { n: 7, slug: '07-abstract-factory', patterns: ['Abstract Factory'], problem: 'Each channel needs a matching client, mapper and verifier' },
  { n: 8, slug: '08-prototype', patterns: ['Prototype'], problem: 'Every turnover gets a copy of the cleaning checklist' },
  { n: 9, slug: '09-adapter', patterns: ['Adapter', 'Manager / Driver'], problem: 'Airbnb and Booking.com behind one interface, picked by name' },
  { n: 10, slug: '10-decorator', patterns: ['Decorator'], problem: 'Retries, rate limits and caching around services' },
  { n: 11, slug: '11-proxy', patterns: ['Proxy'], problem: 'Cleaners must not see payouts; heavy data loads only when needed' },
  { n: 12, slug: '12-composite', patterns: ['Composite'], problem: 'Seasonal rate rules grouped into rate plans' },
  { n: 13, slug: '13-bridge', patterns: ['Bridge'], problem: 'Message types × channels (mail, SMS, WhatsApp)' },
  { n: 14, slug: '14-flyweight', patterns: ['Flyweight'], problem: 'A year of calendar days for thousands of properties' },
  { n: 15, slug: '15-strategy', patterns: ['Strategy', 'Null Object'], problem: 'Cancellation policies; properties without fees' },
  { n: 16, slug: '16-pipeline', patterns: ['Pipeline', 'Chain of Responsibility'], problem: 'Price stages; booking acceptance rules' },
  { n: 17, slug: '17-template-method', patterns: ['Template Method'], problem: 'iCal sync: same steps, different sources' },
  { n: 18, slug: '18-command', patterns: ['Command', 'Command Bus'], problem: 'Channel pushes and emails in the background' },
  { n: 19, slug: '19-iterator', patterns: ['Iterator', 'Generators'], problem: 'Nights, due messages, nightly reconciliation' },
  { n: 20, slug: '20-state', patterns: ['State'], problem: 'Booking pending → confirmed → cancelled / expired' },
  { n: 21, slug: '21-observer', patterns: ['Observer', 'Event Dispatcher'], problem: 'A cancellation must trigger five reactions' },
  { n: 22, slug: '22-mediator', patterns: ['Mediator'], problem: 'Cross-channel double bookings; the guest–host chat' },
  { n: 23, slug: '23-memento', patterns: ['Memento'], problem: 'Dates changed: reschedule, or roll back' },
  { n: 24, slug: '24-interpreter', patterns: ['Interpreter'], problem: 'Variables like {guest_name} and {door_code} in templates' },
  { n: 25, slug: '25-visitor', patterns: ['Visitor'], problem: 'Owner statement, tax report and payouts from one folio' },
  { n: 26, slug: '26-specification', patterns: ['Specification'], problem: '“Free from X to Y, sleeps 6, pets allowed”' },
  { n: 27, slug: '27-unit-of-work', patterns: ['Unit of Work', 'Transactional Outbox'], problem: 'A booking is saved, but its event is lost' },
  { n: 28, slug: '28-all-patterns', patterns: [], title: 'All patterns, together', problem: 'Design systems on a whiteboard; review AI-written code' },
];

// Patterns from the Gang of Four book (1994). Everything else is marked "not in the book".
export const GOF = new Set([
  'Abstract Factory', 'Builder', 'Factory Method', 'Prototype', 'Singleton',
  'Adapter', 'Bridge', 'Composite', 'Decorator', 'Facade', 'Flyweight', 'Proxy',
  'Chain of Responsibility', 'Command', 'Interpreter', 'Iterator', 'Mediator', 'Memento',
  'Observer', 'State', 'Strategy', 'Template Method', 'Visitor',
]);

export const lessonTitle = l => l.title || l.patterns.join(', ');
