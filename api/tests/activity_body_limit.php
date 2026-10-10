<?php
declare(strict_types=1);
require dirname(__DIR__) . '/vendor/autoload.php';
use Cwot\Api\Middleware\ActivityBodyLimitMiddleware;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Factory\ServerRequestFactory;
use Slim\Psr7\Response as SlimResponse;
$handler = new class implements RequestHandlerInterface {
    public int $calls = 0;
    public function handle(Request $request): Response { $this->calls++; if ((string)$request->getBody() !== '{"sharing":false}') throw new RuntimeException('Body not preserved'); return new SlimResponse(200); }
};
$limit = new ActivityBodyLimitMiddleware();
function check(bool $ok,string $label): void { if (!$ok) throw new RuntimeException($label); echo "PASS $label\n"; }
function request(string $body, ?string $length = null): Request {
    $r = (new ServerRequestFactory())->createServerRequest('PUT','https://example.test/api/v1/activity/settings');
    $r->getBody()->write($body); return $length === null ? $r : $r->withHeader('Content-Length',$length);
}
check($limit->process(request('{"sharing":false}'),$handler)->getStatusCode()===200,'small body preserved');
check($limit->process(request(str_repeat('x',8193)),$handler)->getStatusCode()===413,'oversized unannounced body rejected');
check($limit->process(request(str_repeat('x',8193),'1'),$handler)->getStatusCode()===413,'false small Content-Length cannot bypass');
check($limit->process(request('','8193'),$handler)->getStatusCode()===413,'large declared length rejected');
check($handler->calls===1,'oversized requests never reach parser/handler');
