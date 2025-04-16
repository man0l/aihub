# Database Migrations

This directory contains migrations for the Supabase database. 

## Current Status

The following migrations have been applied to the database:

1. `20250127133117_quiet_shadow.sql` - Initial schema with profiles, collections, documents, topics tables
2. `20250127151347_shrill_lagoon.sql` - Added storage bucket policies
3. `20250127151648_empty_waterfall.sql` - Updated profiles table policies
4. `20250202120626_young_math.sql` - Added audio summary columns
5. `20250202122219_late_desert.sql` - Added audio processing status fields
6. `20250415183907_fix_pgmq_send_function.sql` - [ROLLED BACK] Fixed pgmq_send function
7. `20250415184013_fix_pgmq_send_function.sql` - [ROLLED BACK] Duplicate of the previous migration
8. `20250415184039_fix_enqueue_video_processing.sql` - [ROLLED BACK] Fixed video processing function
9. `20250415185639_update_enqueue_video_processing.sql` - [ROLLED BACK] Added document_id parameter
10. `20250416074030_combine_enqueue_functions.sql` - [ROLLED BACK] Combined both video processing functions
11. `20250416160000_rollback_function_changes.sql` - Rolled back the previous function changes (6-10)
12. `20250416160500_apply_schema_snapshot.sql` - Applied current schema snapshot with fixed functions

## Migration Status

All necessary database objects are currently in place. The following files in this directory are **obsolete** and should not be applied:

- `20250415000000_fix_pgmq_receive_function.sql`
- `20250415215208_fix_pgmq_wrapper_params.sql`
- `20250416000000_fix_pgmq_send_function.sql`
- `20250416000001_fix_enqueue_video_processing.sql`
- `20250417000001_update_enqueue_video_processing.sql`
- `20250418000001_fix_function_ambiguity.sql`
- `20250128000000_add_video_processing_queue.sql`
- `20250128000001_add_enqueue_function.sql`
- `20250128000003_add_pgmq_wrappers.sql`
- `20250128000005_fix_pgmq_functions.sql`
- `website_processing_queue.sql`

## Current Database Structure

1. Tables:
   - profiles
   - collections
   - documents
   - topics
   - document_topics
   - video_processing

2. Functions:
   - enqueue_video_processing (supports document_id parameter)
   - pgmq_send (handles JSONB conversion properly)

3. Extensions:
   - pgmq

## Adding New Migrations

When adding new migrations:

1. Use a timestamp format for the filename: `{timestamp}_{descriptive_name}.sql`
2. Apply the migration using Supabase CLI or MCP
3. Check the `supabase_migrations.schema_migrations` table to verify it was applied

The migration tracking system is using the `supabase_migrations` schema, not the `public` schema.

## Current Schema Snapshot

The file `20250416150000_current_schema_snapshot.sql` contains a snapshot of the current schema. It serves as documentation and a reference for the current state of the database. This file has been used as the basis for the migration `20250416160500_apply_schema_snapshot.sql`. 