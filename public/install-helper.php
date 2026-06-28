<?php
/**
 * Fruitopia — Universal Install Helper
 *
 * Static JSON files in a web-served folder are always publicly downloadable
 * regardless of app-level checks. This helper NEVER writes firebase-config.json
 * into public_html. It stores Firebase credentials as environment variables in
 * a .env file above the web root when possible, then returns the env block for
 * hosts where PHP cannot safely write outside public_html.
 */

header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Accept');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

function respond(array $payload, int $httpCode = 200): void {
    http_response_code($httpCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['success' => false, 'message' => 'Method not allowed. Send a POST request with JSON body.'], 405);
}

$rawBody = file_get_contents('php://input');
if (empty($rawBody)) {
    respond(['success' => false, 'message' => 'Request body is empty. Send Firebase credentials as JSON.'], 400);
}

$data = json_decode($rawBody, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    respond(['success' => false, 'message' => 'Invalid JSON: ' . json_last_error_msg()], 400);
}

$requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
foreach ($requiredFields as $field) {
    if (!isset($data[$field]) || !is_string($data[$field]) || trim($data[$field]) === '') {
        respond(['success' => false, 'message' => "Missing or empty required field: \"{$field}\". All Firebase credentials are required."], 400);
    }
}

if (strpos(trim($data['apiKey']), 'AIza') !== 0) {
    respond(['success' => false, 'message' => 'Invalid apiKey format. Firebase API keys begin with "AIza".'], 400);
}

$vars = [
    'FIREBASE_API_KEY' => trim($data['apiKey']),
    'FIREBASE_AUTH_DOMAIN' => trim($data['authDomain']),
    'FIREBASE_PROJECT_ID' => trim($data['projectId']),
    'FIREBASE_STORAGE_BUCKET' => trim($data['storageBucket']),
    'FIREBASE_MESSAGING_SENDER_ID' => trim($data['messagingSenderId']),
    'FIREBASE_APP_ID' => trim($data['appId']),
];
if (isset($data['databaseId']) && is_string($data['databaseId']) && trim($data['databaseId']) !== '') {
    $vars['FIREBASE_DATABASE_ID'] = trim($data['databaseId']);
}

$envBlock = implode("\n", array_map(fn($k, $v) => $k . '=' . $v, array_keys($vars), $vars));
$scriptDir = __DIR__;
$parentEnv = dirname($scriptDir) . DIRECTORY_SEPARATOR . '.env';

if (is_writable(dirname($scriptDir))) {
    $existing = file_exists($parentEnv) ? file_get_contents($parentEnv) : '';
    $lines = $existing === false ? [] : preg_split('/\R/', $existing);
    $filtered = [];
    foreach ($lines as $line) {
        if ($line === '') continue;
        $key = explode('=', $line, 2)[0];
        if (!array_key_exists($key, $vars)) $filtered[] = $line;
    }
    $newContent = trim(implode("\n", array_merge($filtered, explode("\n", $envBlock)))) . "\n";
    if (file_put_contents($parentEnv, $newContent, LOCK_EX) !== false) {
        respond([
            'success' => false,
            'needsEnvVars' => true,
            'vars' => $vars,
            'envBlock' => $envBlock,
            'message' => 'Firebase credentials were written to a .env file outside the web root. Restart the app/PHP process if your host requires it, then continue.',
        ]);
    }
}

respond([
    'success' => false,
    'needsEnvVars' => true,
    'vars' => $vars,
    'envBlock' => $envBlock,
    'message' => 'Could not safely write outside the web root. Add these environment variables in your host control panel, then continue.',
]);