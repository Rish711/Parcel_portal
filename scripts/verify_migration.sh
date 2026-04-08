#!/bin/bash

# Supabase Schema Migration Verification Script
# This script verifies the archive migration was successful

set -e

# Configuration
DATABASE_URL="${DATABASE_URL:-$VITE_SUPABASE_URL}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}[VERIFY]${NC} $1"
}

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    print_error "DATABASE_URL environment variable is not set"
    print_error "Please set it to your Supabase database connection string"
    exit 1
fi

print_header "Starting migration verification..."

# Function to check if table exists in schema
check_table_exists() {
    local schema=$1
    local table=$2
    local exists=$(psql "$DATABASE_URL" -t -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='$schema' AND table_name='$table');" | tr -d ' ')
    echo "$exists"
}

# Function to check if view exists in schema
check_view_exists() {
    local schema=$1
    local view=$2
    local exists=$(psql "$DATABASE_URL" -t -c "SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='$schema' AND table_name='$view');" | tr -d ' ')
    echo "$exists"
}

# Verify archive schema exists
print_status "Checking if archive schema exists..."
archive_exists=$(psql "$DATABASE_URL" -t -c "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='archive');" | tr -d ' ')
if [ "$archive_exists" = "t" ]; then
    print_status "✓ Archive schema exists"
else
    print_error "✗ Archive schema does not exist"
    exit 1
fi

# Check that archived tables are in archive schema
print_status "Verifying archived tables..."

archived_tables=(
    "master_dummy_deprecated_20250202"
    "missing_scans_deprecated_20250202"
    "parties_deprecated_20250202"
)

for table in "${archived_tables[@]}"; do
    exists=$(check_table_exists "archive" "$table")
    if [ "$exists" = "t" ]; then
        print_status "✓ $table found in archive schema"
    else
        print_warning "✗ $table not found in archive schema"
    fi
done

# Check that archived view is in archive schema
print_status "Verifying archived views..."
view_exists=$(check_view_exists "archive" "inactive_parties_view_deprecated_20250202")
if [ "$view_exists" = "t" ]; then
    print_status "✓ inactive_parties_view_deprecated_20250202 found in archive schema"
else
    print_warning "✗ inactive_parties_view_deprecated_20250202 not found in archive schema"
fi

# Check that original tables/views are NOT in public schema
print_status "Verifying tables removed from public schema..."

removed_tables=(
    "master_dummy"
    "missing_scans"
    "parties"
)

for table in "${removed_tables[@]}"; do
    exists=$(check_table_exists "public" "$table")
    if [ "$exists" = "f" ]; then
        print_status "✓ $table successfully removed from public schema"
    else
        print_error "✗ $table still exists in public schema"
    fi
done

# Check that inactive_parties_view is removed from public
view_exists=$(check_view_exists "public" "inactive_parties_view")
if [ "$view_exists" = "f" ]; then
    print_status "✓ inactive_parties_view successfully removed from public schema"
else
    print_error "✗ inactive_parties_view still exists in public schema"
fi

# Check that KEEP tables are still in public schema
print_status "Verifying KEEP tables remain in public schema..."

keep_tables=(
    "analysis_table"
    "courier_agency_list"
    "courier_bills"
    "courier_rates"
    "label_prints"
    "party_information"
    "party_list"
    "scan_tally"
)

for table in "${keep_tables[@]}"; do
    exists=$(check_table_exists "public" "$table")
    if [ "$exists" = "t" ]; then
        print_status "✓ $table remains in public schema"
    else
        print_error "✗ $table missing from public schema (this is bad!)"
    fi
done

# Get row counts for archived tables
print_status "Getting row counts for archived tables..."
for table in "${archived_tables[@]}"; do
    exists=$(check_table_exists "archive" "$table")
    if [ "$exists" = "t" ]; then
        count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM archive.$table;" | tr -d ' ')
        print_status "  $table: $count rows"
    fi
done

print_header "Migration verification completed!"
print_status "If all checks passed, the migration was successful."
print_status "If any issues were found, consider running the rollback migration."