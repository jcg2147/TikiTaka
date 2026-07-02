# generate-daily-challenges

Supabase Edge Function that generates the next Monday-to-Sunday puzzle schedule and upserts seven rows into `public.daily_challenges`.

Schedule:
- Monday-Friday: `5x5`, `4` targets.
- Saturday-Sunday: `6x6`, `5` targets.
- Each date gets exactly `3` puzzles.

Required environment:

```bash
supabase secrets set SUPABASE_URL="https://<project-ref>.supabase.co"
```

The administrative API token is read from the system-injected `SUPABASE_SECRET_KEYS` JSON object:

```ts
JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")!)["default"]
```

Optional cron secret:

```bash
supabase secrets set CRON_SECRET="<long-random-secret>"
```

When `CRON_SECRET` is set, invoke the function with:

```http
Authorization: Bearer <long-random-secret>
```

Deploy:

```bash
supabase functions deploy generate-daily-challenges
```

Cron recommendation: run once per week before Monday, for example Sunday evening:

```cron
0 22 * * 0
```

The function uses the default administrative token from `SUPABASE_SECRET_KEYS` and performs an upsert on `release_date`, equivalent to `insert ... on conflict (release_date) do update`.
