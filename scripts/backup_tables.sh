#!/bin/bash

# Supabase Schema Cleanup - Table Backup Script
# This script creates backups of tables before archiving them

set -e

# Configuration
BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/${BACKUP_DATE}"
DATABASE_URL="${DATABASE_URL:-$VITE_SUPABASE_URL}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    print_error "DATABASE_URL environment variable is not set"
    print_error "Please set it to your Supabase database connection string"
    exit 1
fi

# Create backup directory
print_status "Creating backup directory: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# Tables to backup before archiving
TABLES_TO_BACKUP=(
    "master_dummy"
    "missing_scans" 
    "parties"
)

# Function to backup a single table
backup_table() {
    local table_name=$1
    local backup_file="${BACKUP_DIR}/${table_name}.sql"
    
    print_status "Backing up table: $table_name"
    
    # Check if table exists
    if ! psql "$DATABASE_URL" -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$table_name';" -t | grep -q 1; then
        print_warning "Table $table_name does not exist, skipping..."
        return 0
    fi
    
    # Get row count
    local row_count=$(psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM public.$table_name;" -t | tr -d ' ')
    print_status "Table $table_name has $row_count rows"
    
    # Create backup
    if pg_dump --data-only --column-inserts --table="public.$table_name" "$DATABASE_URL" > "$backup_file"; then
        print_status "✓ Successfully backed up $table_name to $backup_file"
        
        # Verify backup file
        if [ -s "$backup_file" ]; then
            local file_size=$(du -h "$backup_file" | cut -f1)
            print_status "  Backup file size: $file_size"
        else
            print_warning "  Backup file is empty (table may have no data)"
        fi
    else
        print_error "✗ Failed to backup $table_name"
        return 1
    fi
}

# Function to backup schema structure
backup_schema() {
    local schema_file="${BACKUP_DIR}/schema_structure.sql"
    print_status "Backing up schema structure for tables to be archived"
    
    pg_dump --schema-only --table="public.master_dummy" --table="public.missing_scans" --table="public.parties" "$DATABASE_URL" > "$schema_file"
    
    if [ -s "$schema_file" ]; then
        print_status "✓ Schema structure backed up to $schema_file"
    else
        print_warning "Schema backup file is empty"
    fi
}

# Main backup process
print_status "Starting table backup process..."
print_status "Backup timestamp: $BACKUP_DATE"

# Backup each table
for table in "${TABLES_TO_BACKUP[@]}"; do
    if ! backup_table "$table"; then
        print_error "Backup process failed for table: $table"
        exit 1
    fi
done

# Backup schema structure
backup_schema

# Create restore instructions
cat > "${BACKUP_DIR}/RESTORE_INSTRUCTIONS.md" << EOF
# Restore Instructions

## Backup Information
- **Date:** $BACKUP_DATE
- **Tables backed up:** ${TABLES_TO_BACKUP[*]}
- **Location:** $BACKUP_DIR

## To restore a single table:

1. **Restore table structure (if needed):**
   \`\`\`bash
   psql "\$DATABASE_URL" < $BACKUP_DIR/schema_structure.sql
   \`\`\`

2. **Restore table data:**
   \`\`\`bash
   # For master_dummy:
   psql "\$DATABASE_URL" < $BACKUP_DIR/master_dummy.sql
   
   # For missing_scans:
   psql "\$DATABASE_URL" < $BACKUP_DIR/missing_scans.sql
   
   # For parties:
   psql "\$DATABASE_URL" < $BACKUP_DIR/parties.sql
   \`\`\`

## To restore all tables:
\`\`\`bash
for file in $BACKUP_DIR/*.sql; do
    if [[ "\$file" != *"schema_structure"* ]]; then
        echo "Restoring \$file..."
        psql "\$DATABASE_URL" < "\$file"
    fi
done
\`\`\`

## Verification:
After restoring, verify the data:
\`\`\`sql
SELECT COUNT(*) FROM master_dummy;
SELECT COUNT(*) FROM missing_scans;
SELECT COUNT(*) FROM parties;
\`\`\`
EOF

# Create summary
print_status "Creating backup summary..."
echo "# Backup Summary - $BACKUP_DATE" > "${BACKUP_DIR}/BACKUP_SUMMARY.md"
echo "" >> "${BACKUP_DIR}/BACKUP_SUMMARY.md"
echo "## Files created:" >> "${BACKUP_DIR}/BACKUP_SUMMARY.md"

for file in "${BACKUP_DIR}"/*; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        filesize=$(du -h "$file" | cut -f1)
        echo "- **$filename** ($filesize)" >> "${BACKUP_DIR}/BACKUP_SUMMARY.md"
    fi
done

print_status "✓ Backup process completed successfully!"
print_status "Backup location: $BACKUP_DIR"
print_status ""
print_status "Next steps:"
print_status "1. Review the backup files in $BACKUP_DIR"
print_status "2. Run the migration: npx supabase migration up"
print_status "3. Test the application thoroughly"
print_status "4. If issues occur, use the rollback migration"
print_status ""
print_warning "Keep these backups safe until you're confident the migration is successful!"