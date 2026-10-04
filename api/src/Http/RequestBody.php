<?php

declare(strict_types=1);

namespace Cwot\Api\Http;

use Psr\Http\Message\ServerRequestInterface as Request;

final class RequestBody
{
    /** @return array<string, mixed> */
    public static function json(Request $request): array
    {
        $parsed = $request->getParsedBody();
        if (is_array($parsed)) {
            return $parsed;
        }
        $raw = (string) $request->getBody();
        if ($raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}
