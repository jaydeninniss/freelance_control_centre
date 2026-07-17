<?php
header('Content-Type: application/json');
// Allow requests from the same origin and localhost dev ports
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = ['http://localhost:8888', 'http://localhost:3000', 'http://127.0.0.1:8888'];
if (in_array($origin, $allowed) || (strlen($origin) >= 6 && substr($origin, -6) === '.local')) {
    header("Access-Control-Allow-Origin: $origin");
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/config.php';

// ── DB connection ──────────────────────────────────────────────
try {
    $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => 'DB connection failed: ' . $e->getMessage()]);
    exit;
}

// ── Request parsing ────────────────────────────────────────────
$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    echo json_encode(['success' => false, 'error' => 'Invalid JSON']);
    exit;
}

$action = $input['action'] ?? '';
$key    = $input['key']    ?? '';

// Whitelist table names — never interpolate user input directly
$allowed_tables = [
    'fcc_tasks', 'fcc_task_columns', 'fcc_projects',
    'fcc_clients', 'fcc_collaborators',
    'fcc_project_clients', 'fcc_project_collaborators',
    'fcc_documents',
];
if (!in_array($key, $allowed_tables, true)) {
    echo json_encode(['success' => false, 'error' => 'Unknown collection: ' . $key]);
    exit;
}

// ── Helpers ────────────────────────────────────────────────────

function respond($data): void {
    echo json_encode(['success' => true, 'data' => $data]);
    exit;
}

function fail(string $msg): void {
    echo json_encode(['success' => false, 'error' => $msg]);
    exit;
}

// Encode PHP arrays to JSON strings before storing
function encode_arrays(array $record): array {
    foreach ($record as $k => $v) {
        if (is_array($v)) $record[$k] = json_encode($v, JSON_UNESCAPED_UNICODE);
    }
    return $record;
}

// Decode JSON strings back to arrays after fetching
function decode_arrays($row) {
    if (!$row) return $row;
    foreach ($row as $k => $v) {
        if (is_string($v) && strlen($v) > 0 && in_array($v[0], ['[', '{'])) {
            $decoded = json_decode($v, true);
            if (json_last_error() === JSON_ERROR_NONE) $row[$k] = $decoded;
        }
    }
    return $row;
}

function decode_rows(array $rows): array {
    return array_map('decode_arrays', $rows);
}

// ── Actions ────────────────────────────────────────────────────

try {
    switch ($action) {

        case 'getAll': {
            $stmt = $pdo->query("SELECT * FROM `$key`");
            respond(decode_rows($stmt->fetchAll()));
        }

        case 'getById': {
            $id   = $input['id'] ?? null;
            $stmt = $pdo->prepare("SELECT * FROM `$key` WHERE id = ?");
            $stmt->execute([$id]);
            respond(decode_arrays($stmt->fetch() ?: null));
        }

        case 'insert': {
            $record = $input['record'] ?? [];
            if (empty($record['id']))         $record['id']         = bin2hex(random_bytes(16));
            if (empty($record['created_at'])) $record['created_at'] = date('c');
            $record = encode_arrays($record);

            $cols   = implode(', ', array_map(function($c) { return "`$c`"; }, array_keys($record)));
            $ph     = implode(', ', array_fill(0, count($record), '?'));
            $stmt   = $pdo->prepare("INSERT INTO `$key` ($cols) VALUES ($ph)");
            $stmt->execute(array_values($record));

            $stmt2  = $pdo->prepare("SELECT * FROM `$key` WHERE id = ?");
            $stmt2->execute([$record['id']]);
            respond(decode_arrays($stmt2->fetch()));
        }

        case 'update': {
            $id      = $input['id']      ?? null;
            $changes = $input['changes'] ?? [];
            $changes['updated_at'] = date('c');
            $changes = encode_arrays($changes);

            $set  = implode(', ', array_map(function($c) { return "`$c` = ?"; }, array_keys($changes)));
            $vals = array_values($changes);
            $vals[] = $id;
            $stmt = $pdo->prepare("UPDATE `$key` SET $set WHERE id = ?");
            $stmt->execute($vals);

            $stmt2 = $pdo->prepare("SELECT * FROM `$key` WHERE id = ?");
            $stmt2->execute([$id]);
            respond(decode_arrays($stmt2->fetch()));
        }

        case 'delete': {
            $id   = $input['id'] ?? null;
            $stmt = $pdo->prepare("DELETE FROM `$key` WHERE id = ?");
            $stmt->execute([$id]);
            respond($stmt->rowCount() > 0);
        }

        case 'junctionGet': {
            $fk   = $input['filterKey'] ?? null;
            $fv   = $input['filterVal'] ?? null;
            // filterKey is user-supplied — whitelist it
            $ok_cols = ['project_id','client_id','collaborator_id'];
            if (!in_array($fk, $ok_cols, true)) fail('Invalid filterKey');
            $stmt = $pdo->prepare("SELECT * FROM `$key` WHERE `$fk` = ?");
            $stmt->execute([$fv]);
            respond($stmt->fetchAll());
        }

        case 'junctionAdd': {
            $record = $input['record'] ?? [];
            $cols   = implode(', ', array_map(function($c) { return "`$c`"; }, array_keys($record)));
            $ph     = implode(', ', array_fill(0, count($record), '?'));
            $stmt   = $pdo->prepare("INSERT IGNORE INTO `$key` ($cols) VALUES ($ph)");
            $stmt->execute(array_values($record));
            respond(true);
        }

        case 'junctionRemove': {
            $record     = $input['record'] ?? [];
            $conditions = implode(' AND ', array_map(function($c) { return "`$c` = ?"; }, array_keys($record)));
            $stmt       = $pdo->prepare("DELETE FROM `$key` WHERE $conditions");
            $stmt->execute(array_values($record));
            respond(true);
        }

        default:
            fail('Unknown action: ' . $action);
    }
} catch (PDOException $e) {
    fail('Query failed: ' . $e->getMessage());
}
