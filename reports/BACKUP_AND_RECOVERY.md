# Backup and Recovery — Wednesday's Dark Chronicles

**Status:** preparation only. **No backup has been taken, and no restore has
been performed, as part of Phase 10.** Everything below is a procedure that
would be followed at an agreed time.

This document is provider-neutral and assumes PostgreSQL 13 or later, which
is what the project uses (16.15 in development).

---

## 1. What is being backed up

The application's state lives entirely in one PostgreSQL database:

| Table | Holds | Loss impact |
|---|---|---|
| `Post` | The published and draft articles | The entire site content |
| `Artifact` | The Vault entries | The Vault |
| `Category` | Blog and artifact categories | Navigation and filtering |
| `PostCategory`, `ArtifactCategory` | The join tables | Category membership |
| `Comment` | The Séance, including replies and moderation status | The comment thread |
| `Inquiry` | The contact-form messages | Unsent correspondence |
| `User` | The administrator accounts | **Admin access** |
| `Story`, `StoryNode`, `StoryChoice` | The branching stories and their graph | The interactive fiction |
| `Post_` (migrations) | The schema history | **The migration ledger** |

The `User` table is the important one: it holds the bcrypt password hashes.
A backup that omits it means losing administrator access, and the only
recovery is creating a new administrator with the existing script.

---

## 2. The backup

### 2.1 The command

`pg_dump` in **custom format** is the primary backup. Custom format is
compressed, and it can be restored selectively (a single table, or a single
schema) with `pg_restore`.

```bash
pg_dump \
  --format=custom \
  --file="wdc-$(date +%Y%m%d-%H%M%S).dump" \
  --no-owner \
  --no-acl \
  "$DATABASE_URL"
```

| Flag | Why |
|---|---|
| `--format=custom` | Compressed, and `pg_restore` can pick tables out of it |
| `--no-owner --no-acl` | The restore target's role names and grants may differ from the source's. This makes the dump portable. |
| `--file=` | Writes to a file rather than stdout, so a network hiccup cannot truncate it silently |

**Do not use `pg_dumpall`** for this. It is the wrong tool: it dumps cluster
roles and globals as well, and it produces a plain SQL script that is
slower to restore and has no selective-restore option.

**Do not use the plain SQL format** (`--format=plain`) for routine backups.
It is larger, slower to restore, and a single error can stop a restore
partway through.

### 2.2 The connection

Use the same `DATABASE_URL` the application uses, or an equivalent
connection string with credentials supplied by the environment. **Do not put
a password in the command line**, where it is visible in the process list
and in the shell history:

```bash
export PGPASSWORD='...'        # if the URL does not carry it
pg_dump --format=custom --file=... --no-owner --no-acl -h HOST -p 5432 -U USER DBNAME
```

### 2.3 Where the backup goes

A backup on the same disk as the database is not a backup. It survives a
bad migration, but not a lost disk, a lost instance, or a mistaken
`DROP DATABASE`.

Copy it off the machine as part of the backup job:

```bash
pg_dump --format=custom --file="wdc.dump" --no-owner --no-acl "$DATABASE_URL" \
  && aws s3 cp wdc.dump "s3://<bucket>/wdc/$(date +%Y%m%d-%H%M%S).dump" \
  && rm -f wdc.dump
```

Any object store works — S3, GCS, Azure Blob, or a second machine over
rsync. The requirement is that the copy is on **different infrastructure**
from the database.

### 2.4 A scheduled job

A daily job is the minimum for a site with published content. A weekly
backup with no daily backup is not enough; the interesting losses are the
recent ones.

```cron
# 03:17 every day — an odd minute so the job does not pile up with every
# other job on the hour.
17 3 * * * /usr/local/bin/wdc-backup.sh >> /var/log/wdc-backup.log 2>&1
```

The script should:

1. Run `pg_dump` to a temporary file.
2. **Verify the file is a valid dump** — `pg_restore --list` must succeed
   and must not be empty. A zero-byte file is a failed backup, and it must
   not be treated as a successful one.
3. Copy the file to the off-machine store.
4. **Delete the local copy only after the remote copy has been verified.**
5. Prune old backups according to the retention policy.

**A backup job that does not check its own output is not a backup.** The
most common failure is a `pg_dump` that failed for a missing extension or a
full disk, and a script that then uploaded the empty file over the last
good one.

### 2.5 Retention

A workable policy:

| Age | Kept |
|---|---|
| 0–7 days | Every daily backup |
| 8–90 days | One per week |
| Over 90 days | One per month, for a year |

Keep at least one backup from **before every release** that touches the
schema, in addition to the schedule.

---

## 3. Restoring

### 3.1 Restoring into a scratch database first

**Never rehearse a restore against the application database.** Restore into
a separate database, check it, and only then consider a production restore.

```bash
# 1. Create an empty scratch database.
createdb -h HOST -p 5432 -U USER wdc_restore_test

# 2. List what the dump contains, and confirm it is not empty.
pg_restore --list wdc.dump | head -20
pg_restore --list wdc.dump | wc -l

# 3. Restore into it.
pg_restore --no-owner --no-acl --dbname wdc_restore_test wdc.dump

# 4. Check the content.
psql -h HOST -p 5432 -U USER -d wdc_restore_test -c "\dt"
psql -h HOST -p 5432 -U USER -d wdc_restore_test \
  -c 'SELECT count(*) FROM "Post";'
psql -h HOST -p 5432 -U USER -d wdc_restore_test \
  -c 'SELECT count(*) FROM "User";'

# 5. Drop the scratch database when the check is done.
dropdb -h HOST -p 5432 -U USER wdc_restore_test
```

The row counts must match what the live database had at the time of the
dump. Check the counts of the content tables, not just that the tables
exist.

### 3.2 Restoring the application database

This destroys the current contents. It needs explicit approval.

```bash
# 1. Stop the application, so nothing writes during the restore.
# 2. Take a backup of the CURRENT state first, even though it may be
#    corrupt. It is the only way back.
pg_dump --format=custom --file=pre-restore.dump --no-owner --no-acl "$DATABASE_URL"

# 3. Restore.
pg_restore --clean --if-exists --no-owner --no-acl --dbname "$DBNAME" wdc.dump

# 4. Restart the application and run the smoke tests.
```

`--clean --if-exists` drops the existing objects before recreating them, so
the restore does not fail on objects that already exist. Use it only when
the target really is the application database.

### 3.3 Recovering a single table

Custom-format dumps can be restored selectively, which is often the right
move when only one table was damaged:

```bash
# See the table names in the dump.
pg_restore --list wdc.dump | grep 'TABLE DATA'

# Restore one table.
pg_restore --no-owner --no-acl --dbname "$DBNAME" \
  --table='"Comment"' wdc.dump
```

The quoting of the table name matters: the tables use mixed-case names, so
`--table="Comment"` will not match and will silently restore nothing.

---

## 4. What a restore does not fix

| Situation | Covered by a dump? |
|---|---|
| A bad migration that dropped a column | **Yes**, if the dump predates it |
| An accidental `DELETE` or `UPDATE` | **Yes**, if the dump predates it |
| A lost disk or a lost instance | **Yes** — this is the main case |
| A stolen or leaked database password | **No** — rotate the credential, and the dump may itself be a liability |
| A compromise of the *application* — an administrator account being abused | **No** — restoring the data restores the compromised account too. Change the administrator's password as well, or recreate the account |
| A bug that corrupts data on the way in | **No** — a restore returns to the same bug. Fix the bug first |

**The last row matters most.** Restoring a backup into an unfixed
application reproduces the failure. Always fix the cause before restoring.

---

## 5. Encryption and access

* **Encrypt the backups.** A dump contains the administrator password hashes
  and every inquiry message. Store it encrypted at rest with a key that is
  held separately from the backup itself.
* **Restrict access.** The person or service account that can restore is
  effectively a database administrator.
* **Keep the retention policy short enough to be defensible.** A year of
  daily backups of a database containing personal data is a liability.
* **Treat a backup copy as production data.** It must never be dropped into
  a development machine, an unencrypted disk, or a shared folder.

---

## 6. Verifying a backup

A backup that has never been restored is an assumption, not a backup.

**Weekly**, restore the most recent dump into a scratch database and check:

1. `pg_restore --list` succeeds and lists the expected tables.
2. The row counts of `Post`, `Artifact`, `Comment`, `User` and `Story` match
   what was live.
3. The most recent post and the most recent comment are present and
   readable.
4. The scratch database is then dropped.

**Quarterly**, do the same with the monthly archive backup, so the
long-retention path is exercised too.

Record the result of each verification. A verification that is not written
down is a verification nobody will find later.

---

## 7. Before a risky change

Beyond the schedule, take an **ad-hoc backup** before:

* Any migration that is not purely additive.
* Any bulk update or delete run by hand.
* Any change to the database role or its privileges.
* The first deployment against a new production database.
* Upgrading the PostgreSQL major version.

Label these clearly, so they are not pruned by the retention job, and keep
them until the change has been verified in production.
