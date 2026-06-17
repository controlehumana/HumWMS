<?php
/**
 * WMS Transfer Endpoint
 * Recebe transferências de local enviadas pelo HumWMS via PATCH.
 *
 * Deploy: /erp/api/v1/human/stock/transfer.php
 * Método: PATCH
 * Auth:   ?token=WMS-TOKEN-STOCK-2026
 */

// ── CORS (permite chamada direta do WMS sem proxy) ────────────────────────────
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: PATCH, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Método ────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'PATCH') {
    http_response_code(405);
    echo json_encode(['error' => 'Método não permitido. Use PATCH.']);
    exit;
}

// ── Autenticação ──────────────────────────────────────────────────────────────
define('TOKEN_VALIDO', 'WMS-TOKEN-STOCK-2026');

if (($_GET['token'] ?? '') !== TOKEN_VALIDO) {
    http_response_code(401);
    echo json_encode(['error' => 'Token inválido.']);
    exit;
}

// ── Payload ───────────────────────────────────────────────────────────────────
$body = json_decode(file_get_contents('php://input'), true);

if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode(['error' => 'JSON inválido.']);
    exit;
}

$obrigatorios = ['id_item_enderecamento', 'rua_destino', 'posicao_destino'];
foreach ($obrigatorios as $campo) {
    if (empty($body[$campo])) {
        http_response_code(422);
        echo json_encode(['error' => "Campo obrigatório ausente: $campo"]);
        exit;
    }
}

$id_end        = trim($body['id_item_enderecamento']);
$item_codigo   = trim($body['item_codigo']   ?? '');
$item_descricao= trim($body['item_descricao'] ?? '');
$numero_lote   = trim($body['numero_lote']   ?? '');
$dt_validade   = trim($body['dt_validade']   ?? '');
$empresa_apelido = trim($body['empresa_apelido'] ?? '');
$rua_origem    = strtoupper(trim($body['rua']    ?? ''));
$posicao_origem= trim($body['posicao']           ?? '');
$rua_destino   = strtoupper(trim($body['rua_destino']));
$posicao_destino = trim($body['posicao_destino']);
$operador      = trim($body['operador'] ?? 'WMS');

// ── Conexão com o banco ───────────────────────────────────────────────────────
// TODO: substituir pelas credenciais do ERP
$host   = 'localhost';
$db     = 'nome_do_banco';
$user   = 'usuario';
$pass   = 'senha';

try {
    $pdo = new PDO(
        "mysql:host=$host;dbname=$db;charset=utf8mb4",
        $user, $pass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Falha na conexão com o banco de dados.']);
    exit;
}

// ── Atualização ───────────────────────────────────────────────────────────────
// TODO: ajustar nome da tabela e colunas conforme o schema do ERP
try {
    $sql = "
        UPDATE item_enderecamento
        SET
            rua             = :rua_destino,
            posicao         = :posicao_destino,
            dt_transferencia = NOW(),
            operador_transfer= :operador
        WHERE id_item_enderecamento = :id_end
        LIMIT 1
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':rua_destino'      => $rua_destino,
        ':posicao_destino'  => $posicao_destino,
        ':operador'         => $operador,
        ':id_end'           => $id_end,
    ]);

    if ($stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(['error' => "Registro id_item_enderecamento=$id_end não encontrado."]);
        exit;
    }

    // ── Log de auditoria (opcional) ───────────────────────────────────────────
    // TODO: ajustar nome da tabela de log se existir
    $logSql = "
        INSERT INTO wms_transfer_log
            (id_item_enderecamento, item_codigo, numero_lote,
             rua_origem, posicao_origem, rua_destino, posicao_destino,
             operador, dt_transferencia)
        VALUES
            (:id_end, :item_codigo, :numero_lote,
             :rua_origem, :posicao_origem, :rua_destino, :posicao_destino,
             :operador, NOW())
    ";
    $logStmt = $pdo->prepare($logSql);
    $logStmt->execute([
        ':id_end'           => $id_end,
        ':item_codigo'      => $item_codigo,
        ':numero_lote'      => $numero_lote,
        ':rua_origem'       => $rua_origem,
        ':posicao_origem'   => $posicao_origem,
        ':rua_destino'      => $rua_destino,
        ':posicao_destino'  => $posicao_destino,
        ':operador'         => $operador,
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Erro ao atualizar o banco de dados.']);
    exit;
}

// ── Resposta de sucesso ───────────────────────────────────────────────────────
http_response_code(200);
echo json_encode([
    'success'          => true,
    'id_item_enderecamento' => $id_end,
    'rua_destino'      => $rua_destino,
    'posicao_destino'  => $posicao_destino,
    'operador'         => $operador,
    'dt_transferencia' => date('Y-m-d H:i:s'),
]);
