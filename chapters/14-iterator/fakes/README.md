# Stand-ins for third-party SDKs

These folders stand in for Composer packages so the project runs offline, with no API keys:

- `OpenAI/` has the same call shape as the official `openai-php/client` package:
  `$client->chat()->create([...])->choices[0]->message->content`, and it throws `ErrorException` on API errors.
- `Ollama/` has the shape of Ollama's HTTP API (`POST /api/generate`): an array in, an array out,
  with an `error` key instead of an exception when something goes wrong.

Both "models" answer with the same simple, deterministic rule (`FakeLlm/Model.php`), so the output is
repeatable. In a real project you would `composer require` the SDK and delete these folders;
the adapters in `src/Analysis/` would not change.
