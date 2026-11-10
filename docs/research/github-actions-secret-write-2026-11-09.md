# Writing a GitHub Actions secret without ever being able to read it (2026-11-09)

Implements D32's write path (#93) against `fractalsynapse/platfolio`. The point of the exercise is not the
endpoints, it is that **the invariant is testable**: platfolio places a secret, can confirm one exists, and
cannot get the value back — so a retry must rotate, not replay.

## What was verified live

```
presence before write   : missing
write                   : issued
presence after write    : set
GET secret              : 200, fields = name, created_at, updated_at
value present in GET    : false
second write (rotation) : issued, presence = set
remove                  : issued
presence after remove   : missing
```

`GET` returning metadata only is GitHub's behaviour, not our discipline — but the writer's interface has to
match it, so the class exposes **no** `read`/`get`/`list` and a test asserts that shape rather than trusting
the API. A dependency that happens to make theft impossible is not a control.

## Three API details that cost time, all of them base64

1. **The public-key endpoint is scoped to the repository or environment and carries no secret name.**
   `/repos/{o}/{r}/actions/secrets/public-key`. Appending the name yields 404, which reads as missing
   permissions.
2. **The key arrives URL-safe** (`-`, `_`), not the padded standard alphabet.
3. **`encrypted_value` must be standard, padded base64.** libsodium's `to_base64` default emitted URL-safe
   in this build; GitHub rejected it with a 422 whose message quoted the offending string against
   `/^(?:[A-Za-z0-9+/]…)$/`. With the correct variant the same request is `201`. `key_id` is required: without
   it, `422 "key_id" wasn't supplied`.

So one credential, three alphabets, and two different failures (404 and 422) that both *looked* like
authorization problems. The status code that finally explained it arrived only after the error carried
GitHub's response body, which is now the behaviour: `… was not written (422): {"message":"…does not match…"}`.
The message never includes the request body — that is ciphertext, and the discipline is not to put anything
secret-shaped in a log.

## What the tests pin, and what they didn't

The first fake accepted *any* URL ending in `public-key`, so the tests passed against the wrong endpoint and
the live call 404'd; the fix was to assert exact URLs and methods (`GET …/secrets/public-key`, then
`PUT …/secrets/NAME`), and to make the fake's handler see the HTTP method — it silently ignored it, which is
how a "refused write" test asserted a rejection that never happened. A double that is more forgiving than the
real API documents a fictional API; that sentence is now in the test file, not just here.

Also fixed: the fixture used a base64 string that only *looked* valid (libsodium rejected it as not a
32-byte value) and then used the standard alphabet while GitHub uses URL-safe. Both fixtures now derive from
a real keypair.
