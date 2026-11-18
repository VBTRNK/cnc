# Security

Crime & Crown has no accounts. A player can keep a run in the shared
VibeTrunk Supabase project (schema `cnc`) under a random cloud code; the code
is the only key to that save, and the database stores only its hash. No
client role can read or write the table: the browser calls two database
functions that check the code, the revision order, the size, and how many new
codes appear. See [`AGENTS.md`](AGENTS.md) for the invariants.

Only the publishable key reaches the browser. The game has no server and no
secret key; a secret never gets a `VITE_` prefix or a place in a tracked file.

If you notice something suspicious (an RLS gap, a CSP bypass, a vulnerable
dependency, a leaked credential), report it privately through GitHub's
[private vulnerability reporting](https://github.com/VBTRNK/cnc/security/advisories/new)
rather than opening a public issue.
