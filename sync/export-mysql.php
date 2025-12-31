<?php
/**
 * MARGA Daily Sync - MySQL Export Script
 * 
 * Run this script daily to export updated records from MySQL
 * Usage: php export-mysql.php [--since="2025-01-05 00:00:00"] [--table=tbl_billing]
 * 
 * Output: JSON files in /exports/ folder
 */

// ============================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================
$config = [
    'host' => 'localhost',
    'database' => 'your_database_name',  // UPDATE THIS
    'username' => 'your_username',        // UPDATE THIS
    'password' => 'your_password',        // UPDATE THIS
    'charset' => 'utf8mb4'
];

// Tables to sync with their timestamp fields
$tables = [
    'tbl_billing' => 'tmestamp',
    'tbl_machinereading' => 'timestmp',
    'tbl_collections' => 'tmestamp',
    'tbl_contractmain' => 'update_date',
    'tbl_companylist' => 'timestamp',
    'tbl_branchinfo' => 'timestamp',
    'tbl_machine' => 'tmestamp',
    'tbl_schedule' => 'tmestamp',
    'tbl_paymentinfo' => 'tmestamp',
    'tbl_invoicenum' => 'tmestamp',
    'tbl_newmachinehistory' => 'timestamp',
    'tbl_collectionhistory' => 'tmestamp',
    'tbl_newdr' => 'tmestamp',
    'tbl_finaldr' => 'timestamp',
    'tbl_checkpayments' => 'tmestamp',
    'tbl_newcartridgehistory' => 'timestamp',
    'tbl_newpartshistory' => 'timestamp',
    'tbl_newothershistory' => 'timestamp',
    'tbl_newmachinerepair' => 'timestamp',
    'tbl_newcartridgerepair' => 'timestamp'
];

// ============================================
// SCRIPT LOGIC
// ============================================

// Parse command line arguments
$since = null;
$specificTable = null;

foreach ($argv as $arg) {
    if (strpos($arg, '--since=') === 0) {
        $since = substr($arg, 8);
    }
    if (strpos($arg, '--table=') === 0) {
        $specificTable = substr($arg, 8);
    }
}

// Default to 24 hours ago if no --since provided
if (!$since) {
    $since = date('Y-m-d H:i:s', strtotime('-24 hours'));
}

echo "===========================================\n";
echo "MARGA Daily Sync - MySQL Export\n";
echo "===========================================\n";
echo "Exporting records updated since: $since\n";
echo "-------------------------------------------\n\n";

// Create exports directory
$exportDir = __DIR__ . '/exports';
if (!is_dir($exportDir)) {
    mkdir($exportDir, 0755, true);
}

// Connect to MySQL
try {
    $pdo = new PDO(
        "mysql:host={$config['host']};dbname={$config['database']};charset={$config['charset']}",
        $config['username'],
        $config['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    echo "✅ Connected to MySQL\n\n";
} catch (PDOException $e) {
    die("❌ Connection failed: " . $e->getMessage() . "\n");
}

// Export each table
$totalRecords = 0;
$exportedFiles = [];

foreach ($tables as $tableName => $timestampField) {
    // Skip if specific table requested and this isn't it
    if ($specificTable && $tableName !== $specificTable) {
        continue;
    }
    
    echo "Processing $tableName...\n";
    
    try {
        // Check if table exists
        $stmt = $pdo->query("SHOW TABLES LIKE '$tableName'");
        if ($stmt->rowCount() === 0) {
            echo "  ⚠️ Table not found, skipping\n";
            continue;
        }
        
        // Check if timestamp field exists
        $stmt = $pdo->query("SHOW COLUMNS FROM `$tableName` LIKE '$timestampField'");
        if ($stmt->rowCount() === 0) {
            echo "  ⚠️ Timestamp field '$timestampField' not found, exporting all records\n";
            $query = "SELECT * FROM `$tableName`";
        } else {
            $query = "SELECT * FROM `$tableName` WHERE `$timestampField` >= :since";
        }
        
        // Execute query
        $stmt = $pdo->prepare($query);
        if (strpos($query, ':since') !== false) {
            $stmt->execute(['since' => $since]);
        } else {
            $stmt->execute();
        }
        
        $records = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $count = count($records);
        
        if ($count > 0) {
            // Save to JSON file
            $filename = "{$tableName}_" . date('Ymd_His') . ".json";
            $filepath = "$exportDir/$filename";
            
            file_put_contents($filepath, json_encode($records, JSON_PRETTY_PRINT));
            
            echo "  ✅ Exported $count records to $filename\n";
            $totalRecords += $count;
            $exportedFiles[] = [
                'table' => $tableName,
                'file' => $filename,
                'records' => $count
            ];
        } else {
            echo "  ⏭️ No updated records\n";
        }
        
    } catch (PDOException $e) {
        echo "  ❌ Error: " . $e->getMessage() . "\n";
    }
}

// Create manifest file
$manifest = [
    'export_date' => date('Y-m-d H:i:s'),
    'since' => $since,
    'total_records' => $totalRecords,
    'files' => $exportedFiles
];

$manifestFile = "$exportDir/manifest_" . date('Ymd_His') . ".json";
file_put_contents($manifestFile, json_encode($manifest, JSON_PRETTY_PRINT));

echo "\n===========================================\n";
echo "EXPORT COMPLETE\n";
echo "===========================================\n";
echo "Total records exported: $totalRecords\n";
echo "Files created: " . count($exportedFiles) . "\n";
echo "Manifest: $manifestFile\n";
echo "\nNext step: Upload these files to the Sync Dashboard\n";
echo "===========================================\n";
?>
