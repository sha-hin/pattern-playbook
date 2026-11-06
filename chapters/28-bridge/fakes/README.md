# Stand-ins for third-party SDKs

These folders stand in for Composer packages so the project runs offline, with no API keys:

- `OpenAI/` has the same call shape as the official `openai-php/client` package:
  `$client->chat()->create([...])->choices[0]->message->content`, and it throws `ErrorException` on API errors.
- `Ollama/` has the shape of Ollama's HTTP API (`POST /api/generate`): an array in, an array out,
  with an `error` key instead of an exception when something goes wrong.
- `Ministry/` stands in for the Ministry of Education's results API (used by the outbox relay).
- `Aws/` has the call shape of the AWS SDK's `S3Client` (`putObject`, `getObject`) and `SqsClient`
  (`sendMessage`, `receiveMessage`, `deleteMessage`), kept in memory.

Both "models" answer with the same simple, deterministic rule (`FakeLlm/Model.php`), so the output is
repeatable. In a real project you would `composer require` the SDK and delete these folders;
the adapters in `src/` would not change.
