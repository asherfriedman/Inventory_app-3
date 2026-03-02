# Inventory App v3

## Target Device
Primary target: iPhone 17 Pro (mobile-first, 430px max-width shell).
All UI decisions should prioritize this device's screen size and touch interactions.

## Database Migration (SQLite → Supabase)

To wipe Supabase and re-import from a SQLite backup:

```bash
SOURCE_DB_PATH=./<filename>.db \
MAIN_STORE_ID=-2 \
WIPE_FIRST=1 \
SUPABASE_URL=https://shcirsxtqwbjpmjxieqj.supabase.co \
SUPABASE_SERVICE_KEY=<key from api.txt> \
node scripts/migrate.js
```

- Script: `scripts/migrate.js` (uses `sql.js` to read SQLite, batch-inserts into Supabase)
- `MAIN_STORE_ID=-2` filters for the main store only (ignores other stores)
- `WIPE_FIRST=1` deletes all existing Supabase data before importing
- The anon key from `api.txt` works as the service key (no RLS policies)
- Credentials are in `api.txt` at project root
