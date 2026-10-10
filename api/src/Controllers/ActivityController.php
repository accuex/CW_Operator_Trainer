<?php

declare(strict_types=1);
namespace Cwot\Api\Controllers;

use Cwot\Api\Services\ActivityService;
use Cwot\Api\Http\JsonResponse;
use Cwot\Api\Http\RequestBody;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class ActivityController
{
    public function __construct(private readonly ActivityService $service) {}

    public function handle(Request $request, Response $response, string $action): Response
    {
        $response = $response->withHeader('Cache-Control', 'no-store');
        try {
            $ip = (string)($request->getServerParams()['REMOTE_ADDR'] ?? 'unknown');
            if ($action === 'feed') $this->service->rateLimit($ip, time(), 'read');
            if ($action === 'feed') return JsonResponse::write($response, ['items' => $this->service->feed(time())]);
            $body = RequestBody::json($request);
            $token = preg_replace('/^Bearer /', '', $request->getHeaderLine('Authorization')) ?? '';
            $this->service->rateLimit($ip, time(), $action === 'consent' ? 'read' : (($body['sharing'] ?? null) === false && $action === 'settings' ? 'withdraw' : 'write'));
            if ($action === 'consent') return JsonResponse::write($response, $this->service->consent($token));
            $this->service->cleanup(time());
            if ($action === 'profile') {
                if (!is_string($body['nickname'] ?? null) || !(is_string($body['avatarId'] ?? '') || ($body['avatarId'] ?? null) === null)) throw new \InvalidArgumentException('Invalid profile');
                return JsonResponse::write($response, $this->service->profile($token, $body['nickname'], $body['avatarId'] ?? null, time()));
            }
            if ($action === 'settings') {
                if (!isset($body['sharing']) || !is_bool($body['sharing']) || !is_string($body['nickname'] ?? '') || !(is_string($body['avatarId'] ?? '') || ($body['avatarId'] ?? null) === null)) throw new \InvalidArgumentException('Invalid settings');
                return JsonResponse::write($response, $this->service->settings($token, $body['sharing'], $body['nickname'] ?? '', $body['avatarId'] ?? null, time(), isset($body['revision']) && is_int($body['revision']) && $body['revision'] >= 0 ? $body['revision'] : null));
            }
            if (!is_string($body['kind'] ?? null) || !is_string($body['detail'] ?? null)) throw new \InvalidArgumentException('Invalid event');
            return JsonResponse::write($response, ['accepted' => $this->service->publish($token, $body['kind'], $body['detail'], time())]);
        } catch (\InvalidArgumentException $e) {
            return JsonResponse::error($response, 'validation_error', $e->getMessage(), 422);
        } catch (\RuntimeException $e) {
            if ($e->getMessage() === 'consent_conflict') return JsonResponse::error($response, 'consent_conflict', '共有設定が変更されました。再度確認してください', 409);
            if ($e->getMessage() !== 'rate_limited') throw $e;
            return JsonResponse::error($response, 'rate_limited', 'しばらく待ってからお試しください', 429);
        }
    }
}
