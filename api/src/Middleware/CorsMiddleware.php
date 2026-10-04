<?php

declare(strict_types=1);

namespace Cwot\Api\Middleware;

use Cwot\Api\Config;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as RequestHandler;
use Slim\Psr7\Response as SlimResponse;

final class CorsMiddleware implements MiddlewareInterface
{
    public function __construct(private readonly Config $config)
    {
    }

    public function process(Request $request, RequestHandler $handler): Response
    {
        if (strtoupper($request->getMethod()) === 'OPTIONS') {
            $response = new SlimResponse(204);
            return $this->withCors($request, $response);
        }

        return $this->withCors($request, $handler->handle($request));
    }

    private function withCors(Request $request, Response $response): Response
    {
        $origin = $request->getHeaderLine('Origin');
        $allowed = $this->config->corsOrigin;
        $value = '*';
        if ($allowed !== '*') {
            $list = array_map('trim', explode(',', $allowed));
            $value = in_array($origin, $list, true) ? $origin : ($list[0] ?? '*');
        }

        return $response
            ->withHeader('Access-Control-Allow-Origin', $value)
            ->withHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            ->withHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
            ->withHeader('Access-Control-Max-Age', '86400')
            ->withHeader('Vary', 'Origin');
    }
}
