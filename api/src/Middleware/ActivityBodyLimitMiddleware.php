<?php
declare(strict_types=1);
namespace Cwot\Api\Middleware;
use Cwot\Api\Http\JsonResponse;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Slim\Psr7\Response as SlimResponse;
use Slim\Psr7\Stream;
/** Registered outside BodyParsingMiddleware: enforce before JSON decoding. */
final class ActivityBodyLimitMiddleware implements MiddlewareInterface
{
    public const MAX_BYTES = 8192;
    public function process(Request $request, Handler $handler): Response
    {
        if (!preg_match('#^/api/v1/activity(?:/|$)#', $request->getUri()->getPath())) return $handler->handle($request);
        $length = $request->getHeaderLine('Content-Length');
        if ($length !== '' && (!ctype_digit($length) || (float)$length > self::MAX_BYTES)) return JsonResponse::error(new SlimResponse(), 'payload_too_large', '送信データが大きすぎます', 413);
        $body = $request->getBody();
        if ($body->isSeekable()) $body->rewind();
        $raw = '';
        while (!$body->eof() && strlen($raw) <= self::MAX_BYTES) {
            $part = $body->read(self::MAX_BYTES + 1 - strlen($raw));
            if ($part === '') break;
            $raw .= $part;
        }
        if (strlen($raw) > self::MAX_BYTES) return JsonResponse::error(new SlimResponse(), 'payload_too_large', '送信データが大きすぎます', 413);
        $copy = fopen('php://temp','r+'); fwrite($copy, $raw); rewind($copy);
        return $handler->handle($request->withBody(new Stream($copy)));
    }
}
