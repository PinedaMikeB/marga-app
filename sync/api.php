<?php
/**
 * MARGA Sync API
 * Place this file on your server with MySQL access
 * The synclatest.html will call this endpoint
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// ============================================
// DATABASE CONFIG - UPDATE THESE!
// ============================================
$config = [
    'host' => 'localhost',
    'database' => 'maborot1_loloaborot',  // UPDATE THIS
    'username' => 'maborot1_loloaborot',  // UPDATE THIS  
    'password' => 'your_password',         // UPDATE THIS
    'charset' => 'utf8mb4'
];

// Tables to sync with their timestamp fields
$tables = [
    'tbl_billing' => ['field' => 'tmestamp', 'priority' => 1],
    'tbl_machinereading' => ['field' => 'timestmp', 'priority' => 1],
    'tbl_collections' => ['field' => 'tmestamp', 'priority' => 1],
    'tbl_paymentinfo' => ['field' => 'tmestamp', 'priority' => 1],
    'tbl_contractmain' => ['field' => 'update_date', 'priority' => 2],
    'tbl_companylist' => ['field' => 'timestamp', 'priority' => 2],
    'tbl_branchinfo' => ['field' => 'timestamp', 'priority' => 2],
    'tbl_machine' => ['field' => 'tmestamp', 'priority' => 2],
    'tbl_invoicenum' => ['field' => 'tmestamp', 'priority' => 2],
    'tbl_schedule' => ['field' => 'tmestamp', 'priority' => 3],
    'tbl_newdr' => ['field' => 'tmestamp', 'priority' => 3],
    'tbl_newmachinehistory' => ['field' => 'timestamp', 'priority' => 3],
    'tbl_collectionhistory' => ['field' => 'tmestamp', 'priority' => 3],
    'tbl_checkpayments' => ['field' => 'tmestamp', 'priority' => 3],
];

// ============================================
// API LOGIC
// ============================================

$action = $_GET['action'] ?? $_POST['action'] ?? 'status';
$since = $_GET['since'] ?? $_POST['since'] ?? date('Y-m-d', strtotime('-1 day'));
$table = $_GET['table'] ?? $_POST['table'] ?? null;

try {
    $pdo = new PDO(
        "mysql:host={$config['host']};dbname={$config['database']};charset={$config['charset']}",
        $config['username'],
        $config['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

switch ($action) {
    case 'status':
        // Return sync status and available tables
        echo json_encode([
            'status' => 'online',
            'tables' => array_keys($tables),
            'server_time' => date('Y-m-d H:i:s')
        ]);
        break;
        
    case 'count':
        // Count records to sync for each table
        $counts = [];
        foreach ($tables as $tableName => $info) {
            try {
                $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM `$tableName` WHERE `{$info['field']}` >= ?");
                $stmt->execute([$since]);
                $result = $stmt->fetch(PDO::FETCH_ASSOC);
                $counts[$tableName] = (int)$result['count'];
            } catch (Exception $e) {
                $counts[$tableName] = 0;
            }
        }
        echo json_encode([
            'since' => $since,
            'counts' => $counts,
            'total' => array_sum($counts)
        ]);
        break;
        
    case 'fetch':
        // Fetch records from a specific table
        if (!$table || !isset($tables[$table])) {
            echo json_encode(['error' => 'Invalid table']);
            exit;
        }
        
        $info = $tables[$table];
        $limit = (int)($_GET['limit'] ?? 5000);
        $offset = (int)($_GET['offset'] ?? 0);
        
        try {
            $stmt = $pdo->prepare("SELECT * FROM `$table` WHERE `{$info['field']}` >= ? ORDER BY `{$info['field']}` LIMIT ? OFFSET ?");
            $stmt->execute([$since, $limit, $offset]);
            $records = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            echo json_encode([
                'table' => $table,
                'since' => $since,
                'count' => count($records),
                'offset' => $offset,
                'records' => $records
            ]);
        } catch (Exception $e) {
            echo json_encode(['error' => $e->getMessage()]);
        }
        break;
        
    case 'fetchall':
        // Fetch all updated records from all priority 1 tables
        $allRecords = [];
        $totalCount = 0;
        
        foreach ($tables as $tableName => $info) {
            if ($info['priority'] > 2) continue; // Skip low priority
            
            try {
                $stmt = $pdo->prepare("SELECT * FROM `$tableName` WHERE `{$info['field']}` >= ?");
                $stmt->execute([$since]);
                $records = $stmt->fetchAll(PDO::FETCH_ASSOC);
                
                if (count($records) > 0) {
                    $allRecords[$tableName] = $records;
                    $totalCount += count($records);
                }
            } catch (Exception $e) {
                // Skip failed tables
            }
        }
        
        echo json_encode([
            'since' => $since,
            'total' => $totalCount,
            'tables' => $allRecords
        ]);
        break;
        
    default:
        echo json_encode(['error' => 'Invalid action']);
}
?>
