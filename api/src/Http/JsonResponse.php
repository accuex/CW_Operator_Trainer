<?php

declare(strict_types=1);

namespace Cwot\Api\Http;

use Psr\Http\Message\ResponseInterface as Response;

final class JsonResponse
{
    public static function write(Response $response, mixed $data, int $status = 200): Response
    {
        $payload = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            $payload = '{"error":"json_encode_failed"}';
            $status = 500;
        }
        $response->getBody()->write($payload);
        return $response
            ->withHeader('Content-Type', 'application/json; charset=utf-8')
            ->withStatus($status);
    }

    public static function error(Response $response, string $code, string $message, int $status, array $extra = []): Response
    {
        return self::write($response, array_merge([
            'error' => $code,
            'message' => $message,
        ], $extra), $status);
    }
}
