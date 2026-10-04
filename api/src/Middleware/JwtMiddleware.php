<?php

declare(strict_types=1);

namespace Cwot\Api\Middleware;

use Cwot\Api\Http\JsonResponse;
use Cwot\Api\Services\JwtService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as RequestHandler;
use RuntimeException;
use Slim\Psr7\Response as SlimResponse;

final class JwtMiddleware implements MiddlewareInterface
{
    public function __construct(private readonly JwtService $jwt)
    {
    }

    public function process(Request $request, RequestHandler $handler): Response
    {
        $header = $request->getHeaderLine('Authorization');
        if (!preg_match('/^Bearer\s+(\S+)$/i', $header, $matches)) {
            return JsonResponse::error(new SlimResponse(), 'unauthorized', 'Missing Bearer token', 401);
        }

        try {
            $claims = $this->jwt->parse($matches[1], 'access');
        } catch (RuntimeException) {
            return JsonResponse::error(new SlimResponse(), 'unauthorized', 'Invalid or expired token', 401);
        }

        return $handler->handle(
            $request
                ->withAttribute('userId', $claims['userId'])
                ->withAttribute('userEmail', $claims['email']),
        );
    }
}
